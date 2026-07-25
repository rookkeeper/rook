import type { FastifyInstance } from "fastify";
import type { AgentRuntimeManager } from "../services/AgentRuntimeManager.js";

/** REST session listing — session discovery lives outside the ACP WebSocket. */
export async function registerSessionRoutes(app: FastifyInstance, runtimeManager: AgentRuntimeManager): Promise<void> {
  app.get("/api/sessions", async () => {
    const records = await runtimeManager.listSessions();
    return {
      sessions: records.map((record) => ({
        sessionId: record.sessionId,
        cwd: record.cwd,
        title: record.title,
        updatedAt: record.updatedAt,
        running: runtimeManager.sessionHasRuntime(record.sessionId),
        _meta: {
          runtimeId: record.runtimeId,
          startedAt: record.startedAt,
        },
      })),
    };
  });
}
