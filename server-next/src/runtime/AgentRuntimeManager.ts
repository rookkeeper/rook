import path from "node:path";
import type { AgentRuntimeProfile } from "../config/agentProfiles.js";
import { AgentRuntime } from "./AgentRuntime.js";
import { SessionRegistry } from "./SessionRegistry.js";
import type { JsonObject, JsonRpcMessage, SessionRecord } from "./types.js";

export type ClientMessageSink = (message: JsonRpcMessage) => void;

export class AgentRuntimeManager {
  private readonly profilesById: Map<string, AgentRuntimeProfile>;
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly sessionSinks = new Map<string, Set<ClientMessageSink>>();
  readonly sessions: SessionRegistry;

  constructor(
    profiles: AgentRuntimeProfile[],
    private readonly repoRoot: string,
  ) {
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    this.sessions = new SessionRegistry(path.join(repoRoot, ".var", "rook-next", "sessions.json"));
  }

  runtimeIds(): string[] {
    return [...this.profilesById.keys()];
  }

  defaultRuntimeId(): string | undefined {
    return this.runtimeIds()[0];
  }

  listSessions(): SessionRecord[] {
    return this.sessions.list();
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  subscribe(sessionId: string, sink: ClientMessageSink): () => void {
    let sinks = this.sessionSinks.get(sessionId);
    if (!sinks) {
      sinks = new Set();
      this.sessionSinks.set(sessionId, sinks);
    }
    sinks.add(sink);
    return () => {
      sinks?.delete(sink);
      if (sinks?.size === 0) this.sessionSinks.delete(sessionId);
    };
  }

  async createSession(runtimeId: string, params: JsonObject, title: string): Promise<SessionRecord> {
    const runtime = await this.runtime(runtimeId);
    const result = await runtime.request("session/new", runtime.sessionParams(params)) as { sessionId?: unknown };
    if (typeof result?.sessionId !== "string" || result.sessionId.length === 0) {
      throw new Error(`Runtime ${runtimeId} returned no sessionId`);
    }
    const sessionId = `${runtimeId}:${result.sessionId}`;
    const now = new Date().toISOString();
    const record: SessionRecord = {
      sessionId,
      runtimeId,
      runtimeSessionId: result.sessionId,
      cwd: typeof params.cwd === "string" ? params.cwd : this.repoRoot,
      title,
      startedAt: now,
      updatedAt: now,
    };
    this.sessions.save(record);
    return record;
  }

  async requestForSession(sessionId: string, method: string, params: JsonObject): Promise<unknown> {
    const record = this.requireSession(sessionId);
    const runtime = await this.runtime(record.runtimeId);
    const runtimeParams = { ...params, sessionId: record.runtimeSessionId };
    const result = await runtime.request(method, runtime.sessionParams(runtimeParams, method));
    this.sessions.touch(sessionId);
    return result;
  }

  async notifyForSession(sessionId: string, method: string, params: JsonObject): Promise<void> {
    const record = this.requireSession(sessionId);
    const runtime = await this.runtime(record.runtimeId);
    await runtime.notify(method, { ...params, sessionId: record.runtimeSessionId });
    this.sessions.touch(sessionId);
  }

  async close(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close()));
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session: ${sessionId}`);
    return record;
  }

  private async runtime(runtimeId: string): Promise<AgentRuntime> {
    const profile = this.profilesById.get(runtimeId);
    if (!profile) throw new Error(`Unknown runtime: ${runtimeId}`);
    let runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      runtime = new AgentRuntime(profile, this.repoRoot);
      runtime.onNotification((message) => this.forwardRuntimeNotification(runtimeId, message));
      this.runtimes.set(runtimeId, runtime);
    }
    await runtime.initialize();
    return runtime;
  }

  private forwardRuntimeNotification(runtimeId: string, message: JsonRpcMessage): void {
    if (!("method" in message) || message.method !== "session/update") return;
    const params = message.params;
    if (!params || typeof params.sessionId !== "string") return;
    const publicSessionId = `${runtimeId}:${params.sessionId}`;
    const update = params.update;
    if (update && typeof update === "object" && !Array.isArray(update)) {
      const updateObject = update as Record<string, unknown>;
      if (updateObject.sessionUpdate === "session_info_update") this.sessions.updateInfo(publicSessionId, updateObject);
      else this.sessions.touch(publicSessionId);
    }
    const outward: JsonRpcMessage = {
      ...message,
      params: { ...params, sessionId: publicSessionId },
    };
    for (const sink of this.sessionSinks.get(publicSessionId) ?? []) sink(outward);
  }
}
