import type { FastifyInstance } from "fastify";
import type { AgentRuntimeManager } from "../../runtime/services/AgentRuntimeManager.js";
import type { SessionTranscriptRepository } from "../repositories/SessionTranscriptRepository.js";

/** REST session listing — session discovery lives outside the ACP WebSocket. */
export async function registerSessionRoutes(app: FastifyInstance, runtimeManager: AgentRuntimeManager, transcriptRepository: SessionTranscriptRepository): Promise<void> {
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

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/transcript", async (request, reply) => {
    const sessionId = request.params.sessionId;
    const records = await runtimeManager.listSessions();
    const record = records.find((item) => item.sessionId === sessionId);
    if (!record) {
      reply.code(404).send({ error: "Unknown session" });
      return;
    }
    const events = await transcriptRepository.list(sessionId);
    return {
      sessionId,
      running: runtimeManager.sessionHasRuntime(sessionId),
      events: events.map((item) => ({ sequence: item.sequence, createdAt: item.createdAt, ...item.event })),
    };
  });
}
