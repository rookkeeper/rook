import type { EnvironmentBundle, EnvironmentBundleResult, EnvironmentRecord, RepositoryReadError } from "../../shared/environmentRepository.js";
import type { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { SQLiteEnvironmentRepository } from "./SQLiteEnvironmentRepository.js";

/**
 * Read-only projection of website capabilities scouted for `web:<host>` environments,
 * persisted per profile so scouted content survives restarts and is searchable offline.
 *
 * It performs no network I/O — `WebEnvironmentScout` fetches and calls `recordScout`,
 * which is the only way content enters this store: the inherited `saveResult`/`saveBundle`
 * writers throw, and `replaceCapabilityFiles` and friends stay no-ops because the base
 * class only honours them for the `personal` repository.
 *
 * Storage reuses the personal repository datastore. Website bundles are identified by their
 * hostname publisher; per-host scout bookkeeping lives in the environment row's
 * `metadata_json`. Contentless rows remain available for TTL checks but are excluded from
 * discovery and search.
 */
export class WebEnvironmentRepository extends SQLiteEnvironmentRepository {
  constructor(datastore: EnvironmentRepositoryDatastore | string) {
    super(datastore, "web");
  }

  override async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const host = hostForWebEnvironmentId(environmentId);
    // Ids this repository does not own (non-web, or path-scoped) and hosts never
    // scouted must not claim the environment record in the composite repository.
    if (!host) return { environment: null, bundles: [], errors: [] };
    const state = this.getScoutState(host);
    if (!state) return { environment: null, bundles: [], errors: [] };
    const result = await super.getBundles(webEnvironmentIdForHost(host));
    for (const bundle of result.bundles) {
      bundle.sourceUrl = `https://${host}/`;
      // Partial failures travel with the content they degrade; the bundle stays valid.
      bundle.errors = state.errors;
    }
    if (result.bundles.length === 0) result.errors = state.errors;
    return result;
  }

  override async listEnvironments(): Promise<EnvironmentRecord[]> {
    const environments = await super.listEnvironments();
    const rows = this.db.prepare(`
      SELECT DISTINCT environment_id
      FROM bundles
      WHERE publisher NOT IN ('personal', 'default') AND deleted_at IS NULL
    `).all() as Array<{ environment_id: string }>;
    const withContent = new Set(rows.map((row) => row.environment_id));
    return environments.filter((environment) => withContent.has(environment.id));
  }

  /** Never writable: web content only enters through `recordScout`. */
  override saveResult(): never {
    throw new Error("web content is written through recordScout");
  }

  /** Never writable: web content only enters through `recordScout`. */
  override saveBundle(): never {
    throw new Error("web content is written through recordScout");
  }

  getScoutState(host: string): WebScoutState | null {
    const normalized = normalizeHost(host);
    if (!normalized) return null;
    const row = this.db.prepare("SELECT metadata_json FROM environments WHERE environment_id = ?")
      .get(webEnvironmentIdForHost(normalized)) as { metadata_json: string } | undefined;
    if (!row) return null;
    return scoutStateFromMetadata(normalized, parseMetadata(row.metadata_json));
  }

  /**
   * True when the host was never scouted or its entry has aged past the TTL. Hosts whose
   * last scout errored use `errorTtlMs` when given, so a transient failure can be retried
   * sooner than settled knowledge is refreshed.
   */
  isStale(host: string, options: WebScoutStalenessOptions): boolean {
    const state = this.getScoutState(host);
    if (!state) return true;
    const fetchedAt = Date.parse(state.fetchedAt);
    const effectiveTtl = state.status === "error" && options.errorTtlMs !== undefined ? options.errorTtlMs : options.ttlMs;
    return Number.isNaN(fetchedAt) || fetchedAt + effectiveTtl <= (options.now ?? Date.now());
  }

  /**
   * Records one scout pass for a host in a single transaction. What it rewrites depends on
   * `status`, because "empty" and "error" are not the same kind of knowledge:
   *
   * - `content` with a bundle: replaces the host's bundle rows and validators wholesale
   *   (the scout passes the full merged bundle whenever any resource changed).
   * - `content` with `bundle: null`: everything revalidated (304s), so the stored bundle
   *   rows are kept exactly as they are; only the timestamp, validators, and errors move.
   *   Throws when nothing is stored, since there would be nothing to keep.
   * - `empty`: durable knowledge that the site offers nothing — bundle rows, orphaned
   *   capabilities, and old validators are dropped, while metadata keeps the negative row.
   * - `error`: not knowledge at all, just a failed look. Only the timestamp, status, and
   *   errors are touched; the previous content and validators survive so the next pass can
   *   still revalidate them, and `changed` is always false.
   *
   * Returns whether the stored bundle content differs from what was there before, which is
   * what the scout uses to decide whether the environment needs re-registering.
   */
  recordScout(input: WebScoutRecord): { changed: boolean } {
    const host = normalizeHost(input.host);
    if (!host) throw new Error(`Invalid web scout host: ${input.host}`);
    const environmentId = webEnvironmentIdForHost(host);
    if (input.bundle && input.status !== "content") {
      throw new Error(`Web scout status '${input.status}' must not carry a bundle for ${environmentId}`);
    }
    if (input.bundle && (input.bundle.environmentId !== environmentId || input.bundle.bundleId !== WEB_BUNDLE_ID)) {
      throw new Error(`Web scout bundle must be ${environmentId}#${WEB_BUNDLE_ID}, got ${input.bundle.environmentId}#${input.bundle.bundleId}`);
    }

    this.db.exec("BEGIN");
    try {
      const before = this.bundleFingerprint(environmentId);
      if (input.status === "content" && !input.bundle && !before) {
        throw new Error(`Web scout status 'content' requires a bundle for ${environmentId} when nothing is stored`);
      }
      const existingMetadata = this.environmentMetadata(environmentId);
      const existingState = scoutStateFromMetadata(host, existingMetadata);
      const validators = input.status === "error" ? existingState?.validators ?? {} : input.validators;
      const metadata = {
        ...existingMetadata,
        scout: serializeScoutState(input.fetchedAt, input.status, validators, input.errors ?? []),
      };
      this.upsertEnvironment({ id: environmentId, displayName: host, description: `Website ${host}`, metadata });
      if (input.bundle) {
        this.writeBundle(input.bundle, WEB_BUNDLE_ID, host);
        this.deleteOrphanedCapabilities();
      } else if (input.status === "empty") {
        this.db.prepare("DELETE FROM bundles WHERE environment_id = ? AND publisher NOT IN ('personal', 'default')").run(environmentId);
        this.deleteOrphanedCapabilities();
      }
      const after = this.bundleFingerprint(environmentId);
      this.db.exec("COMMIT");
      return { changed: before !== after };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Stable digest of the capability content currently stored for one environment. */
  private bundleFingerprint(environmentId: string): string {
    const rows = this.db.prepare(`
      SELECT b.bundle_id, c.type, c.name, c.content_hash
      FROM bundles b JOIN capabilities c ON c.capability_id = b.capability_id
      WHERE b.environment_id = ? AND b.deleted_at IS NULL AND b.publisher NOT IN ('personal', 'default')
      ORDER BY b.bundle_id, c.type, c.name, c.content_hash
    `).all(environmentId) as Array<{ bundle_id: string; type: string; name: string; content_hash: string }>;
    return rows.map((row) => `${row.bundle_id}\u0000${row.type}\u0000${row.name}\u0000${row.content_hash}`).join("\u0001");
  }

  private environmentMetadata(environmentId: string): Record<string, unknown> {
    const row = this.db.prepare("SELECT metadata_json FROM environments WHERE environment_id = ?")
      .get(environmentId) as { metadata_json: string } | undefined;
    return parseMetadata(row?.metadata_json);
  }
}

/** The single synthesized bundle id every scouted host publishes under. */
export const WEB_BUNDLE_ID = "site";

export type WebScoutStatus = "content" | "empty" | "error";

export interface WebScoutStalenessOptions {
  ttlMs: number;
  /** Shorter TTL applied when the last scout errored, so failures are retried sooner. */
  errorTtlMs?: number;
  /** Epoch milliseconds to compare against (defaults to now). */
  now?: number;
}

export interface WebScoutValidators {
  etag?: string;
  lastModified?: string;
}

export interface WebScoutState {
  host: string;
  /** ISO-8601 timestamp of the scout that produced this entry. */
  fetchedAt: string;
  status: WebScoutStatus;
  /** Conditional-request validators keyed by resource: 'llms.txt', 'AGENTS.md', 'skills-index'. */
  validators: Record<string, WebScoutValidators>;
  /** Problems the last scout hit, served alongside whatever content survived them. */
  errors: RepositoryReadError[];
}

export interface WebScoutRecord {
  host: string;
  fetchedAt: string;
  status: WebScoutStatus;
  validators: Record<string, WebScoutValidators>;
  /**
   * The host's full merged bundle. Null with status 'content' means every resource
   * revalidated unchanged and the stored bundle is kept; it is the only legal value for
   * 'empty' and 'error'.
   */
  bundle: EnvironmentBundle | null;
  /** Fetch/parse problems from this pass, stored verbatim (defaults to none). */
  errors?: RepositoryReadError[];
}

/** Lowercased bare host, or null when the input could never be one. */
export function normalizeHost(raw: string): string | null {
  const host = raw.trim().toLowerCase();
  if (!host || host.includes("/") || /\s/.test(host)) return null;
  return host;
}

export function webEnvironmentIdForHost(host: string): string {
  const normalized = normalizeHost(host);
  if (!normalized) throw new Error(`Invalid web host: ${host}`);
  return `web:${normalized}`;
}

/** The host of a host-rooted `web:` id; null for anything else (path-scoped ids included). */
export function hostForWebEnvironmentId(environmentId: string): string | null {
  if (!environmentId.startsWith("web:")) return null;
  return normalizeHost(environmentId.slice("web:".length));
}

function parseMetadata(json: unknown): Record<string, unknown> {
  if (typeof json !== "string") return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function scoutStateFromMetadata(host: string, metadata: Record<string, unknown>): WebScoutState | null {
  const scout = metadata.scout;
  if (!isRecord(scout) || typeof scout.fetched_at !== "string" || !isWebScoutStatus(scout.status)) return null;
  const validators: Record<string, WebScoutValidators> = {};
  if (isRecord(scout.validators)) {
    for (const [resource, value] of Object.entries(scout.validators)) {
      if (!isRecord(value)) continue;
      const validator: WebScoutValidators = {};
      if (typeof value.etag === "string") validator.etag = value.etag;
      if (typeof value.last_modified === "string") validator.lastModified = value.last_modified;
      validators[resource] = validator;
    }
  }
  return {
    host,
    fetchedAt: scout.fetched_at,
    status: scout.status,
    validators,
    errors: Array.isArray(scout.errors) ? scout.errors as RepositoryReadError[] : [],
  };
}

function serializeScoutState(
  fetchedAt: string,
  status: WebScoutStatus,
  validators: Record<string, WebScoutValidators>,
  errors: RepositoryReadError[],
): Record<string, unknown> {
  return {
    fetched_at: fetchedAt,
    status,
    errors,
    validators: Object.fromEntries(Object.entries(validators).map(([resource, value]) => [resource, {
      ...(value.etag === undefined ? {} : { etag: value.etag }),
      ...(value.lastModified === undefined ? {} : { last_modified: value.lastModified }),
    }])),
  };
}

function isWebScoutStatus(value: unknown): value is WebScoutStatus {
  return value === "content" || value === "empty" || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
