import { createHash } from "node:crypto";
import { guardedFetch, type GuardedFetchOptions, type GuardedFetchResult } from "../../infrastructure/http/guardedFetch.js";
import type { BundleArtifact, EnvironmentBundle, RepositoryReadError } from "../../shared/environmentRepository.js";
import {
  normalizeHost,
  WEB_BUNDLE_ID,
  webEnvironmentIdForHost,
  type WebEnvironmentRepository,
  type WebScoutStatus,
  type WebScoutValidators,
} from "../repositories/WebEnvironmentRepository.js";
import { parseAgentSkillsDiscoveryIndex, type DiscoverySkillEntry } from "./agentSkillsDiscoveryIndex.js";

/**
 * Probes a website for the agent-facing resources it publishes and records the result
 * through `WebEnvironmentRepository`, which is the only writer into the web store.
 *
 * One pass fetches `/llms.txt`, `/AGENTS.md`, and the Agent Skills discovery index
 * concurrently (conditionally, when the store holds validators), fetches and
 * digest-verifies each `skill-md` the index lists, and records everything found as one
 * `site` bundle. Fetch and content problems become `errors` on the recorded scout rather
 * than exceptions: only a host that could never be scouted (a programmer error) throws.
 *
 * Nothing here decides when to scout — the caller triggers a pass and the repository's
 * TTL check answers whether the stored entry is still fresh.
 */

const WEB_REPOSITORY_ID = "web";
const DAY_MS = 24 * 60 * 60_000;

/** Store keys for the three host-rooted resources, and the paths they are fetched from. */
const RESOURCES = [
  { key: "llms.txt", path: "/llms.txt" },
  { key: "AGENTS.md", path: "/AGENTS.md" },
  { key: "skills-index", path: "/.well-known/agent-skills/index.json" },
] as const;

type ResourceKey = (typeof RESOURCES)[number]["key"];

/** Concurrent skill fetches per scout pass; small so one site cannot monopolize egress. */
const SKILL_FETCH_CONCURRENCY = 4;

export type WebScoutOutcome = {
  /** 'fresh' means the stored entry was still within its TTL and nothing was fetched. */
  status: "fresh" | "scouted";
  changed: boolean;
};

/** The slice of a pino-style logger the scout uses. */
export interface WebScoutLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export type GuardedFetcher = (url: string, options: GuardedFetchOptions) => Promise<GuardedFetchResult>;

export interface WebEnvironmentScoutOptions {
  repository: WebEnvironmentRepository;
  /** Injectable for tests; defaults to the guarded fetch helper. */
  fetch?: GuardedFetcher;
  now?: () => number;
  logger?: WebScoutLogger;
  /** How long a scouted host stays fresh (default 24 h). */
  ttlMs?: number;
  /** Shorter TTL for a host whose last scout failed (default 15 min). */
  errorTtlMs?: number;
  /** Deadline for one fetch, which covers DNS, redirects, and the body read. */
  requestTimeoutMs?: number;
  /** Most skills taken from one discovery index (default 20). */
  maxSkills?: number;
}

const NO_OP_LOGGER: WebScoutLogger = { info: () => {}, warn: () => {}, debug: () => {} };

export class WebEnvironmentScout {
  private readonly repository: WebEnvironmentRepository;
  private readonly fetch: GuardedFetcher;
  private readonly now: () => number;
  private readonly logger: WebScoutLogger;
  private readonly ttlMs: number;
  private readonly errorTtlMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxSkills: number;
  /** Per-host guard so concurrent visits to one site share a single pass. */
  private readonly inFlight = new Map<string, Promise<WebScoutOutcome>>();

  constructor(options: WebEnvironmentScoutOptions) {
    this.repository = options.repository;
    this.fetch = options.fetch ?? guardedFetch;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? NO_OP_LOGGER;
    this.ttlMs = options.ttlMs ?? DAY_MS;
    this.errorTtlMs = options.errorTtlMs ?? 15 * 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxSkills = options.maxSkills ?? 20;
  }

  /**
   * Scouts one host, skipping the fetch when the stored entry is still fresh (unless
   * `force`). Concurrent calls for the same host share one pass and one outcome.
   */
  async scout(host: string, options: { force?: boolean } = {}): Promise<WebScoutOutcome> {
    const normalized = normalizeHost(host);
    if (!normalized) throw new Error(`Invalid web scout host: ${host}`);
    const requests = RESOURCES.map((resource) => ({ key: resource.key, url: resourceUrl(normalized, resource.path) }));

    const running = this.inFlight.get(normalized);
    if (running) return running;
    const pass = this.runScout(normalized, requests, options.force === true)
      .finally(() => this.inFlight.delete(normalized));
    this.inFlight.set(normalized, pass);
    return pass;
  }

  private async runScout(host: string, requests: { key: ResourceKey; url: string }[], force: boolean): Promise<WebScoutOutcome> {
    const environmentId = webEnvironmentIdForHost(host);
    const state = this.repository.getScoutState(host);
    if (!force && !this.repository.isStale(host, { ttlMs: this.ttlMs, errorTtlMs: this.errorTtlMs, now: this.now() })) {
      this.logger.debug({ host, fetchedAt: state?.fetchedAt }, "web scout skipped, entry still fresh");
      return { status: "fresh", changed: false };
    }
    const storedValidators = state?.validators ?? {};

    const results = await Promise.all(requests.map(async (request) => {
      const validators = storedValidators[request.key];
      try {
        return await this.fetch(request.url, {
          timeoutMs: this.requestTimeoutMs,
          ...(validators?.etag ? { ifNoneMatch: validators.etag } : {}),
          ...(validators?.lastModified ? { ifModifiedSince: validators.lastModified } : {}),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return { kind: "error", reason: "network", message } satisfies GuardedFetchResult;
      }
    }));
    const byKey = new Map(requests.map((request, index) => [request.key, { url: request.url, result: results[index]! }]));

    const errors: RepositoryReadError[] = [];
    const fetchedAt = new Date(this.now()).toISOString();

    // A host that answered nothing at all is a failed look, not knowledge: record the
    // failure and let the repository keep whatever content it already had.
    if (results.every((result) => result.kind === "error")) {
      for (const request of requests) {
        const result = byKey.get(request.key)!.result;
        if (result.kind === "error") errors.push(unreachable(environmentId, request.url, result.message));
      }
      const { changed } = this.repository.recordScout({ host, fetchedAt, status: "error", validators: {}, bundle: null, errors });
      return this.finish(host, "error", changed, { errors: errors.length });
    }

    const stored = await this.storedBundle(environmentId, state !== null);
    const validators: Record<string, WebScoutValidators> = {};
    let nothingNew = true;

    const readText = (key: "llms.txt" | "AGENTS.md", storedValue: string | undefined): string | undefined => {
      const { url, result } = byKey.get(key)!;
      const outcome = this.interpretText(key, url, result, storedValue, storedValidators[key], environmentId, errors);
      if (outcome.validators) validators[key] = outcome.validators;
      if (!outcome.nothingNew) nothingNew = false;
      return outcome.value;
    };
    const llmsTxt = readText("llms.txt", stored?.llmsTxt);
    const agentsMd = readText("AGENTS.md", stored?.agentsMd);

    const skillsIndex = byKey.get("skills-index")!;
    const scoutedSkills = await this.readSkills(
      skillsIndex.url,
      skillsIndex.result,
      stored?.skills ?? [],
      storedValidators["skills-index"],
      environmentId,
      errors,
    );
    const skills = scoutedSkills.skills;
    if (scoutedSkills.validators) validators["skills-index"] = scoutedSkills.validators;
    if (!scoutedSkills.nothingNew) nothingNew = false;

    const hasContent = llmsTxt !== undefined || agentsMd !== undefined || skills.length > 0;
    if (!hasContent) {
      const { changed } = this.repository.recordScout({ host, fetchedAt, status: "empty", validators, bundle: null, errors });
      return this.finish(host, "empty", changed, { errors: errors.length });
    }

    // Everything either revalidated or was already known: keep the stored rows and only
    // move the timestamp, the validators, and the errors.
    const revalidated = nothingNew && stored !== null;
    const bundle = revalidated ? null : buildBundle(environmentId, host, llmsTxt, agentsMd, skills);
    const { changed } = this.repository.recordScout({ host, fetchedAt, status: "content", validators, bundle, errors });
    return this.finish(host, "content", changed, {
      llmsTxt: llmsTxt !== undefined,
      agentsMd: agentsMd !== undefined,
      skills: skills.length,
      errors: errors.length,
      revalidated,
    });
  }

  private finish(host: string, status: WebScoutStatus, changed: boolean, details: Record<string, unknown>): WebScoutOutcome {
    this.logger.info({ host, status, changed, ...details }, "scouted web environment");
    return { status: "scouted", changed };
  }

  /** The host's currently stored bundle, read at most once per pass. */
  private async storedBundle(environmentId: string, scouted: boolean): Promise<EnvironmentBundle | null> {
    if (!scouted) return null;
    const result = await this.repository.getBundles(environmentId);
    return result.bundles[0] ?? null;
  }

  private interpretText(
    key: "llms.txt" | "AGENTS.md",
    url: string,
    result: GuardedFetchResult,
    stored: string | undefined,
    storedValidators: WebScoutValidators | undefined,
    environmentId: string,
    errors: RepositoryReadError[],
  ): { value?: string; validators?: WebScoutValidators; nothingNew: boolean } {
    switch (result.kind) {
      case "ok": {
        const text = normalizeText(result.body);
        // Static hosts mislabel content types, so the body decides; an SPA fallback that
        // serves index.html for every path must never become a capability.
        if (text === undefined || looksLikeHtml(text)) {
          if (text !== undefined) {
            errors.push({
              code: "invalid_bundle_contents",
              message: `${url} returned an HTML document instead of ${key}`,
              repository: WEB_REPOSITORY_ID,
              environmentId,
              bundleId: WEB_BUNDLE_ID,
              url,
            });
          }
          return { nothingNew: stored === undefined };
        }
        return { value: text, validators: validatorsOf(result.etag, result.lastModified), nothingNew: false };
      }
      case "not_modified":
        return {
          value: stored,
          validators: mergeValidators(storedValidators, validatorsOf(result.etag, result.lastModified)),
          nothingNew: true,
        };
      case "absent":
        return { nothingNew: stored === undefined };
      case "error":
        // A transient failure must not cost the site content it already published.
        errors.push(unreachable(environmentId, url, result.message));
        return { value: stored, validators: storedValidators, nothingNew: true };
    }
  }

  private async readSkills(
    url: string,
    result: GuardedFetchResult,
    stored: BundleArtifact[],
    storedValidators: WebScoutValidators | undefined,
    environmentId: string,
    errors: RepositoryReadError[],
  ): Promise<{ skills: BundleArtifact[]; validators?: WebScoutValidators; nothingNew: boolean }> {
    switch (result.kind) {
      case "not_modified":
        // The index is unchanged, so the skills it lists are too: no per-skill refetch.
        return { skills: stored, validators: mergeValidators(storedValidators, validatorsOf(result.etag, result.lastModified)), nothingNew: true };
      case "absent":
        return { skills: [], nothingNew: stored.length === 0 };
      case "error":
        errors.push(unreachable(environmentId, url, result.message));
        return { skills: stored, validators: storedValidators, nothingNew: true };
      case "ok": {
        const parsed = parseAgentSkillsDiscoveryIndex(result.body, { maxSkills: this.maxSkills });
        for (const problem of parsed.problems) {
          errors.push({
            code: problem.code,
            message: problem.message,
            repository: WEB_REPOSITORY_ID,
            environmentId,
            bundleId: WEB_BUNDLE_ID,
            url: problem.url ?? url,
          });
        }
        const fetched = await mapWithLimit(parsed.entries, SKILL_FETCH_CONCURRENCY, (entry) => this.fetchSkill(entry, environmentId, errors));
        return {
          skills: fetched.filter((artifact): artifact is BundleArtifact => artifact !== null),
          validators: validatorsOf(result.etag, result.lastModified),
          nothingNew: false,
        };
      }
    }
  }

  /** Fetches one `skill-md` entry and keeps it only when its body matches the digest. */
  private async fetchSkill(entry: DiscoverySkillEntry, environmentId: string, errors: RepositoryReadError[]): Promise<BundleArtifact | null> {
    let result: GuardedFetchResult;
    try {
      result = await this.fetch(entry.url, { timeoutMs: this.requestTimeoutMs });
    } catch (cause) {
      errors.push(unreachable(environmentId, entry.url, cause instanceof Error ? cause.message : String(cause)));
      return null;
    }
    if (result.kind !== "ok") {
      const detail = result.kind === "absent" ? `status ${result.status}` : result.kind === "error" ? result.message : "unexpected 304";
      errors.push(unreachable(environmentId, entry.url, `skill '${entry.name}': ${detail}`));
      return null;
    }
    const digest = createHash("sha256").update(Buffer.from(result.body, "utf8")).digest("hex");
    if (`sha256:${digest}` !== entry.digest) {
      errors.push({
        code: "invalid_bundle_contents",
        message: `Skill '${entry.name}' does not match its digest (expected ${entry.digest}, got sha256:${digest})`,
        repository: WEB_REPOSITORY_ID,
        environmentId,
        bundleId: WEB_BUNDLE_ID,
        url: entry.url,
      });
      return null;
    }
    // Keyed `<id>/SKILL.md` like every other repository, so readers that flatten a bundle's
    // files (the RookKit preview) do not collide on a bare `SKILL.md`.
    return { id: entry.name, files: { [`${entry.name}/SKILL.md`]: result.body }, sourceUrl: entry.url };
  }
}

/** The URL of one host-rooted resource; hosts that are not bare hosts are rejected here. */
function resourceUrl(host: string, path: string): string {
  let url: URL;
  try {
    url = new URL(path, `https://${host}/`);
  } catch {
    throw new Error(`Invalid web scout host: ${host}`);
  }
  // Credentials, ports, and other URL syntax hiding in a "host" would send the request
  // somewhere other than the environment being scouted.
  if (url.hostname !== host) throw new Error(`Invalid web scout host: ${host}`);
  return url.toString();
}

function buildBundle(
  environmentId: string,
  host: string,
  llmsTxt: string | undefined,
  agentsMd: string | undefined,
  skills: BundleArtifact[],
): EnvironmentBundle {
  return {
    id: `${environmentId}#${WEB_BUNDLE_ID}`,
    bundleId: WEB_BUNDLE_ID,
    environmentId,
    repository: WEB_REPOSITORY_ID,
    sourceUrl: `https://${host}/`,
    skills,
    mcpServers: [],
    apps: [],
    ...(llmsTxt === undefined ? {} : { llmsTxt }),
    ...(agentsMd === undefined ? {} : { agentsMd }),
    valid: true,
    // Scout problems travel on the recorded scout, not inside the bundle.
    errors: [],
  };
}

function unreachable(environmentId: string, url: string, message: string): RepositoryReadError {
  return {
    code: "unreachable_url",
    message: `Could not fetch ${url}: ${message}`,
    repository: WEB_REPOSITORY_ID,
    environmentId,
    bundleId: WEB_BUNDLE_ID,
    url,
  };
}

/** Line endings and trailing whitespace are normalized so serving quirks do not churn the bundle hash. */
function normalizeText(raw: string): string | undefined {
  const text = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
  return text.length === 0 ? undefined : text;
}

function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 16).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function validatorsOf(etag: string | undefined, lastModified: string | undefined): WebScoutValidators | undefined {
  if (!etag && !lastModified) return undefined;
  return { ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) };
}

function mergeValidators(stored: WebScoutValidators | undefined, fresh: WebScoutValidators | undefined): WebScoutValidators | undefined {
  if (!stored) return fresh;
  if (!fresh) return stored;
  return { ...stored, ...fresh };
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
