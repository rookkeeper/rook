import type { AgentRuntimeProfile } from "../../infrastructure/config/agentRuntimes.js";
import type { EnvironmentManager } from "../../environments/services/EnvironmentManager.js";
import type { EnvironmentBundleOffer, EnvironmentEventListener, EnvironmentResolution } from "../../environments/support/types.js";
import type { SessionAttentionStatus, SessionRecord, SessionRepository } from "../../sessions/repositories/SessionRepository.js";
import { SessionRuntime, type JsonObject, type JsonRpcMessage, type RuntimeNotification, type SessionRuntimeConfiguration } from "../SessionRuntime.js";
import { runtimeLaunchPlan, runtimeSessionParams } from "../runtimeLaunchPlan.js";
import { SessionTranscriptRepository } from "../../sessions/repositories/SessionTranscriptRepository.js";
import { normalizedEventsFromRuntimeMessage, runCompletedEvent, runFailedEvent } from "../../sessions/services/sessionTranscriptEvents.js";
import { CapabilityWorkspaceManager, type CapabilityWorkspaceResult } from "../CapabilityWorkspaceManager.js";

export type SessionActivityStatus = "active" | "ready" | "error" | "on" | "off";

/**
 * Owns the configured runtime catalog and lazily creates one isolated
 * `SessionRuntime` per public session. A process is never shared by sessions:
 * environment-specific skills and startup instructions belong to one session.
 */
export class AgentRuntimeManager {
  private readonly profilesById: Map<string, AgentRuntimeProfile>;
  private readonly sessionRuntimes = new Map<string, SessionRuntime>();
  private readonly activeTurns = new Map<string, number>();
  private readonly viewedSessions = new Set<string>();
  private readonly subscribers = new Map<string, Map<RuntimeNotification, { environmentOffers: boolean }>>();
  private readonly unresolvedOffers = new Map<string, Map<string, EnvironmentBundleOffer>>();
  private readonly runtimeSubscriptions = new Map<string, () => void>();
  private readonly inboundRequestRoutes = new Map<string, SessionRuntime>();
  private readonly environmentSubscriptions = new Set<string>();
  private readonly restoredEnvironmentMembership = new Set<string>();
  private readonly environmentSkillPaths = new Map<string, Map<string, string[]>>();
  private readonly environmentRestartQueues = new Map<string, Promise<void>>();
  private readonly privateReplayTargets = new Map<string, Set<RuntimeNotification>>();
  private readonly privateReplayIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly privateReplayWaiters = new Map<string, Set<() => void>>();
  private readonly timingLogsEnabled = process.env.ROOK_SESSION_TIMING_LOGS === "1";
  private readonly workspaceResults = new Map<string, CapabilityWorkspaceResult>();

  constructor(
    profiles: AgentRuntimeProfile[],
    private readonly sessions: SessionRepository,
    private readonly repoRoot: string,
    private readonly workspaceManager: CapabilityWorkspaceManager,
    private readonly environmentManager?: EnvironmentManager,
    private readonly transcriptRepository?: SessionTranscriptRepository,
    private readonly logger: { info: (obj: Record<string, unknown>, msg?: string) => void } = console,
  ) {
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  }

  runtimeIds(): string[] {
    return [...this.profilesById.keys()];
  }

  runtimeDefinitions(): Array<Pick<AgentRuntimeProfile, "id" | "type" | "parentId" | "model"> & { supportsImagePrompts: boolean }> {
    return this.runtimeIds().map((id) => {
      const profile = this.profilesById.get(id)!;
      return {
        id: profile.id,
        type: profile.type,
        ...(profile.parentId !== undefined ? { parentId: profile.parentId } : {}),
        ...(profile.model ? { model: profile.model } : {}),
        supportsImagePrompts: supportsImagePrompts(profile),
      };
    });
  }

  supportsImagePrompts(runtimeId: string): boolean {
    return supportsImagePrompts(this.requireProfile(runtimeId));
  }

  async sessionPromptCapabilities(sessionId: string): Promise<{ image: boolean }> {
    const record = await this.requireSession(sessionId);
    return { image: this.supportsImagePrompts(record.runtimeId) };
  }

  defaultRuntimeId(): string | undefined {
    return this.runtimeIds()[0];
  }

  async listSessions(): Promise<SessionRecord[]> {
    return this.sessions.list();
  }

  async getSession(sessionId: string): Promise<SessionRecord> {
    return this.requireSession(sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<SessionRecord> {
    const record = await this.requireSession(sessionId);
    const normalizedTitle = title.trim() || "session";
    await this.sessions.rename(sessionId, normalizedTitle);
    return { ...record, title: normalizedTitle };
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<SessionRecord> {
    const record = await this.requireSession(sessionId);
    await this.sessions.setPinned(sessionId, pinned);
    return { ...record, pinned };
  }

  async touchSession(sessionId: string): Promise<SessionRecord> {
    await this.requireSession(sessionId);
    const updatedAt = new Date().toISOString();
    await this.sessions.touch(sessionId, updatedAt);
    await this.sessions.setAttentionStatus(sessionId, "clear");
    this.viewedSessions.add(sessionId);
    return await this.requireSession(sessionId);
  }

  async unviewSession(sessionId: string): Promise<void> {
    await this.requireSession(sessionId);
    this.viewedSessions.delete(sessionId);
  }

  activityStatus(sessionId: string, record?: SessionRecord): SessionActivityStatus {
    if ((this.activeTurns.get(sessionId) ?? 0) > 0) return "active";
    const attentionStatus = record?.attentionStatus ?? "clear";
    if (attentionStatus === "ready" || attentionStatus === "error") return attentionStatus;
    return this.sessionHasRuntime(sessionId) ? "on" : "off";
  }

  async createSession(runtimeId: string, params: JsonObject, title: string): Promise<SessionRecord> {
    const startedAt = performance.now();
    const profile = this.requireProfile(runtimeId);
    const sessionId = crypto.randomUUID();
    const workspace = await this.workspaceManager.materialize(sessionId, []);
    this.workspaceResults.set(sessionId, workspace);
    this.timingLog("create_session_begin", { runtimeId, title, cwd: workspace.root });
    const runtime = this.createSessionRuntime(profile, { ...this.baseRuntimeConfiguration(), workspaceRoot: workspace.root });
    const beforeRuntimeSessionNew = performance.now();
    const result = await runtime.request("session/new", runtimeSessionParams(profile, { ...params, cwd: workspace.root }, runtime.configuration));
    const runtimeSessionId = sessionIdFromResult(result);
    const now = new Date().toISOString();
    const record: SessionRecord = {
      sessionId,
      runtimeId,
      runtimeSessionId,
      title,
      cwd: workspace.root,
      startedAt: now,
      updatedAt: now,
      attentionStatus: "clear",
      pinned: false,
    };
    await this.sessions.save(record);
    this.attachSessionRuntime(record.sessionId, runtime);
    this.subscribeToEnvironments(record.sessionId);
    this.timingLog("create_session_complete", {
      runtimeId,
      sessionId: record.sessionId,
      runtimeSessionId,
      runtimeSessionNewMs: roundMs(performance.now() - beforeRuntimeSessionNew),
      totalMs: roundMs(performance.now() - startedAt),
    });
    return record;
  }

  async requestForSession(sessionId: string, method: string, params: JsonObject, options: { privateReplayListener?: RuntimeNotification } = {}): Promise<unknown> {
    const startedAt = performance.now();
    const record = await this.requireSession(sessionId);
    await this.restoreEnvironmentMembership(record);
    const runtime = this.runtimeFor(record);
    const runtimeParams =
      method === "session/load"
        ? { cwd: record.cwd, mcpServers: [], ...params, sessionId: record.runtimeSessionId }
        : { ...params, sessionId: record.runtimeSessionId };
    const privateReplay = method === "session/load" && options.privateReplayListener;
    const isPrompt = method === "session/prompt";
    if (privateReplay) this.beginPrivateReplay(sessionId, options.privateReplayListener!);
    if (isPrompt) {
      await this.sessions.touch(sessionId);
      this.beginTurn(sessionId);
    }
    let promptOutcome: SessionAttentionStatus | undefined;
    try {
      const result = await runtime.request(method, runtimeSessionParams(runtime.profile, runtimeParams, runtime.configuration));
      if (method === "session/prompt") {
        const stopReason = typeof (result as JsonObject | undefined)?.stopReason === "string" ? String((result as JsonObject).stopReason) : "end_turn";
        await this.transcriptRepository?.append(sessionId, runCompletedEvent(stopReason));
        await this.workspaceManager.assessAndFlush();
        promptOutcome = "ready";
      }
      await this.sessions.touch(sessionId);
      this.timingLog("request_complete", {
        method,
        sessionId,
        runtimeId: record.runtimeId,
        elapsedMs: roundMs(performance.now() - startedAt),
      });
      return rewriteResultSessionId(record, result);
    } catch (error) {
      if (isPrompt) {
        await this.transcriptRepository?.append(sessionId, runFailedEvent(error instanceof Error ? error.message : String(error)));
        promptOutcome = "error";
      }
      this.timingLog("request_failed", {
        method,
        sessionId,
        runtimeId: record.runtimeId,
        elapsedMs: roundMs(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (isPrompt) await this.finishTurn(sessionId, promptOutcome ?? "error");
      if (privateReplay) await this.endPrivateReplayAfterQuiet(sessionId);
    }
  }

  async notifyForSession(sessionId: string, method: string, params: JsonObject): Promise<void> {
    const record = await this.requireSession(sessionId);
    await this.restoreEnvironmentMembership(record);
    const runtime = this.runtimeFor(record);
    await runtime.notify(method, { ...params, sessionId: record.runtimeSessionId });
    await this.sessions.touch(sessionId);
  }

  /**
   * Atomically applies session-specific environment launch state. The old
   * process remains usable until a replacement has successfully loaded the
   * exact same ACP session; loading failure never creates a fresh session.
   */
  /** Applies an explicit non-ACP enter/leave request for one session. */
  async applyEnvironmentChange(sessionId: string, enterEnvironmentIds: string[], leaveEnvironmentIds: string[]): Promise<string[]> {
    if (!this.environmentManager) throw new Error("Environment manager is not configured.");
    await this.requireSession(sessionId);
    this.subscribeToEnvironments(sessionId);
    for (const environmentId of leaveEnvironmentIds) this.environmentManager.exitEnvironment(sessionId, environmentId);
    for (const environmentId of enterEnvironmentIds) await this.environmentManager.enterEnvironment(sessionId, environmentId);
    await this.environmentRestartQueues.get(sessionId);
    const entered = this.environmentManager.enteredEnvironments(sessionId);
    await this.sessions.replaceEnvironmentIds(sessionId, entered);
    return entered;
  }

  async resolveEnvironmentOffer(sessionId: string, environmentId: string, bundleHash: string, decision: "accept" | "approve" | "ignore" | "reject"): Promise<void> {
    if (!this.environmentManager) throw new Error("Environment manager is not configured.");
    await this.requireSession(sessionId);
    const offer = this.unresolvedOffers.get(sessionId)?.get(bundleHash);
    if (!offer || offer.environmentId !== environmentId) throw new Error("Unknown or resolved environment offer.");
    this.environmentManager.decideEnvironment(environmentId, decision, bundleHash, sessionId);
  }

  async restartSessionForEnvironmentChange(sessionId: string, configuration: SessionRuntimeConfiguration): Promise<void> {
    const record = await this.requireSession(sessionId);
    const current = this.runtimeFor(record);
    const replacement = current.replacement(configuration);
    try {
      const result = await replacement.request(
        "session/load",
        runtimeSessionParams(replacement.profile, { sessionId: record.runtimeSessionId, cwd: record.cwd, mcpServers: [] }, configuration),
      );
      if (typeof result === "object" && result !== null && "sessionId" in result && (result as JsonObject).sessionId !== record.runtimeSessionId) {
        throw new Error("ACP session/load returned a different session ID; refusing to replace session runtime.");
      }
    } catch (error) {
      await replacement.close();
      throw error;
    }

    this.replaceSessionRuntime(sessionId, replacement);
    await current.close();
    await this.sessions.touch(sessionId);
  }

  async deleteSession(sessionId: string): Promise<unknown> {
    const record = await this.requireSession(sessionId);
    await this.workspaceManager.assessAndFlush();
    let result: unknown = { ok: true };
    const runtime = this.sessionRuntimes.get(record.sessionId);
    if (runtime) {
      // ACP runtimes are not required to implement session/close. The server
      // owns the public session lifecycle, so terminating the per-session
      // runtime must not be blocked by an optional/unsupported ACP method.
      try {
        result = await runtime.request("session/close", { sessionId: record.runtimeSessionId });
      } catch (error) {
        this.logger.info({ sessionId, error: error instanceof Error ? error.message : String(error) }, "runtime did not accept session/close; terminating runtime directly");
      } finally {
        await runtime.close();
      }
    }
    await this.transcriptRepository?.clear(sessionId);
    await this.workspaceManager.removeSession(sessionId);
    this.detachSessionRuntime(sessionId);
    await this.sessions.delete(sessionId);
    return result;
  }

  /** Relay a standard ACP response to an ACP request initiated by a runtime. */
  respondToRuntime(message: JsonRpcMessage): boolean {
    const id = message.id;
    if (typeof id !== "string") return false;
    const runtime = this.inboundRequestRoutes.get(id);
    if (!runtime) return false;
    this.inboundRequestRoutes.delete(id);
    runtime.respond({ ...message, id: originalRuntimeRequestId(id) });
    return true;
  }

  subscribe(sessionId: string, listener: RuntimeNotification, options: { environmentOffers?: boolean } = {}): () => void {
    const listeners = this.subscribers.get(sessionId) ?? new Map<RuntimeNotification, { environmentOffers: boolean }>();
    listeners.set(listener, { environmentOffers: options.environmentOffers === true });
    this.subscribers.set(sessionId, listeners);
    if (options.environmentOffers) {
      for (const offer of this.unresolvedOffers.get(sessionId)?.values() ?? []) listener(environmentOfferMessage(sessionId, offer));
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.subscribers.delete(sessionId);
    };
  }

  sessionHasRuntime(sessionId: string): boolean {
    return this.sessionRuntimes.get(sessionId)?.isAlive === true;
  }

  async close(): Promise<void> {
    await this.workspaceManager.assessAndFlush();
    for (const unsubscribe of this.runtimeSubscriptions.values()) unsubscribe();
    this.runtimeSubscriptions.clear();
    await Promise.all([...this.sessionRuntimes.values()].map((runtime) => runtime.close()));
    await Promise.all([...this.workspaceResults.keys()].map((sessionId) => this.workspaceManager.removeSession(sessionId)));
    this.sessionRuntimes.clear();
    this.activeTurns.clear();
    this.viewedSessions.clear();
    this.inboundRequestRoutes.clear();
    if (this.environmentManager) {
      for (const sessionId of this.environmentSubscriptions) this.environmentManager.unsubscribe(sessionId);
    }
    this.environmentSubscriptions.clear();
    this.environmentSkillPaths.clear();
    this.environmentRestartQueues.clear();
    this.restoredEnvironmentMembership.clear();
    this.workspaceResults.clear();
  }

  private runtimeFor(record: SessionRecord): SessionRuntime {
    const existing = this.sessionRuntimes.get(record.sessionId);
    if (existing?.isStarted) return existing;
    const workspace = this.workspaceResults.get(record.sessionId);
    const runtime = this.createSessionRuntime(this.requireProfile(record.runtimeId), {
      ...this.baseRuntimeConfiguration(),
      ...(workspace ? { workspaceRoot: workspace.root } : {}),
    });
    if (existing) this.replaceSessionRuntime(record.sessionId, runtime);
    else this.attachSessionRuntime(record.sessionId, runtime);
    this.subscribeToEnvironments(record.sessionId);
    return runtime;
  }

  private createSessionRuntime(profile: AgentRuntimeProfile, configuration: SessionRuntimeConfiguration = this.baseRuntimeConfiguration()): SessionRuntime {
    return new SessionRuntime(profile, this.repoRoot, runtimeLaunchPlan, configuration, this.logger);
  }

  private baseRuntimeConfiguration(): SessionRuntimeConfiguration {
    return {
      enteredEnvironmentIds: [],
      skillPaths: [],
      extensionPaths: [],
      ...(this.environmentManager ? { appendSystemPrompt: this.environmentManager.runtimeIdentityInstructions() } : {}),
    };
  }

  private attachSessionRuntime(sessionId: string, runtime: SessionRuntime): void {
    this.sessionRuntimes.set(sessionId, runtime);
    if (this.runtimeSubscriptions.has(sessionId)) return;
    this.runtimeSubscriptions.set(sessionId, runtime.onNotification((message) => {
      let outbound = rewriteMessageSessionId(message, sessionId);
      if (typeof message.id === "string" || typeof message.id === "number") {
        const requestId = publicRuntimeRequestId(sessionId, message.id);
        this.inboundRequestRoutes.set(requestId, runtime);
        outbound = { ...outbound, id: requestId };
      }
      const privateTargets = this.privateReplayTargets.get(sessionId);
      if (privateTargets && privateTargets.size > 0) {
        this.bumpPrivateReplayIdle(sessionId);
        for (const listener of privateTargets) listener(outbound);
        return;
      }
      void this.captureTranscriptEvents(sessionId, outbound);
      for (const listener of this.subscribers.get(sessionId)?.keys() ?? []) listener(outbound);
    }));
  }

  private replaceSessionRuntime(sessionId: string, replacement: SessionRuntime): void {
    this.runtimeSubscriptions.get(sessionId)?.();
    this.runtimeSubscriptions.delete(sessionId);
    this.sessionRuntimes.set(sessionId, replacement);
    this.attachSessionRuntime(sessionId, replacement);
  }

  private detachSessionRuntime(sessionId: string): void {
    this.runtimeSubscriptions.get(sessionId)?.();
    this.runtimeSubscriptions.delete(sessionId);
    this.sessionRuntimes.delete(sessionId);
    this.activeTurns.delete(sessionId);
    this.viewedSessions.delete(sessionId);
    this.subscribers.delete(sessionId);
    this.privateReplayTargets.delete(sessionId);
    const timer = this.privateReplayIdleTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.privateReplayIdleTimers.delete(sessionId);
    const waiters = this.privateReplayWaiters.get(sessionId) ?? new Set<() => void>();
    for (const waiter of waiters) waiter();
    this.privateReplayWaiters.delete(sessionId);
    if (this.environmentManager && this.environmentSubscriptions.delete(sessionId)) this.environmentManager.unsubscribe(sessionId);
    this.environmentSkillPaths.delete(sessionId);
    this.environmentRestartQueues.delete(sessionId);
    this.restoredEnvironmentMembership.delete(sessionId);
    this.workspaceResults.delete(sessionId);
  }

  private subscribeToEnvironments(sessionId: string): void {
    if (!this.environmentManager || this.environmentSubscriptions.has(sessionId)) return;
    this.environmentSubscriptions.add(sessionId);
    const listener: EnvironmentEventListener = {
      onEnvironmentOffered: (offer: EnvironmentBundleOffer) => this.publishEnvironmentOffer(sessionId, offer),
      onEnvironmentResolved: (environmentId: string, bundleId: string, bundleHash: string, resolution: EnvironmentResolution) => this.publishEnvironmentOfferResolution(sessionId, environmentId, bundleId, bundleHash, resolution),
      onEnvironmentEntered: (environmentId, skillPaths) => this.updateEnvironmentState(sessionId, environmentId, skillPaths),
      onEnvironmentExited: (environmentId) => this.removeEnvironmentState(sessionId, environmentId),
    };
    this.environmentManager.subscribe(sessionId, listener);
  }

  private publishEnvironmentOffer(sessionId: string, offer: EnvironmentBundleOffer): void {
    const offers = this.unresolvedOffers.get(sessionId) ?? new Map<string, EnvironmentBundleOffer>();
    offers.set(offer.bundleHash, offer);
    this.unresolvedOffers.set(sessionId, offers);
    for (const [listener, capabilities] of this.subscribers.get(sessionId) ?? []) {
      if (capabilities.environmentOffers) listener(environmentOfferMessage(sessionId, offer));
    }
  }

  private publishEnvironmentOfferResolution(sessionId: string, environmentId: string, bundleId: string, bundleHash: string, resolution: EnvironmentResolution): void {
    this.unresolvedOffers.get(sessionId)?.delete(bundleHash);
    const message: JsonRpcMessage = { jsonrpc: "2.0", method: "_com.rookkeeper/environment_offer_resolved", params: { sessionId, environmentId, bundleId, bundleHash, resolution } };
    for (const [listener, capabilities] of this.subscribers.get(sessionId) ?? []) {
      if (capabilities.environmentOffers) listener(message);
    }
  }

  private async restoreEnvironmentMembership(record: SessionRecord): Promise<void> {
    if (!this.environmentManager || this.restoredEnvironmentMembership.has(record.sessionId)) return;
    this.subscribeToEnvironments(record.sessionId);
    if (!this.workspaceResults.has(record.sessionId)) {
      this.workspaceResults.set(record.sessionId, await this.workspaceManager.materialize(record.sessionId, []));
    }
    this.restoredEnvironmentMembership.add(record.sessionId);
    for (const environmentId of await this.sessions.environmentIds(record.sessionId)) {
      await this.environmentManager.enterEnvironment(record.sessionId, environmentId);
    }
    await this.environmentRestartQueues.get(record.sessionId);
  }

  private updateEnvironmentState(sessionId: string, environmentId: string, skillPaths: string[]): void {
    const paths = this.environmentSkillPaths.get(sessionId) ?? new Map<string, string[]>();
    paths.set(environmentId, skillPaths);
    this.environmentSkillPaths.set(sessionId, paths);
    this.scheduleEnvironmentRestart(sessionId);
  }

  private removeEnvironmentState(sessionId: string, environmentId: string): void {
    this.environmentSkillPaths.get(sessionId)?.delete(environmentId);
    this.scheduleEnvironmentRestart(sessionId);
  }

  private scheduleEnvironmentRestart(sessionId: string): void {
    const restart = async () => {
      await this.workspaceManager.assessAndFlush();
      const paths = this.environmentSkillPaths.get(sessionId);
      const runtimeBundles = await this.environmentManager?.runtimeBundlesForSession(sessionId) ?? [];
      const materialized = await this.workspaceManager.materialize(sessionId, runtimeBundles);
      this.workspaceResults.set(sessionId, materialized);
      const configuration: SessionRuntimeConfiguration = {
        enteredEnvironmentIds: [...(paths?.keys() ?? [])],
        skillPaths: [],
        extensionPaths: [],
        workspaceRoot: materialized.root,
        appendSystemPrompt: this.environmentManager?.runtimeIdentityInstructions(),
      };
      await this.restartSessionForEnvironmentChange(sessionId, configuration);
    };
    const previous = this.environmentRestartQueues.get(sessionId) ?? Promise.resolve();
    const queued = previous.then(restart, restart);
    this.environmentRestartQueues.set(sessionId, queued);
  }


  private beginPrivateReplay(sessionId: string, listener: RuntimeNotification): void {
    const listeners = this.privateReplayTargets.get(sessionId) ?? new Set<RuntimeNotification>();
    listeners.add(listener);
    this.privateReplayTargets.set(sessionId, listeners);
    this.bumpPrivateReplayIdle(sessionId);
  }

  private bumpPrivateReplayIdle(sessionId: string): void {
    const existing = this.privateReplayIdleTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.privateReplayIdleTimers.set(sessionId, setTimeout(() => {
      this.privateReplayTargets.delete(sessionId);
      this.privateReplayIdleTimers.delete(sessionId);
      const waiters = this.privateReplayWaiters.get(sessionId) ?? new Set<() => void>();
      for (const waiter of waiters) waiter();
      this.privateReplayWaiters.delete(sessionId);
    }, 80));
  }

  private async endPrivateReplayAfterQuiet(sessionId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const waiters = this.privateReplayWaiters.get(sessionId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.privateReplayWaiters.set(sessionId, waiters);
      if (!this.privateReplayIdleTimers.has(sessionId)) {
        this.privateReplayTargets.delete(sessionId);
        this.privateReplayWaiters.delete(sessionId);
        resolve();
        return;
      }
      this.bumpPrivateReplayIdle(sessionId);
    });
  }

  private beginTurn(sessionId: string): void {
    this.activeTurns.set(sessionId, (this.activeTurns.get(sessionId) ?? 0) + 1);
  }

  private async finishTurn(sessionId: string, outcome: SessionAttentionStatus): Promise<void> {
    const remaining = (this.activeTurns.get(sessionId) ?? 1) - 1;
    if (remaining > 0) {
      this.activeTurns.set(sessionId, remaining);
      return;
    }
    this.activeTurns.delete(sessionId);
    await this.sessions.setAttentionStatus(sessionId, this.viewedSessions.has(sessionId) ? "clear" : outcome);
  }

  private async captureTranscriptEvents(sessionId: string, message: JsonRpcMessage): Promise<void> {
    for (const event of normalizedEventsFromRuntimeMessage(message)) {
      await this.transcriptRepository?.append(sessionId, event);
    }
  }

  private requireProfile(runtimeId: string): AgentRuntimeProfile {
    const profile = this.profilesById.get(runtimeId);
    if (!profile) throw new Error(`Unknown configured runtime: ${runtimeId}`);
    return profile;
  }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const record = await this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session: ${sessionId}`);
    return record;
  }

  private timingLog(event: string, details: Record<string, unknown>): void {
    if (!this.timingLogsEnabled) return;
    this.logger.info({ component: "AgentRuntimeManager", event, ...details }, "session timing");
  }
}

function supportsImagePrompts(profile: AgentRuntimeProfile): boolean {
  return profile.promptCapabilities?.image ?? profile.type === "pi";
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function sessionIdFromResult(value: unknown): string {
  if (typeof value !== "object" || value === null || typeof (value as JsonObject).sessionId !== "string") {
    throw new Error("ACP session/new did not return a sessionId.");
  }
  return (value as JsonObject).sessionId as string;
}

function rewriteResultSessionId(record: SessionRecord, result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  const value = result as JsonObject;
  return value.sessionId === record.runtimeSessionId ? { ...value, sessionId: record.sessionId } : result;
}

function publicRuntimeRequestId(sessionId: string, requestId: string | number): string {
  return `rook-runtime-request:${encodeURIComponent(sessionId)}:${encodeURIComponent(String(requestId))}`;
}

function originalRuntimeRequestId(publicId: string): string | number {
  const value = publicId.split(":").slice(2).join(":");
  const decoded = decodeURIComponent(value);
  return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
}

function environmentOfferMessage(sessionId: string, offer: EnvironmentBundleOffer): JsonRpcMessage {
  return { jsonrpc: "2.0", method: "_com.rookkeeper/environment_offer", params: { sessionId, ...offer } };
}

function rewriteMessageSessionId(message: JsonRpcMessage, sessionId: string): JsonRpcMessage {
  const params = message.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return message;
  return { ...message, params: { ...(params as JsonObject), sessionId } };
}
