import type { FastifyInstance, FastifyReply } from "fastify";
import type { AgentRuntimeManager } from "../../runtime/services/AgentRuntimeManager.js";
import type { SessionTranscriptRepository } from "../repositories/SessionTranscriptRepository.js";
import type { SessionRecord } from "../repositories/SessionRepository.js";

/** REST session listing — session discovery lives outside the ACP WebSocket. */
export async function registerSessionRoutes(app: FastifyInstance, runtimeManager: AgentRuntimeManager, transcriptRepository: SessionTranscriptRepository): Promise<void> {
  app.get("/api/sessions", async () => {
    const records = await runtimeManager.listSessions();
    return { sessions: records.map((record) => serializeSession(record, runtimeManager)) };
  });

  app.patch<{ Params: { sessionId: string }; Body: { title?: string } }>("/api/sessions/:sessionId", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    const record = await runtimeManager.renameSession(request.params.sessionId, typeof request.body?.title === "string" ? request.body.title : "session");
    return serializeSession(record, runtimeManager);
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/touch", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    const record = await runtimeManager.touchSession(request.params.sessionId);
    return serializeSession(record, runtimeManager);
  });

  app.delete<{ Params: { sessionId: string } }>("/api/sessions/:sessionId", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    await runtimeManager.deleteSession(request.params.sessionId);
    return { ok: true };
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

async function ensureSessionExists(runtimeManager: AgentRuntimeManager, sessionId: string, reply: FastifyReply): Promise<boolean> {
  try {
    await runtimeManager.getSession(sessionId);
    return true;
  } catch {
    reply.code(404).send({ error: "Unknown session" });
    return false;
  }
}

function serializeSession(record: SessionRecord, runtimeManager: AgentRuntimeManager) {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    title: record.title,
    runtimeId: record.runtimeId,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    running: runtimeManager.sessionHasRuntime(record.sessionId),
    supportsImagePrompts: runtimeManager.supportsImagePrompts(record.runtimeId),
  };
}
