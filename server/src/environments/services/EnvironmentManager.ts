import { createHash } from "node:crypto";
import path from "node:path";
import type { EnvironmentDecisionRepository } from "../repositories/EnvironmentDecisionRepository.js";
import type { CandidateEnvironmentMetadata, EnvironmentPreview } from "../../shared/environment.js";
import type { EnvironmentBundle, EnvironmentRecord as RepositoryEnvironmentRecord } from "../../shared/environmentRepository.js";
import { hashEnvironmentBundle, type EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import {
  NoopEnvironmentRegistrationCaptureSink,
  type EnvironmentRegistrationCaptureSink,
} from "./environmentMetadataCapture.js";
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
  repository: string;
  bundleId: string;
  bundleHash: string;
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
}

export interface RuntimeEnvironmentBundle {
  environmentName: string;
  bundleName: string;
  editable: boolean;
  bundle: EnvironmentBundle;
  writeBackSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackDeleteSkill?: (skillId: string) => Promise<boolean>;
  writeBackNewSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackInstructions?: (content: string) => Promise<boolean>;
  writeBackDeleteInstructions?: () => Promise<boolean>;
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

function isUserOwnedRepository(repository: string): boolean {
  return repository === "personal" || repository === "project-directory";
}

function ephemeralPersonalBundle(environmentId: string): EnvironmentBundle {
  const hex = createHash("sha256").update(`rook-personal-bundle:${environmentId}`).digest("hex");
  const bundleId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return {
    id: `${environmentId}#${bundleId}`,
    bundleId,
    environmentId,
    repository: "personal",
    skills: [],
    mcpServers: [],
    apps: [],
    valid: true,
    errors: [],
  };
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
    decisions: EnvironmentDecisionRepository,
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
      try {
        const bundles = await this.repositoryService.getResolvedBundles(environmentId);
        if (bundles.length > 0) ids.add(environmentId);
      } catch (error) {
        // An unreadable ancestor (for example, a dangling skill symlink in
        // the user's home directory) must not prevent the observed candidate
        // itself from being registered.
        this.logger.info({ environmentId, error }, "failed to inspect implied environment");
      }
    }

    return [...ids];
  }

  private async rememberAvailableEnvironment(
    env: EnvironmentRecord,
    info: EnvironmentOfferInfo,
  ): Promise<void> {
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const existing = this.remembered.get(env.id);
    const registeredAt = existing?.status === "active" ? (existing.registeredAt ?? nowIso) : nowIso;
    const activeUntil = new Date(now + this.activeEnvironmentWindowMs).toISOString();
    const resolvedBundles = await this.repositoryService.getResolvedBundles(env.id);
    const bundles = resolvedBundles.map(({ bundle, bundleHash }) => ({
      repository: bundle.repository,
      bundleId: bundle.bundleId,
      bundleHash,
      skills: bundle.skills.map((artifact) => artifact.id).sort((a, b) => a.localeCompare(b)),
      mcpServers: bundle.mcpServers.map((artifact) => artifact.id).sort((a, b) => a.localeCompare(b)),
      apps: bundle.apps.map((artifact) => artifact.id).sort((a, b) => a.localeCompare(b)),
      agentsMd: bundle.agentsMd,
    }));
    const bundleIds = bundles.map((bundle) => bundle.bundleId);
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
      if (!bundleHash || !bundle) throw new Error("A known bundleHash is required for a permanent environment decision.");
      this.sessionDecisions.setPermanent(bundleHash, environmentId, bundle.bundleId, decision);
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

  async searchEnvironments(query: string): Promise<RepositoryEnvironmentRecord[]> {
    const normalized = query.trim().toLowerCase();
    const environments = await this.repositoryService.listEnvironments();
    if (!normalized) return environments;
    return environments.filter((environment) => [environment.id, environment.displayName, environment.description]
      .some((value) => value.toLowerCase().includes(normalized)));
  }

  async searchBundles(query: string, repositoryId?: string): Promise<EnvironmentBundle[]> {
    return this.repositoryService.searchBundles(query, repositoryId);
  }

  /** Resolves the currently approved bundle content for runtime materialization. */
  async runtimeBundlesForSession(sessionId: string): Promise<RuntimeEnvironmentBundle[]> {
    this.pruneMemory();
    const result: RuntimeEnvironmentBundle[] = [];
    for (const environmentId of this.enteredEnvironments(sessionId)) {
      const entry = this.remembered.get(environmentId);
      if (!entry || entry.status !== "active") continue;
      const resolved = await this.repositoryService.getResolvedBundles(environmentId);
      const runtimeResolved = [...resolved];
      if (!resolved.some(({ bundle }) => bundle.repository === "personal") && !environmentId.startsWith("dir:")) {
        const bundle = ephemeralPersonalBundle(environmentId);
        runtimeResolved.push({ bundle, bundleHash: hashEnvironmentBundle(bundle) });
      }
      for (const { bundle, bundleHash } of runtimeResolved) {
        const decision = this.sessionDecisions.effective(bundleHash, sessionId);
        if (!isUserOwnedRepository(bundle.repository) && decision !== "accept" && decision !== "approve") continue;
        result.push({
          environmentName: deriveEnvironmentDisplayName(environmentId, entry.record.metadata, entry.info),
          bundleName: bundle.repository === "personal" || bundle.repository === "project-directory" ? "Personal capabilities" : "Environment capabilities",
          editable: bundle.repository === "personal" || bundle.repository === "project-directory",
          ...(bundle.repository === "personal" ? {
            writeBackSkill: (skillId: string, files: Record<string, string>) => this.repositoryService.replaceCapabilityFiles(environmentId, bundle.bundleId, "skill", skillId, files, bundle.repository),
            writeBackDeleteSkill: (skillId: string) => this.repositoryService.deleteCapability(environmentId, bundle.bundleId, "skill", skillId, bundle.repository),
          } : {}),
          ...(bundle.repository === "personal" || bundle.repository === "project-directory" ? { writeBackNewSkill: (skillId: string, files: Record<string, string>) => this.repositoryService.createCapabilityFiles(environmentId, bundle.bundleId, "skill", skillId, files, bundle.repository) } : {}),
          writeBackInstructions: bundle.repository === "personal" || bundle.repository === "project-directory"
            ? (content) => this.repositoryService.replaceCapabilityFiles(environmentId, bundle.bundleId, "instructions", "AGENTS.md", { "AGENTS.md": content }, bundle.repository)
            : undefined,
          writeBackDeleteInstructions: bundle.repository === "personal"
            ? () => this.repositoryService.deleteCapability(environmentId, bundle.bundleId, "instructions", "AGENTS.md", bundle.repository)
            : undefined,
          bundle,
        });
      }
    }
    return result;
  }

  isAvailable(environmentId: string): boolean {
    this.pruneMemory();
    return this.remembered.get(environmentId)?.status === "active";
  }

  enteredEnvironments(sessionId: string): string[] {
    return [...(this.entered.get(sessionId) ?? [])];
  }

  runtimeIdentityInstructions(): string {
    return renderRookIdentityPrompt();
  }

  async restoreEnvironment(sessionId: string, environmentId: string): Promise<string[]> {
    this.pruneMemory();
    const listener = this.listeners.get(sessionId);
    if (!listener) return [];

    if (!this.remembered.has(environmentId)) {
      const environment = await this.repositoryService.getKnownEnvironment(environmentId);
      if (!environment) return this.enteredEnvironments(sessionId);
      await this.rememberAvailableEnvironment(
        { id: environment.id, metadata: environment.metadata },
        { displayName: environment.displayName },
      );
    }

    return this.enterEnvironment(sessionId, environmentId);
  }

  async enterEnvironment(sessionId: string, environmentId: string): Promise<string[]> {
    this.pruneMemory();
    const listener = this.listeners.get(sessionId);
    if (!listener) return [];

    const entry = this.remembered.get(environmentId);
    if (!entry) return [];

    await this.rememberAvailableEnvironment(entry.record, entry.info);

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

      listener.onEnvironmentEntered(environmentId, this.skillPathsForEntry(entry, sessionId));

      for (const bundle of entry.bundles) {
        if (isUserOwnedRepository(bundle.repository) || this.effectiveDecision(bundle.bundleHash, sessionId) !== "undecided") continue;
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
      if (!isUserOwnedRepository(bundle.repository) && decision !== "accept" && decision !== "approve") continue;
      skillPaths.push(...bundle.skills);
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
