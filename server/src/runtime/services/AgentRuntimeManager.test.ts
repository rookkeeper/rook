// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AgentRuntimeManager } from "./AgentRuntimeManager.js";
import type { AgentRuntimeProfile } from "../../infrastructure/config/agentRuntimes.js";
import type { CapabilityWorkspaceManager } from "../CapabilityWorkspaceManager.js";
import type { SessionRuntime, JsonObject, SessionRuntimeConfiguration } from "../SessionRuntime.js";
import type { SessionAttentionStatus, SessionRecord, SessionRepository } from "../../sessions/repositories/SessionRepository.js";
import type { SessionTranscriptRepository, TranscriptEventRecord } from "../../sessions/repositories/SessionTranscriptRepository.js";

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

  async list(): Promise<SessionRecord[]> {
    return [this.record];
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    return sessionId === this.record.sessionId ? { ...this.record } : undefined;
  }

  async save(record: SessionRecord): Promise<void> {
    this.record = { ...record };
    this.saved.push({ ...record });
  }

  async rename(_sessionId: string, title: string): Promise<void> {
    this.record = { ...this.record, title };
  }

  async touch(_sessionId: string, updatedAt = new Date().toISOString()): Promise<void> {
    this.record = { ...this.record, updatedAt };
  }

  async setAttentionStatus(_sessionId: string, status: SessionAttentionStatus): Promise<void> {
    this.record = { ...this.record, attentionStatus: status };
  }

  async delete(): Promise<void> {}

  async environmentIds(): Promise<string[]> {
    return [];
  }

  async replaceEnvironmentIds(): Promise<void> {}

  current(): SessionRecord {
    return this.record;
  }
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
  };
}

function transcriptRepositoryWith(events: Array<Record<string, unknown>>): SessionTranscriptRepository {
  const records: TranscriptEventRecord[] = events.map((event, index) => ({
    sequence: index + 1,
    sessionId: SESSION_ID,
    createdAt: "2026-08-12T00:00:00.000Z",
    event,
  }));
  return { list: vi.fn(async () => records) } as unknown as SessionTranscriptRepository;
}

function configuration(): SessionRuntimeConfiguration {
  return { enteredEnvironmentIds: ["web:example.com"], skillPaths: [], extensionPaths: [], workspaceRoot: "/workspace/session" };
}

function buildManager(options: { responder: RuntimeResponder; transcript?: Array<Record<string, unknown>> | undefined; withTranscriptRepository?: boolean }) {
  const sessions = new FakeSessionRepository(sessionRecord());
  const logger = { info: vi.fn() };
  const transcriptRepository = options.withTranscriptRepository === false ? undefined : transcriptRepositoryWith(options.transcript ?? []);
  const manager = new AgentRuntimeManager(
    [PROFILE],
    sessions,
    "/repo",
    {} as unknown as CapabilityWorkspaceManager,
    undefined,
    transcriptRepository,
    logger,
  );
  const current = new FakeSessionRuntime(PROFILE, { enteredEnvironmentIds: [], skillPaths: [], extensionPaths: [] }, options.responder);
  (manager as unknown as { sessionRuntimes: Map<string, SessionRuntime> }).sessionRuntimes.set(SESSION_ID, current as unknown as SessionRuntime);
  const installedRuntime = () => (manager as unknown as { sessionRuntimes: Map<string, SessionRuntime> }).sessionRuntimes.get(SESSION_ID);
  return { manager, sessions, logger, current, installedRuntime };
}

function loadFailure(): Error {
  return new Error("Resource not found");
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
  });

  it("recreates the runtime session when a never-prompted session fails to load", async () => {
    const { manager, sessions, logger, current, installedRuntime } = buildManager({
      transcript: [],
      responder: (method) => {
        if (method === "session/load") throw loadFailure();
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
      expect.objectContaining({ sessionId: SESSION_ID, error: "Resource not found" }),
      "session/load failed for never-prompted session; recreated runtime session via session/new",
    );
    expect(sessions.current().runtimeSessionId).toBe("runtime-session-2");
  });

  it("recreates the runtime session when the transcript holds only a run_failed marker", async () => {
    const { manager, sessions, current } = buildManager({
      transcript: [{ kind: "run_failed", message: "Resource not found" }],
      responder: (method) => {
        if (method === "session/load") throw loadFailure();
        return { sessionId: "runtime-session-2" };
      },
    });

    await manager.restartSessionForEnvironmentChange(SESSION_ID, configuration());

    expect(current.replacementRuntime!.methods()).toEqual(["session/load", "session/new"]);
    expect(sessions.current().runtimeSessionId).toBe("runtime-session-2");
  });

  it("persists the recreated runtime session id on the session record", async () => {
    const { manager, sessions } = buildManager({
      transcript: [],
      responder: (method) => {
        if (method === "session/load") throw loadFailure();
        return { sessionId: "runtime-session-2" };
      },
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
  });

  it("rethrows and retires the replacement when the transcript holds a user message", async () => {
    const { manager, sessions, current, installedRuntime } = buildManager({
      transcript: [{ kind: "user_message_chunk", text: "hello" }],
      responder: (method) => {
        if (method === "session/load") throw loadFailure();
        return { sessionId: "runtime-session-2" };
      },
    });

    await expect(manager.restartSessionForEnvironmentChange(SESSION_ID, configuration())).rejects.toThrow("Resource not found");

    const replacement = current.replacementRuntime!;
    expect(replacement.methods()).toEqual(["session/load"]);
    expect(replacement.closed).toBe(true);
    expect(current.closed).toBe(false);
    expect(installedRuntime()).toBe(current as unknown as SessionRuntime);
    expect(sessions.current().runtimeSessionId).toBe(RUNTIME_SESSION_ID);
  });

  it("rethrows when the transcript holds a tool call", async () => {
    const { manager, current } = buildManager({
      transcript: [{ kind: "tool_call", toolCallId: "tool-1", title: "ls" }],
      responder: (method) => {
        if (method === "session/load") throw loadFailure();
        return { sessionId: "runtime-session-2" };
      },
    });

    await expect(manager.restartSessionForEnvironmentChange(SESSION_ID, configuration())).rejects.toThrow("Resource not found");
    expect(current.replacementRuntime!.methods()).toEqual(["session/load"]);
  });

  it("rethrows when no transcript repository is configured", async () => {
    const { manager, current, installedRuntime } = buildManager({
      withTranscriptRepository: false,
      responder: (method) => {
        if (method === "session/load") throw loadFailure();
        return { sessionId: "runtime-session-2" };
      },
    });

    await expect(manager.restartSessionForEnvironmentChange(SESSION_ID, configuration())).rejects.toThrow("Resource not found");
    expect(current.replacementRuntime!.closed).toBe(true);
    expect(installedRuntime()).toBe(current as unknown as SessionRuntime);
  });
});
