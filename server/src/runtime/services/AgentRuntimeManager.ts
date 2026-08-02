import path from "node:path";
import type { AgentRuntimeProfile } from "../../infrastructure/config/agentRuntimes.js";
import type { EnvironmentManager } from "../../environments/services/EnvironmentManager.js";
import type { EnvironmentBundleOffer, EnvironmentEventListener, EnvironmentResolution } from "../../environments/support/types.js";
import type { SessionRecord, SessionRepository } from "../../sessions/repositories/SessionRepository.js";
import { SessionRuntime, type JsonObject, type JsonRpcMessage, type RuntimeNotification, type SessionRuntimeConfiguration } from "../SessionRuntime.js";
import { runtimeLaunchPlan, runtimeSessionParams } from "../runtimeLaunchPlan.js";
import { SessionTranscriptStore } from "../../sessions/services/SessionTranscriptStore.js";
import { normalizedEventsFromRuntimeMessage, runCompletedEvent, runFailedEvent } from "../../sessions/services/sessionTranscriptEvents.js";
import { AgentWorkspaceMaterializer, type AgentWorkspaceResult } from "../AgentWorkspaceMaterializer.js";

/**
 * Owns the configured runtime catalog and lazily creates one isolated
 * `SessionRuntime` per public session. A process is never shared by sessions:
 * environment-specific skills and startup instructions belong to one session.
 */
export class AgentRuntimeManager {
  private readonly profilesById: Map<string, AgentRuntimeProfile>;
  private readonly sessionRuntimes = new Map<string, SessionRuntime>();
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
  private readonly workspaceMaterializer = new AgentWorkspaceMaterializer();
  private readonly workspaceResults = new Map<string, AgentWorkspaceResult>();

  constructor(
    profiles: AgentRuntimeProfile[],
    private readonly sessions: SessionRepository,
    private readonly repoRoot: string,
    private readonly environmentManager?: EnvironmentManager,
    private readonly transcriptStore?: SessionTranscriptStore,
    private readonly logger: { info: (obj: Record<string, unknown>, msg?: string) => void } = console,
  ) {
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  }

  runtimeIds(): string[] {
    return [...this.profilesById.keys()];
  }

  runtimeDefinitions(): Array<Pick<AgentRuntimeProfile, "id" | "type" | "parentId" | "model">> {
    return this.runtimeIds().map((id) => {
      const profile = this.profilesById.get(id)!;
      return {
        id: profile.id,
        type: profile.type,
        ...(profile.parentId !== undefined ? { parentId: profile.parentId } : {}),
        ...(profile.model ? { model: profile.model } : {}),
      };
    });
  }

  defaultRuntimeId(): string | undefined {
    return this.runtimeIds()[0];
  }

  async listSessions(): Promise<SessionRecord[]> {
    return this.sessions.list();
  }

  async createSession(runtimeId: string, params: JsonObject, title: string): Promise<SessionRecord> {
    const startedAt = performance.now();
    const profile = this.requireProfile(runtimeId);
    this.timingLog("create_session_begin", { runtimeId, title, cwd: typeof params.cwd === "string" ? params.cwd : this.repoRoot });
    const runtime = this.createSessionRuntime(profile);
    const beforeRuntimeSessionNew = performance.now();
    const result = await runtime.request("session/new", runtimeSessionParams(profile, params, runtime.configuration));
    const runtimeSessionId = sessionIdFromResult(result);
    const now = new Date().toISOString();
    const record: SessionRecord = {
      sessionId: crypto.randomUUID(),
      runtimeId,
      runtimeSessionId,
      title,
      cwd: typeof params.cwd === "string" ? params.cwd : this.repoRoot,
      startedAt: now,
      updatedAt: now,
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
      method === "session/load" || method === "session/resume"
        ? { cwd: record.cwd, mcpServers: [], ...params, sessionId: record.runtimeSessionId }
        : { ...params, sessionId: record.runtimeSessionId };
    const privateReplay = (method === "session/load" || method === "session/resume") && options.privateReplayListener;
    if (privateReplay) this.beginPrivateReplay(sessionId, options.privateReplayListener!);
    try {
      const result = await runtime.request(method, runtimeSessionParams(runtime.profile, runtimeParams, runtime.configuration));
      if (method === "session/prompt") {
        const stopReason = typeof (result as JsonObject | undefined)?.stopReason === "string" ? String((result as JsonObject).stopReason) : "end_turn";
        await this.transcriptStore?.append(sessionId, runCompletedEvent(stopReason));
        await this.syncWorkspace(sessionId);
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
      if (method === "session/prompt") {
        await this.transcriptStore?.append(sessionId, runFailedEvent(error instanceof Error ? error.message : String(error)));
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
    for (const environmentId of enterEnvironmentIds) this.environmentManager.enterEnvironment(sessionId, environmentId);
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

  async closeSession(sessionId: string): Promise<unknown> {
    const record = await this.requireSession(sessionId);
    await this.syncWorkspace(sessionId);
    const runtime = this.runtimeFor(record);
    const result = await runtime.request("session/close", { sessionId: record.runtimeSessionId });
    await runtime.close();
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
    return this.sessionRuntimes.has(sessionId);
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.runtimeSubscriptions.values()) unsubscribe();
    this.runtimeSubscriptions.clear();
    await Promise.all([...this.sessionRuntimes.values()].map((runtime) => runtime.close()));
    this.sessionRuntimes.clear();
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
    if (existing) return existing;
    const runtime = this.createSessionRuntime(this.requireProfile(record.runtimeId));
    this.attachSessionRuntime(record.sessionId, runtime);
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
    this.restoredEnvironmentMembership.add(record.sessionId);
    for (const environmentId of await this.sessions.environmentIds(record.sessionId)) {
      this.environmentManager.enterEnvironment(record.sessionId, environmentId);
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
      await this.syncWorkspace(sessionId);
      const paths = this.environmentSkillPaths.get(sessionId);
      const workspaceRoot = path.join(this.repoRoot, ".var", "rook", "agent-workspaces", sessionId);
      const runtimeBundles = await this.environmentManager?.runtimeBundlesForSession(sessionId) ?? [];
      const materialized = await this.workspaceMaterializer.materialize(workspaceRoot, runtimeBundles);
      this.workspaceResults.set(sessionId, materialized);
      const promptParts = [
        this.environmentManager?.runtimeInstructionsForSession(sessionId, materialized.root),
        materialized.agentsContent.trim(),
      ].filter((value): value is string => Boolean(value));
      const configuration: SessionRuntimeConfiguration = {
        enteredEnvironmentIds: [...(paths?.keys() ?? [])],
        skillPaths: materialized.skillPaths,
        extensionPaths: [],
        appendSystemPrompt: promptParts.join("\\n\\n"),
      };
      await this.restartSessionForEnvironmentChange(sessionId, configuration);
    };
    const previous = this.environmentRestartQueues.get(sessionId) ?? Promise.resolve();
    const queued = previous.then(restart, restart);
    this.environmentRestartQueues.set(sessionId, queued);
  }

  private async syncWorkspace(sessionId: string): Promise<void> {
    const workspace = this.workspaceResults.get(sessionId);
    if (!workspace) return;
    try {
      await this.workspaceMaterializer.syncWritableChanges(workspace);
    } catch (error) {
      this.logger.info({ component: "AgentRuntimeManager", sessionId, error: error instanceof Error ? error.message : String(error) }, "workspace write-back failed");
    }
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

  private async captureTranscriptEvents(sessionId: string, message: JsonRpcMessage): Promise<void> {
    for (const event of normalizedEventsFromRuntimeMessage(message)) {
      await this.transcriptStore?.append(sessionId, event);
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
