import dotenv from "dotenv";
import fastify from "fastify";
import websocket from "@fastify/websocket";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EnvironmentDecisionStore } from "./environment/EnvironmentDecisionStore.js";
import { EnvironmentManager } from "./environment/EnvironmentManager.js";
import { CompositeEnvironmentRepository } from "./environment/CompositeEnvironmentRepository.js";
import { DirectoryEnvironmentRepository } from "./environment/DirectoryEnvironmentRepository.js";
import { LocationContextRepository } from "./environment/LocationContextRepository.js";
import { EnvironmentRepositoryService } from "./environment/EnvironmentRepositoryService.js";
import { EnvironmentIdentifier } from "./location/EnvironmentIdentifier.js";
import { MockBuildingSkillSuggester } from "./location/BuildingSkillSuggester.js";
import { PtilesPoiLookupProvider } from "./location/PtilesPoiLookupProvider.js";
import { LocationRegistrar } from "./location/LocationRegistrar.js";
import { createUpstreamFetchRange } from "./location/ptiles/ptilesFetch.js";
import type { PoiLookupProvider } from "./location/PoiLookupProvider.js";
import { REPO_ROOT } from "./paths.js";
import { SessionRoomManager } from "./realtime/SessionRoomManager.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerEnvironmentRoutes } from "./routes/environmentRoutes.js";
import { registerWebsocketRoute } from "./routes/websocketRoute.js";

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

export interface BuildServerOptions {
  enableClient?: boolean; // legacy no-op; the server no longer hosts a web client
  logger?: Parameters<typeof fastify>[0]["logger"];
  roomIdleTimeoutMs?: number;
  /** SQLite location for persistent environment decisions; ":memory:" in tests. */
  environmentDecisionStoreLocation?: string;
  /** Override the POI lookup provider (defaults to the ptiles provider via the proxy route). */
  poiProvider?: PoiLookupProvider;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = fastify({ logger: options.logger ?? true });
  // Programmatic repo for the synthesized location-context bundle (no extraSkillPaths).
  const locationContextRepository = new LocationContextRepository();
  const environmentRepository = new CompositeEnvironmentRepository([
    new DirectoryEnvironmentRepository(path.join(REPO_ROOT, "environment-repository")),
    new DirectoryEnvironmentRepository(path.join(os.homedir(), ".rook", "environment-repository")),
    locationContextRepository,
  ]);
  const environmentRepositoryService = new EnvironmentRepositoryService(environmentRepository);
  const environmentDecisionStore = new EnvironmentDecisionStore(options.environmentDecisionStoreLocation);
  const environmentManager = new EnvironmentManager(environmentRepositoryService, environmentDecisionStore);
  // Ptiles is an internal geo-identification detail: fetch byte ranges directly from
  // the upstream host (single egress, allowlisted file names) — no public route.
  const fetchRange = createUpstreamFetchRange();
  const environmentIdentifier = new EnvironmentIdentifier({
    poiProvider: options.poiProvider ?? new PtilesPoiLookupProvider({ fetchRange }),
    repository: environmentRepositoryService,
    skillSuggester: new MockBuildingSkillSuggester(),
  });
  const locationRegistrar = new LocationRegistrar(environmentManager, locationContextRepository);
  const roomManager = new SessionRoomManager({
    idleTimeoutMs: options.roomIdleTimeoutMs,
    onRoomRemoved: (sessionId) => environmentManager.unsubscribe(sessionId),
  });

  await app.register(websocket);

  app.addHook("onClose", async () => {
    await roomManager.closeAll();
  });

  await registerAgentRoutes(app, { roomManager, environmentManager });
  await registerEnvironmentRoutes(app, environmentManager, environmentIdentifier, locationRegistrar);
  await registerWebsocketRoute(app, roomManager);

  return app;
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
  const app = await buildServer();
  await app.listen({ host, port });
  console.log(`Rook listening at http://${host}:${port}`);
}
