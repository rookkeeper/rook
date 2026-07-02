import type { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import type { EnvironmentPreview } from "../../shared/environment.js";
import type { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import type {
  EnvironmentDecision,
  EnvironmentEventListener,
  EnvironmentOfferInfo,
  EnvironmentRecord,
  EffectiveDecision,
  EphemeralDecision,
} from "./types.js";

interface RememberedEnvironmentEntry {
  record: EnvironmentRecord;
  info: EnvironmentOfferInfo;
  registeredAt?: string;
  unregisteredAt?: string;
  lastTouchedAt: string;
  activeUntil?: string;
  status: "active" | "recent";
  contextText?: string;
}

export interface EnvironmentManagerOptions {
  activeEnvironmentWindowMs?: number;
  recentEnvironmentRetentionMs?: number;
  logger?: { info: (...args: any[]) => void };
  now?: () => number;
}

/**
 * Simplified environment manager.
 *
 * Current behavior:
 * - keep environments in memory as either active or recent
 * - active = touched by register within the active window and not explicitly unregistered
 * - unregister immediately moves an environment from active -> recent
 * - recent entries are retained for a second, longer TTL before being forgotten
 * - log register / unregister / expiry activity
 * - do not load skills, talk to rooms, or consult the repository during registration
 */
export class EnvironmentManager {
  private readonly remembered = new Map<string, RememberedEnvironmentEntry>();
  private readonly ephemeral = new Map<string, EphemeralDecision>();
  private readonly listeners = new Map<string, EnvironmentEventListener>();
  private readonly entered = new Map<string, Set<string>>();
  private readonly activeEnvironmentWindowMs: number;
  private readonly recentEnvironmentRetentionMs: number;
  private readonly logger: { info: (...args: any[]) => void };
  private readonly now: () => number;
  private readonly expiryTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly repositoryService: EnvironmentRepositoryService,
    private readonly decisions: EnvironmentDecisionStore,
    options: EnvironmentManagerOptions = {},
  ) {
    this.activeEnvironmentWindowMs = options.activeEnvironmentWindowMs ?? 6 * 60_000;
    this.recentEnvironmentRetentionMs = options.recentEnvironmentRetentionMs ?? 30 * 60_000;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
    this.expiryTimer = setInterval(() => this.pruneMemory(), Math.min(this.activeEnvironmentWindowMs, 60_000));
    this.expiryTimer.unref?.();
  }

  async registerAvailableEnvironment(env: EnvironmentRecord, info: EnvironmentOfferInfo = {}, contextText?: string): Promise<void> {
    this.pruneMemory();

    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const existing = this.remembered.get(env.id);
    const registeredAt = nowIso;
    const activeUntil = new Date(now + this.activeEnvironmentWindowMs).toISOString();
    const entry: RememberedEnvironmentEntry = {
      record: {
        id: env.id,
        metadata: {
          ...env.metadata,
          registeredAt,
        },
      },
      info,
      registeredAt,
      lastTouchedAt: nowIso,
      activeUntil,
      status: "active",
      ...(contextText ? { contextText } : {}),
    };
    this.remembered.set(env.id, entry);
    this.logger.info(
      {
        environmentId: env.id,
        previousStatus: existing?.status,
        registeredAt,
        activeUntil,
        sourceName: info.sourceName,
      },
      "environment registered",
    );
  }

  unregister(environmentId: string): boolean {
    this.pruneMemory();
    const existing = this.remembered.get(environmentId);
    if (!existing) return false;

    const nowIso = new Date(this.now()).toISOString();
    this.remembered.set(environmentId, {
      ...existing,
      lastTouchedAt: nowIso,
      unregisteredAt: nowIso,
      activeUntil: undefined,
      status: "recent",
    });
    this.ephemeral.delete(environmentId);
    for (const sessionId of this.listeners.keys()) {
      this.entered.get(sessionId)?.delete(environmentId);
    }
    this.logger.info(
      {
        environmentId,
        registeredAt: existing.registeredAt,
        unregisteredAt: nowIso,
      },
      "environment unregistered",
    );
    return true;
  }

  decideEnvironment(environmentId: string, decision: EnvironmentDecision): void {
    this.pruneMemory();
    if (decision === "approve" || decision === "reject") {
      this.decisions.setDecision(environmentId, decision);
      this.ephemeral.delete(environmentId);
      return;
    }
    this.ephemeral.set(environmentId, decision);
  }

  effectiveDecision(environmentId: string): EffectiveDecision {
    this.pruneMemory();
    const ephemeral = this.ephemeral.get(environmentId);
    if (ephemeral) return ephemeral;
    return this.decisions.getDecision(environmentId) ?? "undecided";
  }

  subscribe(sessionId: string, listener: EnvironmentEventListener): void {
    this.pruneMemory();
    this.listeners.set(sessionId, listener);
    if (!this.entered.has(sessionId)) this.entered.set(sessionId, new Set());
  }

  unsubscribe(sessionId: string): void {
    this.listeners.delete(sessionId);
    this.entered.delete(sessionId);
  }

  async getEnvironmentPreview(environmentId: string): Promise<EnvironmentPreview> {
    return this.repositoryService.getEnvironmentPreview(environmentId);
  }

  isAvailable(environmentId: string): boolean {
    this.pruneMemory();
    return this.remembered.get(environmentId)?.status === "active";
  }

  enteredEnvironments(sessionId: string): string[] {
    return [...(this.entered.get(sessionId) ?? [])];
  }

  close(): void {
    clearInterval(this.expiryTimer);
  }

  private pruneMemory(): void {
    const now = this.now();
    for (const [environmentId, entry] of this.remembered.entries()) {
      if (entry.status === "active") {
        const activeUntil = entry.activeUntil ? Date.parse(entry.activeUntil) : 0;
        if (activeUntil <= now) {
          this.remembered.set(environmentId, {
            ...entry,
            status: "recent",
            activeUntil: undefined,
          });
          this.ephemeral.delete(environmentId);
          this.logger.info(
            {
              environmentId,
              registeredAt: entry.registeredAt,
              lastTouchedAt: entry.lastTouchedAt,
            },
            "environment moved to recent",
          );
          continue;
        }
      }

      if (entry.status === "recent") {
        const lastTouchedAt = Date.parse(entry.lastTouchedAt);
        if (lastTouchedAt + this.recentEnvironmentRetentionMs > now) continue;
        this.remembered.delete(environmentId);
        this.ephemeral.delete(environmentId);
        this.logger.info(
          {
            environmentId,
            lastTouchedAt: entry.lastTouchedAt,
          },
          "environment forgotten",
        );
      }
    }
  }
}
