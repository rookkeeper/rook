import type { EnvironmentDecision } from "../../shared/environment.js";

export type { EnvironmentDecision };

export interface EnvironmentRecord {
  id: string;
  metadata: Record<string, unknown>;
}

/** Decisions that persist across availability episodes (stored in SQLite). */
export type PersistentDecision = "approve" | "reject";

/** Decisions scoped to the current availability episode (in-memory, cleared on unavailable). */
export type EphemeralDecision = "accept" | "ignore";

/** Effective decision for an environment right now, or "undecided" if the user hasn't chosen. */
export type EffectiveDecision = EnvironmentDecision | "undecided";

/** How an offer was closed — used to dismiss prompts across every client of a room. */
export type EnvironmentResolution = "approved" | "dismissed" | "unavailable";

export interface EnvironmentOfferInfo {
  sourceName?: string;
  canonicalSourceUrl?: string;
}

/**
 * A subscribed SessionRoom's hooks into environment lifecycle. The EnvironmentManager
 * pushes these; the room turns them into runtime changes and client broadcasts.
 */
export interface EnvironmentEventListener {
  /** Available + undecided: prompt this room's clients to decide. */
  onEnvironmentOffered(environmentId: string, info: EnvironmentOfferInfo): void;
  /** Decision is accept/approve and the env is available: load skills (restart when idle). */
  onEnvironmentEntered(environmentId: string, skillPaths: string[]): void;
  /** Env left or was turned negative: remove skills (restart when idle). */
  onEnvironmentExited(environmentId: string): void;
  /** An offer was resolved (by any client, or because the env left): close prompts. */
  onEnvironmentResolved(environmentId: string, resolution: EnvironmentResolution): void;
}
