import dotenv from "dotenv";
import fastify from "fastify";
import websocket from "@fastify/websocket";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EnvironmentDecisionStore } from "./environments/datastores/EnvironmentDecisionStore.js";
import { EnvironmentManager } from "./environments/services/EnvironmentManager.js";
import { CompositeEnvironmentRepository } from "./environments/repositories/CompositeEnvironmentRepository.js";
import { SQLiteEnvironmentRepository } from "./environments/repositories/SQLiteEnvironmentRepository.js";
import { LocationContextRepository } from "./environments/repositories/LocationContextRepository.js";
import { EnvironmentRepositoryService } from "./environments/services/EnvironmentRepositoryService.js";
import { JsonlEnvironmentMetadataCaptureSink } from "./environments/services/environmentMetadataCapture.js";
import { EnvironmentIdentifier } from "./location/EnvironmentIdentifier.js";
import { MockBuildingSkillSuggester } from "./location/BuildingSkillSuggester.js";
import { PtilesPoiLookupProvider } from "./location/PtilesPoiLookupProvider.js";
import { LocationRegistrar } from "./location/LocationRegistrar.js";
import { createUpstreamFetchRange } from "./location/ptiles/ptilesFetch.js";
import type { PoiLookupProvider } from "./location/PoiLookupProvider.js";
import { REPO_ROOT } from "./infrastructure/paths.js";
import { registerEnvironmentRoutes } from "./environments/routes/environmentRoutes.js";
import { registerDiagnosticRoutes } from "./environments/routes/diagnosticRoutes.js";
import { registerRuntimeRoutes } from "./runtime/routes/runtimeRoutes.js";
import { registerSessionRoutes } from "./sessions/routes/sessionRoutes.js";
import { registerAcpFacadeRoute } from "./runtime/routes/acpFacadeRoute.js";
import { ServerAuth } from "./infrastructure/auth.js";
import { loadAgentRuntimes } from "./infrastructure/config/agentRuntimes.js";
import { RookDatastore } from "./infrastructure/datastores/RookDatastore.js";
import { SqliteSessionRepository } from "./sessions/datastores/SqliteSessionRepository.js";
import { AgentRuntimeManager } from "./runtime/services/AgentRuntimeManager.js";
import { SessionTranscriptStore } from "./sessions/services/SessionTranscriptStore.js";
import { startRemoteProxy } from "./infrastructure/remoteProxy.js";

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const loopbackHost = "127.0.0.1";
const remoteBindIp = process.env.ROOK_BIND_IP ?? process.env.ROOK_TAILSCALE_IP;
const port = Number(process.env.PORT ?? 7665);

export interface BuildServerOptions {
  enableClient?: boolean; // legacy no-op; the server no longer hosts a web client
  logger?: Parameters<typeof fastify>[0]["logger"];
  roomIdleTimeoutMs?: number;
  /** SQLite location for persistent environment decisions; ":memory:" in tests. */
  environmentDecisionStoreLocation?: string;
  /** Active environment window. Defaults to 5m15s. */
  environmentActiveWindowMs?: number;
  /** Retention for recent inactive environments. Defaults to 30 minutes. */
  environmentRecentRetentionMs?: number;
  /** Override the POI lookup provider (defaults to the ptiles provider via the proxy route). */
  poiProvider?: PoiLookupProvider;
  /** Optional bearer token required by all HTTP + WebSocket requests. */
  authToken?: string;
  /** Optional canonical environment repository database. Directory storage remains the default until cutover. */
  environmentRepositoryDatabase?: string;
  /** Optional user-local environment repository database used with the canonical database. */
  personalEnvironmentRepositoryDatabase?: string;
  /** Test hook: observe registered routes. */
  onRoute?: (route: { method: string | readonly string[]; url: string; websocket?: boolean }) => void;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = fastify({ logger: options.logger ?? true });
  if (options.onRoute) {
    app.addHook("onRoute", (routeOptions) => {
      options.onRoute?.({
        method: routeOptions.method as string | readonly string[],
        url: routeOptions.url,
        websocket: (routeOptions as { websocket?: boolean }).websocket,
      });
    });
  }
  const auth = new ServerAuth({
    token: options.authToken ?? process.env.ROOK_AUTH_TOKEN,
  });
  // Programmatic repo for the synthesized location-context bundle (no extraSkillPaths).
  const locationContextRepository = new LocationContextRepository();
  const environmentRepositoryDatabase = options.environmentRepositoryDatabase ?? process.env.ROOK_ENVIRONMENT_REPOSITORY_DB ?? path.join(REPO_ROOT, "environment-repository.db");
  const personalEnvironmentRepositoryDatabase = options.personalEnvironmentRepositoryDatabase ?? process.env.ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB ?? path.join(os.homedir(), ".rook", "environment-repository.db");
  const canonicalEnvironmentRepository = new SQLiteEnvironmentRepository(
    environmentRepositoryDatabase,
    "canonical",
    { materializationRoot: path.join(REPO_ROOT, ".var", "rook", "environment-repository-projection", "canonical") },
  );
  const personalEnvironmentRepository = new SQLiteEnvironmentRepository(
    personalEnvironmentRepositoryDatabase,
    "personal",
    { materializationRoot: path.join(REPO_ROOT, ".var", "rook", "environment-repository-projection", "personal") },
  );
  if ((await canonicalEnvironmentRepository.listEnvironments()).length === 0 && existsSync(path.join(REPO_ROOT, "environment-repository"))) {
    await canonicalEnvironmentRepository.importDirectory(path.join(REPO_ROOT, "environment-repository"));
  }
  const legacyPersonalRoot = path.join(os.homedir(), ".rook", "environment-repository");
  if ((await personalEnvironmentRepository.listEnvironments()).length === 0 && existsSync(legacyPersonalRoot)) {
    await personalEnvironmentRepository.importDirectory(legacyPersonalRoot);
  }
  const environmentRepository = new CompositeEnvironmentRepository([
    canonicalEnvironmentRepository,
    personalEnvironmentRepository,
    locationContextRepository,
  ]);
  const environmentRepositoryService = new EnvironmentRepositoryService(environmentRepository);
  const datastore = new RookDatastore(options.environmentDecisionStoreLocation);
  const environmentDecisionStore = new EnvironmentDecisionStore(datastore);
  const environmentMetadataCaptureSink = new JsonlEnvironmentMetadataCaptureSink();
  await environmentMetadataCaptureSink.initialize();
  const environmentManager = new EnvironmentManager(environmentRepositoryService, environmentDecisionStore, {
    activeEnvironmentWindowMs: options.environmentActiveWindowMs ?? Number(process.env.ROOK_ENVIRONMENT_ACTIVE_WINDOW_MS ?? 5 * 60_000 + 15_000),
    recentEnvironmentRetentionMs: options.environmentRecentRetentionMs ?? Number(process.env.ROOK_ENVIRONMENT_RECENT_RETENTION_MS ?? 30 * 60_000),
    logger: app.log,
    registrationCaptureSink: environmentMetadataCaptureSink,
  });
  // Ptiles is an internal geo-identification detail: fetch byte ranges directly from
  // the upstream host (single egress, allowlisted file names) — no public route.
  const fetchRange = createUpstreamFetchRange();
  const environmentIdentifier = new EnvironmentIdentifier({
    poiProvider: options.poiProvider ?? new PtilesPoiLookupProvider({ fetchRange }),
    repository: environmentRepositoryService,
    skillSuggester: new MockBuildingSkillSuggester(),
  });
  const locationRegistrar = new LocationRegistrar(environmentManager, locationContextRepository);
  const sessionRepository = new SqliteSessionRepository(datastore);
  const transcriptStore = new SessionTranscriptStore(datastore);
  const runtimeManager = new AgentRuntimeManager(loadAgentRuntimes(), sessionRepository, REPO_ROOT, environmentManager, transcriptStore, app.log);
  await app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    const authorization = auth.authorizeRequest(request.raw);
    if (authorization.ok) return;
    reply.code(authorization.statusCode).send({ error: authorization.error });
  });

  app.addHook("onClose", async () => {
    environmentManager.close();
    await runtimeManager.close();
    canonicalEnvironmentRepository.close();
    personalEnvironmentRepository.close();
    datastore.close();
  });

  app.get("/api/health", async () => ({ ok: true, service: "rook" }));
  await registerRuntimeRoutes(app, runtimeManager);
  await registerSessionRoutes(app, runtimeManager, transcriptStore);
  await registerEnvironmentRoutes(app, environmentManager, environmentIdentifier, locationRegistrar, runtimeManager);
  await registerDiagnosticRoutes(app, environmentManager);
  await registerAcpFacadeRoute(app, runtimeManager, auth);

  return app;
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
  const app = await buildServer();
  await app.listen({ host: loopbackHost, port });

  let remoteProxy: Awaited<ReturnType<typeof startRemoteProxy>> | null = null;
  if (remoteBindIp && remoteBindIp !== loopbackHost && remoteBindIp !== "localhost") {
    remoteProxy = await startRemoteProxy({
      bindIp: remoteBindIp,
      port,
      targetHost: loopbackHost,
      targetPort: port,
    });
  }

  const shutdown = async () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    try {
      await remoteProxy?.close();
    } finally {
      await app.close();
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`Rook listening at http://${loopbackHost}:${port}`);
  if (remoteProxy) {
    console.log(`Rook remote proxy listening at http://${remoteBindIp}:${port}`);
  }
}
