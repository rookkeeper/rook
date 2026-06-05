import type { AgentSessionRecord } from "./agents/sessionLog.js";
import { isKnownAgent } from "./agents/agentDiscovery.js";

export function rejectUnknownAgent(agentId: unknown, reply: { code: (statusCode: number) => { send: (payload: unknown) => void } }): agentId is string {
  if (typeof agentId !== "string" || !isKnownAgent(agentId)) {
    reply.code(400).send({ error: "Unknown agent" });
    return false;
  }
  return true;
}

export function isSessionRecord(value: unknown): value is AgentSessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<AgentSessionRecord>;
  return typeof record.id === "string" && typeof record.agent === "string" && typeof record.createdAt === "string" && typeof record.restart === "object" && record.restart !== null;
}

export function parseFromSequence(value: unknown): number | null {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function createWsError(error: string, requestId?: string) {
  return JSON.stringify({ type: "error", error, ...(requestId ? { requestId } : {}) });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
