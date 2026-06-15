import type { LocalEnvironmentRepository } from "./LocalEnvironmentRepository.js";
import type { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import type { SkillPreview } from "../../shared/environment.js";
import type {
  EnvironmentDecision,
  EnvironmentEventListener,
  EnvironmentOfferInfo,
  EnvironmentRecord,
  EffectiveDecision,
  EphemeralDecision,
} from "./types.js";

interface AvailableEnvironment {
  record: EnvironmentRecord;
  skillPaths: string[];
  info: EnvironmentOfferInfo;
}

/**
 * Service-layer coordinator for the environment model (see the brainstorm doc).
 *
 * Three orthogonal concepts:
 *  - **available** — global, in-memory: an env is currently "around" (provider says so).
 *  - **decision** — per-environment, global: the 2×2 (accept/approve/ignore/reject).
 *      Ephemeral (accept/ignore) is in-memory and cleared when the env leaves; persistent
 *      (approve/reject) lives in the decision store. Ephemeral overrides persistent.
 *  - **entered** — per-session, derived: a room has an env iff it's available AND the
 *      effective decision is accept/approve.
 *
 * The manager never touches runtimes or sockets; it pushes lifecycle calls to subscribed
 * SessionRooms (the listeners), which load/unload skills and fan out to clients.
 */
export class EnvironmentManager {
  private readonly available = new Map<string, AvailableEnvironment>();
  private readonly ephemeral = new Map<string, EphemeralDecision>();
  private readonly listeners = new Map<string, EnvironmentEventListener>();
  private readonly entered = new Map<string, Set<string>>();

  constructor(
    private readonly repository: LocalEnvironmentRepository,
    private readonly decisions: EnvironmentDecisionStore,
  ) {}

  // --- Availability lifecycle -------------------------------------------------

  /** A provider reports the user is now "in" this environment. Applies to all open rooms. */
  async registerAvailableEnvironment(env: EnvironmentRecord, info: EnvironmentOfferInfo = {}): Promise<void> {
    const skillPaths = await this.repository.getSkillPaths(env.id);
    this.available.set(env.id, { record: env, skillPaths, info });
    for (const sessionId of this.listeners.keys()) {
      this.applyEnvironmentToSession(sessionId, env.id);
    }
  }

  /** A provider reports the environment is gone (e.g. the page closed). Ends the episode. */
  markUnavailable(environmentId: string): boolean {
    if (!this.available.has(environmentId)) return false;
    this.available.delete(environmentId);
    this.ephemeral.delete(environmentId);
    for (const sessionId of this.listeners.keys()) {
      const listener = this.listeners.get(sessionId)!;
      this.exitForSession(sessionId, environmentId);
      listener.onEnvironmentResolved(environmentId, "unavailable");
    }
    return true;
  }

  // --- Decisions (the 2×2) ----------------------------------------------------

  /** Record a decision (global, from any client) and re-apply it to every open room. */
  decideEnvironment(environmentId: string, decision: EnvironmentDecision): void {
    if (decision === "approve" || decision === "reject") {
      this.decisions.setDecision(environmentId, decision);
      this.ephemeral.delete(environmentId);
    } else {
      this.ephemeral.set(environmentId, decision);
    }

    const resolution = decision === "accept" || decision === "approve" ? "approved" : "dismissed";
    for (const sessionId of this.listeners.keys()) {
      this.applyEnvironmentToSession(sessionId, environmentId);
      this.listeners.get(sessionId)!.onEnvironmentResolved(environmentId, resolution);
    }
  }

  /** Effective decision: ephemeral (this-visit) overrides persistent (approve/reject). */
  effectiveDecision(environmentId: string): EffectiveDecision {
    const ephemeral = this.ephemeral.get(environmentId);
    if (ephemeral) return ephemeral;
    return this.decisions.getDecision(environmentId) ?? "undecided";
  }

  // --- Subscriptions (one per SessionRoom) ------------------------------------

  subscribe(sessionId: string, listener: EnvironmentEventListener): void {
    this.listeners.set(sessionId, listener);
    if (!this.entered.has(sessionId)) this.entered.set(sessionId, new Set());
    for (const environmentId of this.available.keys()) {
      this.applyEnvironmentToSession(sessionId, environmentId);
    }
  }

  unsubscribe(sessionId: string): void {
    this.listeners.delete(sessionId);
    this.entered.delete(sessionId);
  }

  // --- Reads ------------------------------------------------------------------

  async getSkillPreviews(environmentId: string): Promise<SkillPreview[]> {
    return this.repository.getSkillPreviews(environmentId);
  }

  isAvailable(environmentId: string): boolean {
    return this.available.has(environmentId);
  }

  enteredEnvironments(sessionId: string): string[] {
    return [...(this.entered.get(sessionId) ?? [])];
  }

  // --- Internal ---------------------------------------------------------------

  /** Resolve what should happen for one env in one session, per its effective decision. */
  private applyEnvironmentToSession(sessionId: string, environmentId: string): void {
    const listener = this.listeners.get(sessionId);
    const available = this.available.get(environmentId);
    if (!listener || !available) return;

    switch (this.effectiveDecision(environmentId)) {
      case "approve":
      case "accept":
        this.enterForSession(sessionId, environmentId, available);
        break;
      case "ignore":
      case "reject":
        this.exitForSession(sessionId, environmentId);
        break;
      case "undecided":
        listener.onEnvironmentOffered(environmentId, available.info);
        break;
    }
  }

  private enterForSession(sessionId: string, environmentId: string, available: AvailableEnvironment): void {
    const set = this.entered.get(sessionId)!;
    if (set.has(environmentId)) return;
    set.add(environmentId);
    this.listeners.get(sessionId)!.onEnvironmentEntered(environmentId, available.skillPaths);
  }

  private exitForSession(sessionId: string, environmentId: string): void {
    const set = this.entered.get(sessionId);
    if (!set?.has(environmentId)) return;
    set.delete(environmentId);
    this.listeners.get(sessionId)!.onEnvironmentExited(environmentId);
  }
}
