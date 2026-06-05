import dotenv from "dotenv";
import fastify from "fastify";
import websocket from "@fastify/websocket";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EnvironmentDecisionStore } from "./environment/EnvironmentDecisionStore.js";
import { EnvironmentManager } from "./environment/EnvironmentManager.js";
import { LocalEnvironmentRepository } from "./environment/LocalEnvironmentRepository.js";
import { REPO_ROOT } from "./paths.js";
import { SessionRoomManager } from "./realtime/SessionRoomManager.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerEnvironmentRoutes } from "./routes/environmentRoutes.js";
import { registerWebsocketRoute } from "./routes/websocketRoute.js";
import { SessionEventStore } from "./sessionEvents.js";
import { registerClientApp } from "./clientApp.js";

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

export interface BuildServerOptions {
  enableClient?: boolean;
  logger?: Parameters<typeof fastify>[0]["logger"];
  roomIdleTimeoutMs?: number;
  /** SQLite location for persistent environment decisions; ":memory:" in tests. */
  environmentDecisionStoreLocation?: string;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = fastify({ logger: options.logger ?? true });
  const enableClient = options.enableClient ?? true;
  const sessionEventStore = new SessionEventStore();
  const environmentRepository = new LocalEnvironmentRepository();
  const environmentDecisionStore = new EnvironmentDecisionStore(options.environmentDecisionStoreLocation);
  const environmentManager = new EnvironmentManager(environmentRepository, environmentDecisionStore);
  const roomManager = new SessionRoomManager(sessionEventStore, {
    idleTimeoutMs: options.roomIdleTimeoutMs,
    onRoomRemoved: (sessionId) => environmentManager.unsubscribe(sessionId),
  });

  await app.register(websocket);

  app.addHook("onClose", async () => {
    await roomManager.closeAll();
  });

  await registerAgentRoutes(app, { roomManager, environmentManager, sessionEventStore });
  await registerEnvironmentRoutes(app, environmentManager);
  await registerWebsocketRoute(app, roomManager);

  if (enableClient) {
    await registerClientApp(app);
  }

  return app;
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
  const app = await buildServer();
  await app.listen({ host, port });
  console.log(`Agent Station listening at http://${host}:${port}`);
}
