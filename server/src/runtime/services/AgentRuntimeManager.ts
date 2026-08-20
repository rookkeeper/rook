import type { AgentRuntimeProfile } from "../../infrastructure/config/agentRuntimes.js";
import type { EnvironmentManager } from "../../environments/services/EnvironmentManager.js";
import type { EnvironmentBundleOffer, EnvironmentEventListener, EnvironmentResolution } from "../../environments/support/types.js";
import type { SessionAttentionStatus, SessionRecord, SessionRepository } from "../../sessions/repositories/SessionRepository.js";
import { SessionRuntime, type JsonObject, type JsonRpcMessage, type RuntimeNotification, type SessionRuntimeConfiguration } from "../SessionRuntime.js";
import { runtimeLaunchPlan, runtimeSessionParams } from "../runtimeLaunchPlan.js";
import { CapabilityWorkspaceManager, type CapabilityWorkspaceResult } from "../CapabilityWorkspaceManager.js";

export type SessionActivityStatus = "active" | "ready" | "error" | "on" | "off";

type TurnDiagnostic = { hasActualContent: boolean; sawAutomaticRetry: boolean };

export interface AgentRuntimeManagerOptions {
  runtimeRequestTimeoutMs?: number;
  promptTimeoutMs?: number;
  cancelGraceMs?: number;
  runtimeShutdownTimeoutMs?: number;
}

const DEFAULT_RUNTIME_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CANCEL_GRACE_MS = 5_000;
const DEFAULT_RUNTIME_SHUTDOWN_TIMEOUT_MS = 1_000;

/**
 * Owns the configured runtime catalog and lazily creates one isolated
 * `SessionRuntime` per public session. A process is never shared by sessions:
 * environment-specific skills and startup instructions belong to one session.
 */
export class AgentRuntimeManager {
  private readonly profilesById: Map<string, AgentRuntimeProfile>;
  private readonly sessionRuntimes = new Map<string, SessionRuntime>();
  private readonly runtimeCreationQueues = new Map<string, Promise<SessionRuntime>>();
  private readonly runtimeStopQueues = new Map<string, Promise<void>>();
  private readonly transientRuntimes = new Set<SessionRuntime>();
  private readonly activeTurns = new Map<string, Set<number>>();
  private readonly turnDiagnostics = new Map<string, Map<number, TurnDiagnostic>>();
  private readonly turnIdleWaiters = new Map<string, Set<() => void>>();
  private nextTurnId = 0;
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
  private readonly timingLogsEnabled = process.env.ROOK_SESSION_TIMING_LOGS === "1";
  private readonly workspaceResults = new Map<string, CapabilityWorkspaceResult>();
  private readonly runtimeRequestTimeoutMs: number;
  private readonly promptTimeoutMs: number;
  private readonly cancelGraceMs: number;
  private readonly runtimeShutdownTimeoutMs: number;
  private closed = false;

  constructor(
    profiles: AgentRuntimeProfile[],
    private readonly sessions: SessionRepository,
    private readonly repoRoot: string,
    private readonly workspaceManager: CapabilityWorkspaceManager,
    private readonly environmentManager?: EnvironmentManager,
    private readonly logger: { info: (obj: Record<string, unknown>, msg?: string) => void } = console,
    options: AgentRuntimeManagerOptions = {},
  ) {
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    this.runtimeRequestTimeoutMs = options.runtimeRequestTimeoutMs ?? Number(process.env.ROOK_RUNTIME_REQUEST_TIMEOUT_MS ?? DEFAULT_RUNTIME_REQUEST_TIMEOUT_MS);
    this.promptTimeoutMs = options.promptTimeoutMs ?? Number(process.env.ROOK_RUNTIME_PROMPT_TIMEOUT_MS ?? DEFAULT_PROMPT_TIMEOUT_MS);
    this.cancelGraceMs = options.cancelGraceMs ?? Number(process.env.ROOK_RUNTIME_CANCEL_GRACE_MS ?? DEFAULT_CANCEL_GRACE_MS);
    this.runtimeShutdownTimeoutMs = options.runtimeShutdownTimeoutMs ?? Number(process.env.ROOK_RUNTIME_SHUTDOWN_TIMEOUT_MS ?? DEFAULT_RUNTIME_SHUTDOWN_TIMEOUT_MS);
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
    await this.requireSession(sessionId);
    await this.sessions.setPinned(sessionId, pinned);
    return await this.requireSession(sessionId);
  }

  async reorderPinnedSessions(sessionIds: string[]): Promise<SessionRecord[]> {
    const records = await this.sessions.list();
    const pinnedIds = records.filter((record) => record.pinned).map((record) => record.sessionId);
    if (sessionIds.length !== pinnedIds.length || new Set(sessionIds).size !== sessionIds.length || sessionIds.some((id) => !pinnedIds.includes(id))) {
      throw new Error("Pinned reorder must contain each currently pinned session exactly once.");
    }
    await this.sessions.reorderPinned(sessionIds);
    return await this.sessions.list();
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
    if ((this.activeTurns.get(sessionId)?.size ?? 0) > 0) return "active";
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
    this.transientRuntimes.add(runtime);
    const beforeRuntimeSessionNew = performance.now();
    try {
      const result = await this.requestWithTimeout(runtime, "session/new", runtimeSessionParams(profile, { ...params, cwd: workspace.root }, runtime.configuration), this.runtimeRequestTimeoutMs);
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
        pinnedOrder: 0,
      };
      await this.sessions.save(record);
      this.transientRuntimes.delete(runtime);
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
    } catch (error) {
      await runtime.close();
      await this.workspaceManager.removeSession(sessionId);
      throw error;
    }
  }

  async requestForSession(sessionId: string, method: string, params: JsonObject, options: { privateReplayListener?: RuntimeNotification } = {}): Promise<unknown> {
    const startedAt = performance.now();
    const record = await this.requireSession(sessionId);
    await this.restoreEnvironmentMembership(record);
    const runtime = await this.runtimeFor(record);
    const runtimeParams =
      method === "session/load"
        ? { cwd: record.cwd, mcpServers: [], ...params, sessionId: record.runtimeSessionId }
        : { ...params, sessionId: record.runtimeSessionId };
    const privateReplay = method === "session/load" && options.privateReplayListener;
    const isPrompt = method === "session/prompt";
    if (privateReplay) this.beginPrivateReplay(sessionId, options.privateReplayListener!);
    let turnId: number | undefined;
    if (isPrompt) {
      await this.sessions.touch(sessionId);
      turnId = this.beginTurn(sessionId);
    }
    let promptOutcome: SessionAttentionStatus | undefined;
    try {
      const result = await this.requestWithTimeout(
        runtime,
        method,
        runtimeSessionParams(runtime.profile, runtimeParams, runtime.configuration),
        isPrompt ? this.promptTimeoutMs : this.runtimeRequestTimeoutMs,
      );
      if (method === "session/prompt") {
        const diagnostic = turnId === undefined ? undefined : this.turnDiagnostics.get(sessionId)?.get(turnId);
        if (diagnostic?.sawAutomaticRetry && !diagnostic.hasActualContent) {
          throw new Error("Runtime retries exhausted before producing a response.");
        }
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
      if (turnId !== undefined) await this.finishTurn(sessionId, turnId, promptOutcome ?? "error");
      if (privateReplay) this.endPrivateReplay(sessionId);
    }
  }

  async notifyForSession(sessionId: string, method: string, params: JsonObject): Promise<void> {
    const record = await this.requireSession(sessionId);
    await this.restoreEnvironmentMembership(record);
    const runtime = await this.runtimeFor(record);
    await runtime.notify(method, { ...params, sessionId: record.runtimeSessionId });
    await this.sessions.touch(sessionId);
  }

  async cancelSession(sessionId: string, params: JsonObject = {}): Promise<void> {
    const record = await this.requireSession(sessionId);
    await this.restoreEnvironmentMembership(record);
    const runtime = await this.runtimeFor(record);
    try {
      await withTimeout(
        runtime.notify("session/cancel", { ...params, sessionId: record.runtimeSessionId }),
        this.runtimeRequestTimeoutMs,
        `session/cancel timed out after ${this.runtimeRequestTimeoutMs}ms`,
      );
      await this.sessions.touch(sessionId);
    } catch (error) {
      await this.hardStopRuntime(sessionId, runtime, "cancel_write_failed", error);
      return;
    }
    if (this.activeTurnCount(sessionId) === 0) return;
    const settled = await this.waitForTurnsIdle(sessionId, this.cancelGraceMs);
    if (!settled && this.sessionRuntimes.get(sessionId) === runtime) {
      await this.hardStopRuntime(sessionId, runtime, "cancel_timeout", new Error("Runtime did not settle after cancellation."));
    }
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
    const current = await this.runtimeFor(record);
    const replacement = current.replacement(configuration);
    try {
      const result = await this.requestWithTimeout(
        replacement,
        "session/load",
        runtimeSessionParams(replacement.profile, { sessionId: record.runtimeSessionId, cwd: record.cwd, mcpServers: [] }, configuration),
        this.runtimeRequestTimeoutMs,
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
        result = await this.requestWithTimeout(runtime, "session/close", { sessionId: record.runtimeSessionId }, this.runtimeRequestTimeoutMs);
      } catch (error) {
        this.logger.info({ sessionId, error: error instanceof Error ? error.message : String(error) }, "runtime did not accept session/close; terminating runtime directly");
      } finally {
        await runtime.close();
      }
    }
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
    if (this.closed) return;
    this.closed = true;
    await this.workspaceManager.assessAndFlush();
    for (const unsubscribe of this.runtimeSubscriptions.values()) unsubscribe();
    this.runtimeSubscriptions.clear();
    const runtimes = new Set([...this.sessionRuntimes.values(), ...this.transientRuntimes]);
    await Promise.all([...runtimes].map((runtime) => runtime.close()));
    await Promise.all([...this.runtimeStopQueues.values()]);
    await Promise.all([...this.workspaceResults.keys()].map((sessionId) => this.workspaceManager.removeSession(sessionId)));
    this.sessionRuntimes.clear();
    this.transientRuntimes.clear();
    this.runtimeCreationQueues.clear();
    this.runtimeStopQueues.clear();
    this.activeTurns.clear();
    this.turnDiagnostics.clear();
    this.turnIdleWaiters.clear();
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

  private async runtimeFor(record: SessionRecord): Promise<SessionRuntime> {
    if (this.closed) throw new Error("Rook runtime manager is closed");
    const existing = this.sessionRuntimes.get(record.sessionId);
    if (existing?.isStarted) return existing;
    const queued = this.runtimeCreationQueues.get(record.sessionId);
    if (queued) return queued;
    const creation = Promise.resolve().then(async () => {
      await this.runtimeStopQueues.get(record.sessionId);
      if (this.closed) throw new Error("Rook runtime manager is closed");
      const current = this.sessionRuntimes.get(record.sessionId);
      if (current?.isStarted) return current;
      const workspace = this.workspaceResults.get(record.sessionId);
      const runtime = this.createSessionRuntime(this.requireProfile(record.runtimeId), {
        ...this.baseRuntimeConfiguration(),
        ...(workspace ? { workspaceRoot: workspace.root } : {}),
      });
      if (current) this.replaceSessionRuntime(record.sessionId, runtime);
      else this.attachSessionRuntime(record.sessionId, runtime);
      this.subscribeToEnvironments(record.sessionId);
      return runtime;
    });
    this.runtimeCreationQueues.set(record.sessionId, creation);
    try {
      return await creation;
    } finally {
      if (this.runtimeCreationQueues.get(record.sessionId) === creation) this.runtimeCreationQueues.delete(record.sessionId);
    }
  }

  private createSessionRuntime(profile: AgentRuntimeProfile, configuration: SessionRuntimeConfiguration = this.baseRuntimeConfiguration()): SessionRuntime {
    return new SessionRuntime(profile, this.repoRoot, runtimeLaunchPlan, configuration, this.logger, { shutdownTimeoutMs: this.runtimeShutdownTimeoutMs });
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
      this.observeTurnNotification(sessionId, message);
      let outbound = rewriteMessageSessionId(message, sessionId);
      if (typeof message.id === "string" || typeof message.id === "number") {
        const requestId = publicRuntimeRequestId(sessionId, message.id);
        this.inboundRequestRoutes.set(requestId, runtime);
        outbound = { ...outbound, id: requestId };
      }
      const privateTargets = this.privateReplayTargets.get(sessionId);
      if (privateTargets && privateTargets.size > 0) {
        for (const listener of privateTargets) listener(outbound);
        return;
      }
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
    this.turnDiagnostics.delete(sessionId);
    this.viewedSessions.delete(sessionId);
    this.subscribers.delete(sessionId);
    this.privateReplayTargets.delete(sessionId);
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
  }

  private endPrivateReplay(sessionId: string): void {
    this.privateReplayTargets.delete(sessionId);
  }

  private beginTurn(sessionId: string): number {
    const turnId = ++this.nextTurnId;
    const active = this.activeTurns.get(sessionId) ?? new Set<number>();
    active.add(turnId);
    this.activeTurns.set(sessionId, active);
    const diagnostics = this.turnDiagnostics.get(sessionId) ?? new Map<number, TurnDiagnostic>();
    diagnostics.set(turnId, { hasActualContent: false, sawAutomaticRetry: false });
    this.turnDiagnostics.set(sessionId, diagnostics);
    return turnId;
  }

  private async finishTurn(sessionId: string, turnId: number, outcome: SessionAttentionStatus): Promise<void> {
    const active = this.activeTurns.get(sessionId);
    if (!active?.delete(turnId)) return;
    this.turnDiagnostics.get(sessionId)?.delete(turnId);
    if (active.size > 0) return;
    this.activeTurns.delete(sessionId);
    this.turnDiagnostics.delete(sessionId);
    this.resolveTurnIdleWaiters(sessionId);
    await this.sessions.setAttentionStatus(sessionId, this.viewedSessions.has(sessionId) ? "clear" : outcome);
  }

  private activeTurnCount(sessionId: string): number {
    return this.activeTurns.get(sessionId)?.size ?? 0;
  }

  private waitForTurnsIdle(sessionId: string, timeoutMs: number): Promise<boolean> {
    if (this.activeTurnCount(sessionId) === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiters = this.turnIdleWaiters.get(sessionId) ?? new Set<() => void>();
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        waiters.delete(onIdle);
        if (waiters.size === 0) this.turnIdleWaiters.delete(sessionId);
        resolve(value);
      };
      const onIdle = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      waiters.add(onIdle);
      this.turnIdleWaiters.set(sessionId, waiters);
    });
  }

  private resolveTurnIdleWaiters(sessionId: string): void {
    for (const waiter of this.turnIdleWaiters.get(sessionId) ?? []) waiter();
  }

  private async requestWithTimeout(runtime: SessionRuntime, method: string, params: JsonObject, timeoutMs: number): Promise<unknown> {
    try {
      return await withTimeout(runtime.request(method, params), timeoutMs, `${method} timed out after ${timeoutMs}ms`);
    } catch (error) {
      if (error instanceof RuntimeTimeoutError) {
        const sessionId = this.sessionIdForRuntime(runtime);
        if (sessionId) await this.hardStopRuntime(sessionId, runtime, "request_timeout", error);
      }
      throw error;
    }
  }

  private sessionIdForRuntime(runtime: SessionRuntime): string | undefined {
    for (const [sessionId, candidate] of this.sessionRuntimes) if (candidate === runtime) return sessionId;
    return undefined;
  }

  private async hardStopRuntime(sessionId: string, runtime: SessionRuntime, reason: string, error: unknown): Promise<void> {
    const stop = runtime.close();
    this.runtimeStopQueues.set(sessionId, stop);
    if (this.sessionRuntimes.get(sessionId) === runtime) {
      this.runtimeSubscriptions.get(sessionId)?.();
      this.runtimeSubscriptions.delete(sessionId);
      this.sessionRuntimes.delete(sessionId);
      for (const [requestId, candidate] of this.inboundRequestRoutes) {
        if (candidate === runtime) this.inboundRequestRoutes.delete(requestId);
      }
    }
    this.activeTurns.delete(sessionId);
    this.turnDiagnostics.delete(sessionId);
    this.resolveTurnIdleWaiters(sessionId);
    await this.sessions.setAttentionStatus(sessionId, "error");
    try {
      await stop;
    } finally {
      if (this.runtimeStopQueues.get(sessionId) === stop) this.runtimeStopQueues.delete(sessionId);
    }
    this.logger.info({ sessionId, reason, error: error instanceof Error ? error.message : String(error) }, "runtime hard-stopped");
  }

  private observeTurnNotification(sessionId: string, message: JsonRpcMessage): void {
    const diagnostics = this.turnDiagnostics.get(sessionId);
    if (!diagnostics || diagnostics.size === 0) return;
    const params = object(message.params);
    const update = object(params?.update);
    const kind = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : "";
    if (kind === "agent_message_chunk") {
      const text = contentText(update?.content);
      for (const diagnostic of diagnostics.values()) {
        if (text && isAutomaticRetryStatus(text)) diagnostic.sawAutomaticRetry = true;
        else if (text?.trim()) diagnostic.hasActualContent = true;
      }
      return;
    }
    if (kind === "agent_thought_chunk" || kind === "tool_call" || kind === "tool_call_update" || kind === "plan") {
      for (const diagnostic of diagnostics.values()) diagnostic.hasActualContent = true;
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

class RuntimeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RuntimeTimeoutError(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
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

function isAutomaticRetryStatus(text: string): boolean {
  const normalized = text.trim();
  return normalized === "Retrying..." || normalized === "Retry finished, resuming." || (normalized.startsWith("Retrying (attempt ") && normalized.endsWith(")..."));
}

function contentText(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(contentText).filter((text): text is string => Boolean(text)).join("") || undefined;
  const item = object(value);
  return item?.type === "text" && typeof item.text === "string" ? item.text : undefined;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function rewriteMessageSessionId(message: JsonRpcMessage, sessionId: string): JsonRpcMessage {
  const params = message.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return message;
  return { ...message, params: { ...(params as JsonObject), sessionId } };
}
