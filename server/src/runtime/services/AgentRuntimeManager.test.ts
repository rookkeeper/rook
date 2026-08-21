// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AgentRuntimeManager } from "./AgentRuntimeManager.js";
import { RuntimeRequestError } from "../SessionRuntime.js";
import type { AgentRuntimeProfile } from "../../infrastructure/config/agentRuntimes.js";
import type { CapabilityWorkspaceManager } from "../CapabilityWorkspaceManager.js";
import type { SessionRuntime, JsonObject, SessionRuntimeConfiguration } from "../SessionRuntime.js";
import type { SessionAttentionStatus, SessionRecord, SessionRepository } from "../../sessions/repositories/SessionRepository.js";

const PROFILE: AgentRuntimeProfile = { id: "FakeRuntime", type: "acp", command: "node", args: [] };
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const RUNTIME_SESSION_ID = "runtime-session-1";

type RuntimeResponder = (method: string, params: JsonObject) => unknown;

/** Stands in for a runtime subprocess: records requests, never spawns anything. */
class FakeSessionRuntime {
  readonly requests: Array<{ method: string; params: JsonObject }> = [];
  readonly isStarted = true;
  readonly isAlive = true;
  closed = false;
  replacementRuntime: FakeSessionRuntime | undefined;

  constructor(
    readonly profile: AgentRuntimeProfile,
    readonly configuration: SessionRuntimeConfiguration,
    private readonly respond: RuntimeResponder,
  ) {}

  replacement(configuration: SessionRuntimeConfiguration): FakeSessionRuntime {
    this.replacementRuntime = new FakeSessionRuntime(this.profile, configuration, this.respond);
    return this.replacementRuntime;
  }

  async request(method: string, params: JsonObject = {}): Promise<unknown> {
    this.requests.push({ method, params });
    return this.respond(method, params);
  }

  onNotification(): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  methods(): string[] {
    return this.requests.map((request) => request.method);
  }
}

class FakeSessionRepository implements SessionRepository {
  readonly saved: SessionRecord[] = [];
  constructor(private record: SessionRecord) {}

  async list(): Promise<SessionRecord[]> { return [this.record]; }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    return sessionId === this.record.sessionId ? { ...this.record } : undefined;
  }

  async save(record: SessionRecord): Promise<void> {
    this.record = { ...record };
    this.saved.push({ ...record });
  }

  async rename(_sessionId: string, title: string): Promise<void> { this.record = { ...this.record, title }; }
  async setPinned(_sessionId: string, _pinned: boolean): Promise<void> {}
  async reorderPinned(_sessionIds: string[]): Promise<void> {}
  async touch(_sessionId: string, updatedAt = new Date().toISOString()): Promise<void> { this.record = { ...this.record, updatedAt }; }
  async setAttentionStatus(_sessionId: string, status: SessionAttentionStatus): Promise<void> { this.record = { ...this.record, attentionStatus: status }; }
  async delete(): Promise<void> {}
  async environmentIds(): Promise<string[]> { return []; }
  async replaceEnvironmentIds(): Promise<void> {}

  current(): SessionRecord { return this.record; }
}

function sessionRecord(): SessionRecord {
  return {
    sessionId: SESSION_ID,
    runtimeId: PROFILE.id,
    runtimeSessionId: RUNTIME_SESSION_ID,
    title: "virgin",
    cwd: "/workspace/session",
    startedAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    attentionStatus: "clear",
    pinned: false,
    pinnedOrder: 0,
  };
}

function configuration(): SessionRuntimeConfiguration {
  return { enteredEnvironmentIds: ["web:example.com"], skillPaths: [], extensionPaths: [], workspaceRoot: "/workspace/session" };
}

function buildManager(options: { responder: RuntimeResponder }) {
  const sessions = new FakeSessionRepository(sessionRecord());
  const logger = { info: vi.fn() };
  const workspaceManager = { assessAndFlush: vi.fn(async () => undefined), removeSession: vi.fn(async () => undefined) };
  const manager = new AgentRuntimeManager(
    [PROFILE],
    sessions,
    "/repo",
    workspaceManager as unknown as CapabilityWorkspaceManager,
    undefined,
    logger,
  );
  const current = new FakeSessionRuntime(PROFILE, { enteredEnvironmentIds: [], skillPaths: [], extensionPaths: [] }, options.responder);
  (manager as unknown as { sessionRuntimes: Map<string, SessionRuntime> }).sessionRuntimes.set(SESSION_ID, current as unknown as SessionRuntime);
  const installedRuntime = () => (manager as unknown as { sessionRuntimes: Map<string, SessionRuntime> }).sessionRuntimes.get(SESSION_ID);
  return { manager, sessions, logger, current, installedRuntime };
}

function loadResponseError(): RuntimeRequestError {
  return new RuntimeRequestError({ code: 1234, message: "runtime could not load this session" });
}

describe("AgentRuntimeManager environment restart", () => {
  it("keeps the recorded runtime session when session/load succeeds", async () => {
    const { manager, sessions, current, installedRuntime } = buildManager({
      responder: (method) => (method === "session/load" ? { sessionId: RUNTIME_SESSION_ID } : {}),
    });

    await manager.restartSessionForEnvironmentChange(SESSION_ID, configuration());

    const replacement = current.replacementRuntime!;
    expect(replacement.methods()).toEqual(["session/load"]);
    expect(sessions.saved).toEqual([]);
    expect(sessions.current().runtimeSessionId).toBe(RUNTIME_SESSION_ID);
    expect(current.closed).toBe(true);
    expect(installedRuntime()).toBe(replacement as unknown as SessionRuntime);
    await manager.close();
  });

  it("recreates the runtime session after any ACP session/load response error", async () => {
    const { manager, sessions, logger, current, installedRuntime } = buildManager({
      responder: (method) => {
        if (method === "session/load") throw loadResponseError();
        return { sessionId: "runtime-session-2" };
      },
    });

    await manager.restartSessionForEnvironmentChange(SESSION_ID, configuration());

    const replacement = current.replacementRuntime!;
    expect(replacement.methods()).toEqual(["session/load", "session/new"]);
    expect(replacement.requests[1]?.params).toMatchObject({ cwd: "/workspace/session", mcpServers: [] });
    expect(replacement.closed).toBe(false);
    expect(current.closed).toBe(true);
    expect(installedRuntime()).toBe(replacement as unknown as SessionRuntime);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, error: "runtime could not load this session", code: 1234 }),
      "session/load failed; recreated runtime session via session/new",
    );
    expect(sessions.current().runtimeSessionId).toBe("runtime-session-2");
    await manager.close();
  });

  it("persists the recreated runtime session id on the session record", async () => {
    const { manager, sessions } = buildManager({
      responder: (method) => method === "session/load" ? (() => { throw loadResponseError(); })() : { sessionId: "runtime-session-2" },
    });

    await manager.restartSessionForEnvironmentChange(SESSION_ID, configuration());

    expect(sessions.saved).toHaveLength(1);
    expect(sessions.saved[0]).toMatchObject({
      sessionId: SESSION_ID,
      runtimeSessionId: "runtime-session-2",
      title: "virgin",
      cwd: "/workspace/session",
      startedAt: "2026-08-12T00:00:00.000Z",
    });
    await manager.close();
  });

  it("does not recreate after a startup or transport failure", async () => {
    const { manager, current, installedRuntime } = buildManager({
      responder: () => { throw new Error("runtime exited before responding"); },
    });

    await expect(manager.restartSessionForEnvironmentChange(SESSION_ID, configuration())).rejects.toThrow("runtime exited before responding");

    expect(current.replacementRuntime!.methods()).toEqual(["session/load"]);
    expect(current.replacementRuntime!.closed).toBe(true);
    expect(installedRuntime()).toBe(current as unknown as SessionRuntime);
    await manager.close();
  });

  it("does not recreate when session/load returns a different session ID", async () => {
    const { manager, current, installedRuntime } = buildManager({
      responder: (method) => method === "session/load" ? { sessionId: "unexpected-session" } : { sessionId: "runtime-session-2" },
    });

    await expect(manager.restartSessionForEnvironmentChange(SESSION_ID, configuration())).rejects.toThrow("different session ID");

    expect(current.replacementRuntime!.methods()).toEqual(["session/load"]);
    expect(current.replacementRuntime!.closed).toBe(true);
    expect(installedRuntime()).toBe(current as unknown as SessionRuntime);
    await manager.close();
  });
});
