import path from "node:path";
import type { EnvironmentDecisionStore } from "../datastores/EnvironmentDecisionStore.js";
import type { CandidateEnvironmentMetadata, EnvironmentPreview } from "../../shared/environment.js";
import type { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import { ensurePersonalEnvironmentBinding } from "../support/EnvironmentBinding.js";
import {
  NoopEnvironmentRegistrationCaptureSink,
  type EnvironmentRegistrationCaptureSink,
} from "./environmentMetadataCapture.js";
import { renderEnvironmentPrompt } from "../support/EnvironmentPromptTemplate.js";
import { renderRookIdentityPrompt } from "../support/RookIdentityPrompt.js";
import { SessionDecisionRegistry } from "./SessionDecisionRegistry.js";
import type {
  CandidateEnvironmentRecord,
  EnvironmentDecision,
  EnvironmentEventListener,
  EnvironmentOfferInfo,
  EnvironmentRecord,
  EffectiveDecision,
  EnvironmentResolution,
} from "../support/types.js";

interface RememberedBundleEntry {
  bundleId: string;
  bundleHash: string;
  bundlePath?: string;
  skills: string[];
  mcpServers: string[];
  apps: string[];
  agentsMd?: string;
}

interface RememberedEnvironmentEntry {
  record: EnvironmentRecord;
  info: EnvironmentOfferInfo;
  registeredAt?: string;
  lastTouchedAt: string;
  activeUntil?: string;
  status: "active" | "recent";
  bundles: RememberedBundleEntry[];
  bundleIds: string[];
  bundleCollectionPaths: string[];
}

export interface DiagnosticEnvironmentEntry {
  environmentId: string;
  status: "active" | "recent";
  record: EnvironmentRecord;
  info: EnvironmentOfferInfo;
  registeredAt?: string;
  lastTouchedAt: string;
  activeUntil?: string;
  bundles: Array<RememberedBundleEntry & { effectiveDecision: EffectiveDecision }>;
  bundleIds: string[];
  bundleCollectionPaths: string[];
  effectiveDecision: EffectiveDecision;
}

export interface EnvironmentManagerOptions {
  activeEnvironmentWindowMs?: number;
  recentEnvironmentRetentionMs?: number;
  logger?: { info: (...args: any[]) => void };
  now?: () => number;
  registrationCaptureSink?: EnvironmentRegistrationCaptureSink;
}

function environmentKind(environmentId: string): string | undefined {
  const separator = environmentId.indexOf(":");
  if (separator === -1) return undefined;
  return environmentId.slice(0, separator);
}

function environmentPath(environmentId: string): string {
  const separator = environmentId.indexOf(":");
  return separator === -1 ? environmentId : environmentId.slice(separator + 1);
}

function lastEnvironmentSegment(environmentId: string): string {
  const raw = environmentPath(environmentId);
  const parts = raw.split("/").filter(Boolean);
  return (parts.at(-1) ?? raw) || environmentId;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayMetadata(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function observationInfoFromMetadata(metadata: Record<string, unknown>): EnvironmentOfferInfo {
  const displayName = stringMetadata(metadata, "displayName");
  return displayName ? { displayName } : {};
}

function deriveEnvironmentDisplayName(environmentId: string, metadata: Record<string, unknown>, info?: EnvironmentOfferInfo): string {
  return info?.displayName ?? stringMetadata(metadata, "displayName") ?? lastEnvironmentSegment(environmentId);
}

function metadataWithoutDisplayName(metadata: CandidateEnvironmentMetadata): CandidateEnvironmentMetadata {
  const { displayName: _displayName, ...rest } = metadata;
  return rest;
}

function webEnvironmentIdsFromUrl(rawURL: string): string[] {
  let components: URL;
  try {
    components = new URL(rawURL);
  } catch {
    return [];
  }
  const scheme = components.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return [];
  const host = components.hostname.toLowerCase();
  if (!host) return [];
  const segments = components.pathname.split("/").filter(Boolean);
  const ids = [`web:${host}`];
  let current = host;
  for (const segment of segments) {
    current += `/${segment}`;
    ids.push(`web:${current}`);
  }
  return ids;
}

function dirEnvironmentIdsFromPath(rawPath: string): string[] {
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/")) return [];
  const normalized = path.posix.normalize(trimmed);
  const segments = normalized.split("/").filter(Boolean);
  const ids: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    ids.push(`dir:/${segments.slice(0, index + 1).join("/")}`);
  }
  return ids;
}

export class EnvironmentManager {
  private readonly remembered = new Map<string, RememberedEnvironmentEntry>();
  private readonly sessionDecisions: SessionDecisionRegistry;
  private readonly listeners = new Map<string, EnvironmentEventListener>();
  private readonly explicitlyEntered = new Map<string, Set<string>>();
  private readonly entered = new Map<string, Set<string>>();
  private readonly activeEnvironmentWindowMs: number;
  private readonly recentEnvironmentRetentionMs: number;
  private readonly logger: { info: (...args: any[]) => void };
  private readonly now: () => number;
  private readonly expiryTimer: ReturnType<typeof setInterval>;
  private readonly registrationCaptureSink: EnvironmentRegistrationCaptureSink;

  constructor(
    private readonly repositoryService: EnvironmentRepositoryService,
    decisions: EnvironmentDecisionStore,
    options: EnvironmentManagerOptions = {},
  ) {
    this.sessionDecisions = new SessionDecisionRegistry(decisions);
    this.activeEnvironmentWindowMs = options.activeEnvironmentWindowMs ?? 6 * 60_000;
    this.recentEnvironmentRetentionMs = options.recentEnvironmentRetentionMs ?? 30 * 60_000;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
    this.registrationCaptureSink = options.registrationCaptureSink ?? new NoopEnvironmentRegistrationCaptureSink();
    this.expiryTimer = setInterval(() => this.pruneMemory(), Math.min(this.activeEnvironmentWindowMs, 60_000));
    this.expiryTimer.unref?.();
  }

  async registerAvailableEnvironment(env: EnvironmentRecord, info: EnvironmentOfferInfo = {}): Promise<void> {
    this.pruneMemory();

    const nowIso = new Date(this.now()).toISOString();
    try {
      await this.registrationCaptureSink.capture({
        capturedAt: nowIso,
        environmentId: env.id,
        metadata: env.metadata,
      });
    } catch (error) {
      this.logger.info({ environmentId: env.id, error }, "failed to append environment metadata capture");
    }
    await this.rememberAvailableEnvironment(env, info);
  }

  async registerCandidateEnvironment(candidate: CandidateEnvironmentRecord): Promise<void> {
    this.pruneMemory();

    const nowIso = new Date(this.now()).toISOString();
    try {
      await this.registrationCaptureSink.capture({
        capturedAt: nowIso,
        environmentId: candidate.id,
        metadata: candidate.metadata,
      });
    } catch (error) {
      this.logger.info({ environmentId: candidate.id, error }, "failed to append environment metadata capture");
    }

    const finalIds = await this.finalizedEnvironmentIds(candidate);
    for (const environmentId of finalIds) {
      const metadata = environmentId === candidate.id ? candidate.metadata : metadataWithoutDisplayName(candidate.metadata);
      const info = environmentId === candidate.id ? observationInfoFromMetadata(candidate.metadata) : {};
      await this.rememberAvailableEnvironment({ id: environmentId, metadata }, info);
    }
  }

  private async finalizedEnvironmentIds(candidate: CandidateEnvironmentRecord): Promise<string[]> {
    const ids = new Set<string>([candidate.id]);
    const implied = new Set<string>();

    for (const observedPath of stringArrayMetadata(candidate.metadata, "observedPaths")) {
      for (const environmentId of dirEnvironmentIdsFromPath(observedPath)) {
        implied.add(environmentId);
      }
    }
    for (const observedUrl of stringArrayMetadata(candidate.metadata, "observedUrls")) {
      for (const environmentId of webEnvironmentIdsFromUrl(observedUrl)) {
        implied.add(environmentId);
      }
    }

    for (const environmentId of implied) {
      if (ids.has(environmentId)) continue;
      const bundles = await this.repositoryService.getResolvedBundles(environmentId);
      if (bundles.length > 0) ids.add(environmentId);
    }

    return [...ids];
  }

  private async rememberAvailableEnvironment(env: EnvironmentRecord, info: EnvironmentOfferInfo): Promise<void> {
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const existing = this.remembered.get(env.id);
    const registeredAt = existing?.status === "active" ? (existing.registeredAt ?? nowIso) : nowIso;
    const activeUntil = new Date(now + this.activeEnvironmentWindowMs).toISOString();
    const resolvedBundles = await this.repositoryService.getResolvedBundles(env.id);
    const bundles = resolvedBundles.map(({ bundle, bundleHash }) => ({
      bundleId: bundle.bundleId,
      bundleHash,
      bundlePath: bundle.bundlePath,
      skills: bundle.skills.map((artifact) => artifact.id).sort((a, b) => a.localeCompare(b)),
      mcpServers: bundle.mcpServers.map((artifact) => artifact.id).sort((a, b) => a.localeCompare(b)),
      apps: bundle.apps.map((artifact) => artifact.id).sort((a, b) => a.localeCompare(b)),
      agentsMd: bundle.agentsMd,
    }));
    const bundleIds = bundles.map((bundle) => bundle.bundleId);
    const bundleCollectionPaths = [...new Set(
      bundles
        .map((bundle) => bundle.bundlePath)
        .filter((bundlePath): bundlePath is string => Boolean(bundlePath))
        .map((bundlePath) => path.dirname(bundlePath)),
    )].sort((a, b) => a.localeCompare(b));
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
      bundles,
      bundleIds,
      bundleCollectionPaths,
    };
    this.remembered.set(env.id, entry);
    this.logger.info(
      {
        environmentId: env.id,
        previousStatus: existing?.status,
        registeredAt,
        activeUntil,
        displayName: deriveEnvironmentDisplayName(env.id, entry.record.metadata, info),
        bundleIds,
        bundleCollectionPaths,
      },
      "environment registered",
    );

    const previousBundles = existing?.status === "active" ? existing.bundles : [];
    const currentBundleHashes = new Set(bundles.map((bundle) => bundle.bundleHash));
    for (const previousBundle of previousBundles) {
      if (currentBundleHashes.has(previousBundle.bundleHash)) continue;
      this.sessionDecisions.clearAllForBundle(previousBundle.bundleHash);
      this.broadcastBundleResolution(env.id, previousBundle.bundleId, previousBundle.bundleHash, "unavailable");
    }
  }

  decideEnvironment(environmentId: string, decision: EnvironmentDecision, bundleHash?: string, sessionId?: string): void {
    this.pruneMemory();
    const decisionKey = bundleHash ?? environmentId;
    const bundle = bundleHash
      ? this.remembered.get(environmentId)?.bundles.find((candidate) => candidate.bundleHash === bundleHash)
      : undefined;

    if (decision === "approve" || decision === "reject") {
      this.sessionDecisions.setPermanent(decisionKey, environmentId, bundle?.bundleId ?? null, decision);
    } else {
      const targetSessions = sessionId
        ? [sessionId]
        : [...this.entered.entries()].filter(([, envs]) => envs.has(environmentId)).map(([sid]) => sid);
      for (const sid of targetSessions) {
        this.sessionDecisions.setSession(sid, decisionKey, decision);
      }
    }

    if (bundle) {
      this.broadcastBundleResolution(
        environmentId,
        bundle.bundleId,
        bundle.bundleHash,
        decision === "accept" || decision === "approve" ? "approved" : "dismissed",
      );
    }

    if (decision === "accept" || decision === "approve") {
      for (const [sid, entered] of this.entered.entries()) {
        if (!entered.has(environmentId)) continue;
        const listener = this.listeners.get(sid);
        if (!listener) continue;
        const entry = this.remembered.get(environmentId);
        if (!entry || entry.status !== "active") continue;
        listener.onEnvironmentEntered(environmentId, this.skillPathsForEntry(entry, sid));
      }
    }
  }

  effectiveDecision(bundleHash: string, sessionId?: string): EffectiveDecision {
    this.pruneMemory();
    return this.sessionDecisions.effective(bundleHash, sessionId);
  }

  subscribe(sessionId: string, listener: EnvironmentEventListener): void {
    this.pruneMemory();
    this.listeners.set(sessionId, listener);
    if (!this.explicitlyEntered.has(sessionId)) this.explicitlyEntered.set(sessionId, new Set());
    if (!this.entered.has(sessionId)) this.entered.set(sessionId, new Set());
  }

  unsubscribe(sessionId: string): void {
    this.listeners.delete(sessionId);
    this.explicitlyEntered.delete(sessionId);
    this.entered.delete(sessionId);
    this.sessionDecisions.clearSession(sessionId);
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

  runtimeInstructionsForSession(sessionId: string): string | undefined {
    const entries = this.enteredEnvironments(sessionId)
      .map((environmentId) => {
        const remembered = this.remembered.get(environmentId);
        const binding = ensurePersonalEnvironmentBinding(environmentId);
        if (!binding) return null;

        const agentsMdBundles = (remembered?.bundles ?? [])
          .filter((b) => b.agentsMd)
          .map((b) => ({ bundleId: b.bundleId, content: b.agentsMd! }));

        return {
          environmentId,
          displayName: remembered ? deriveEnvironmentDisplayName(environmentId, remembered.record.metadata, remembered.info) : undefined,
          metadata: (remembered?.record.metadata ?? {}) as Record<string, unknown>,
          bindingDir: binding.personalBundleDir,
          skillsDir: binding.skillsDir,
          existingSkills: binding.existingSkills,
          agentsMdBundles,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const envPrompt = renderEnvironmentPrompt(entries);
    return [renderRookIdentityPrompt(), envPrompt].filter(Boolean).join("\n\n");
  }

  enterEnvironment(sessionId: string, environmentId: string): string[] {
    this.pruneMemory();
    const listener = this.listeners.get(sessionId);
    if (!listener) return [];

    const entry = this.remembered.get(environmentId);
    if (!entry) return [];

    if (!this.explicitlyEntered.has(sessionId)) this.explicitlyEntered.set(sessionId, new Set());
    this.explicitlyEntered.get(sessionId)!.add(environmentId);

    return this.syncEnteredEnvironments(sessionId, listener);
  }

  exitEnvironment(sessionId: string, environmentId: string): string[] {
    this.pruneMemory();
    const listener = this.listeners.get(sessionId);
    if (!listener) return this.enteredEnvironments(sessionId);

    const explicit = this.explicitlyEntered.get(sessionId);
    if (!explicit?.has(environmentId)) return this.enteredEnvironments(sessionId);
    explicit.delete(environmentId);

    return this.syncEnteredEnvironments(sessionId, listener);
  }

  diagnosticSnapshot(sessionId?: string): DiagnosticEnvironmentEntry[] {
    this.pruneMemory();
    return [...this.remembered.entries()]
      .map(([environmentId, entry]) => ({
        environmentId,
        status: entry.status,
        record: entry.record,
        info: entry.info,
        registeredAt: entry.registeredAt,
        lastTouchedAt: entry.lastTouchedAt,
        activeUntil: entry.activeUntil,
        bundles: entry.bundles.map((bundle) => ({
          ...bundle,
          effectiveDecision: this.effectiveDecision(bundle.bundleHash, sessionId),
        })),
        bundleIds: entry.bundleIds,
        bundleCollectionPaths: entry.bundleCollectionPaths,
        effectiveDecision: this.effectiveDecision(environmentId, sessionId),
      }))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return a.environmentId.localeCompare(b.environmentId);
      });
  }

  environmentList(sessionId: string): {
    environmentId: string;
    displayName: string;
    status: "active" | "recent";
    lastTouchedAt: string;
    entered: boolean;
    bundleCount: number;
    approvedBundleCount: number;
  }[] {
    this.pruneMemory();
    const entered = this.entered.get(sessionId) ?? new Set();
    const entries = this.diagnosticSnapshot(sessionId);

    const list = entries.map((entry) => {
      const approved = entry.bundles.filter(
        (b) => b.effectiveDecision === "accept" || b.effectiveDecision === "approve",
      ).length;
      return {
        environmentId: entry.environmentId,
        displayName: deriveEnvironmentDisplayName(entry.environmentId, entry.record.metadata, entry.info),
        status: entry.status,
        lastTouchedAt: entry.lastTouchedAt,
        entered: entered.has(entry.environmentId),
        bundleCount: entry.bundles.length,
        approvedBundleCount: approved,
      };
    });

    list.sort((a, b) => {
      if (a.entered !== b.entered) return a.entered ? -1 : 1;
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return b.lastTouchedAt.localeCompare(a.lastTouchedAt);
    });

    return list;
  }

  private syncEnteredEnvironments(sessionId: string, listener: EnvironmentEventListener): string[] {
    if (!this.entered.has(sessionId)) this.entered.set(sessionId, new Set());
    const current = this.entered.get(sessionId)!;
    const next = new Set(this.explicitlyEntered.get(sessionId) ?? []);

    for (const environmentId of next) {
      if (current.has(environmentId)) continue;
      const entry = this.remembered.get(environmentId);
      if (!entry) continue;

      ensurePersonalEnvironmentBinding(environmentId);
      listener.onEnvironmentEntered(environmentId, this.skillPathsForEntry(entry, sessionId));

      for (const bundle of entry.bundles) {
        if (this.effectiveDecision(bundle.bundleHash, sessionId) !== "undecided") continue;
        listener.onEnvironmentOffered({
          environmentId,
          displayName: deriveEnvironmentDisplayName(environmentId, entry.record.metadata, entry.info),
          bundleId: bundle.bundleId,
          bundleHash: bundle.bundleHash,
          skills: bundle.skills,
          mcpServers: bundle.mcpServers,
          apps: bundle.apps,
        });
      }
    }

    for (const environmentId of current) {
      if (next.has(environmentId)) continue;
      listener.onEnvironmentExited(environmentId);
      const entry = this.remembered.get(environmentId);
      if (entry) {
        this.sessionDecisions.clearSessionForBundles(sessionId, entry.bundles.map((b) => b.bundleHash));
      }
    }

    this.entered.set(sessionId, next);
    return [...next];
  }

  private skillPathsForEntry(entry: RememberedEnvironmentEntry, sessionId: string): string[] {
    const skillPaths: string[] = [];
    for (const bundle of entry.bundles) {
      const decision = this.sessionDecisions.effective(bundle.bundleHash, sessionId);
      if (decision !== "accept" && decision !== "approve") continue;
      if (!bundle.bundlePath) continue;
      for (const skillId of bundle.skills) {
        skillPaths.push(path.join(bundle.bundlePath, "skills", skillId));
      }
    }
    return skillPaths;
  }

  private broadcastBundleResolution(environmentId: string, bundleId: string, bundleHash: string, resolution: EnvironmentResolution): void {
    for (const listener of this.listeners.values()) {
      listener.onEnvironmentResolved(environmentId, bundleId, bundleHash, resolution);
    }
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
          this.sessionDecisions.clearAllForBundles(entry.bundles.map((b) => b.bundleHash));
          for (const bundle of entry.bundles) {
            this.broadcastBundleResolution(environmentId, bundle.bundleId, bundle.bundleHash, "unavailable");
          }
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
        this.sessionDecisions.clearAllForBundles(entry.bundles.map((b) => b.bundleHash));
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
