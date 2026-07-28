import type { FastifyInstance } from "fastify";
import type { AgentRuntimeManager } from "../services/AgentRuntimeManager.js";

/** Lists only concrete entries declared in agent-runtimes.json. */
export async function registerRuntimeRoutes(app: FastifyInstance, runtimeManager: AgentRuntimeManager): Promise<void> {
  app.get("/api/agent_runtimes", async () => ({ runtimes: runtimeManager.runtimeDefinitions() }));
}
