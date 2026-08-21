import type { FastifyInstance, FastifyReply } from "fastify";
import type { AgentRuntimeManager } from "../../runtime/services/AgentRuntimeManager.js";
import type { SessionRecord } from "../repositories/SessionRepository.js";

/** REST session listing — session discovery lives outside the ACP WebSocket. */
export async function registerSessionRoutes(app: FastifyInstance, runtimeManager: AgentRuntimeManager): Promise<void> {
  app.get("/api/sessions", async () => {
    const records = await runtimeManager.listSessions();
    return { sessions: records.map((record) => serializeSession(record, runtimeManager)) };
  });

  app.patch<{ Params: { sessionId: string }; Body: { title?: string; pinned?: boolean } }>("/api/sessions/:sessionId", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    const body = request.body ?? {};
    if (body.pinned !== undefined && typeof body.pinned !== "boolean") {
      return reply.code(400).send({ error: "pinned must be a boolean" });
    }
    let record = await runtimeManager.getSession(request.params.sessionId);
    if (typeof body.title === "string") record = await runtimeManager.renameSession(request.params.sessionId, body.title);
    if (body.pinned !== undefined) record = await runtimeManager.setSessionPinned(request.params.sessionId, body.pinned);
    return serializeSession(record, runtimeManager);
  });

  app.post<{ Body: { sessionIds?: unknown } }>("/api/sessions/reorder-pinned", async (request, reply) => {
    const sessionIds = request.body?.sessionIds;
    if (!Array.isArray(sessionIds) || sessionIds.some((id) => typeof id !== "string")) {
      return reply.code(400).send({ error: "sessionIds must be an array of session IDs" });
    }
    try {
      const records = await runtimeManager.reorderPinnedSessions(sessionIds);
      return { sessions: records.map((record) => serializeSession(record, runtimeManager)) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/touch", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    const record = await runtimeManager.touchSession(request.params.sessionId);
    return serializeSession(record, runtimeManager);
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/unview", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    await runtimeManager.unviewSession(request.params.sessionId);
    const record = await runtimeManager.getSession(request.params.sessionId);
    return serializeSession(record, runtimeManager);
  });

  app.delete<{ Params: { sessionId: string } }>("/api/sessions/:sessionId", async (request, reply) => {
    if (!await ensureSessionExists(runtimeManager, request.params.sessionId, reply)) return;
    await runtimeManager.deleteSession(request.params.sessionId);
    return { ok: true };
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
    pinned: record.pinned,
    pinnedOrder: record.pinnedOrder,
    running: runtimeManager.sessionHasRuntime(record.sessionId),
    activityStatus: runtimeManager.activityStatus(record.sessionId, record),
    supportsImagePrompts: runtimeManager.supportsImagePrompts(record.runtimeId),
  };
}
