import path from "node:path";
import type { EnvironmentBundle, EnvironmentBundleResult, RepositoryReadError } from "../../shared/environmentRepository.js";
import { getRookHomeDir } from "../../infrastructure/config/configPaths.js";
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
 * Storage reuses the standard `environments`/`capabilities`/`bundles` schema and adds
 * per-host scout bookkeeping (`web_scouts`, `web_scout_resources`). Hosts scouted with
 * nothing found keep a `web_scouts` row but no `environments` row, so `listEnvironments`
 * and `searchBundles` (inherited unchanged) only ever surface hosts that have content.
 */
export class WebEnvironmentRepository extends SQLiteEnvironmentRepository {
  constructor(datastore: EnvironmentRepositoryDatastore | string = defaultWebEnvironmentRepositoryPath()) {
    super(datastore, "web");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_scouts (
        host TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('content', 'empty', 'error')),
        errors_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS web_scout_resources (
        host TEXT NOT NULL REFERENCES web_scouts(host) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        PRIMARY KEY (host, resource)
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(web_scouts)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "errors_json")) {
      this.db.exec("ALTER TABLE web_scouts ADD COLUMN errors_json TEXT NOT NULL DEFAULT '[]'");
    }
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
    const row = this.db.prepare("SELECT host, fetched_at, status, errors_json FROM web_scouts WHERE host = ?")
      .get(normalized) as { host: string; fetched_at: string; status: WebScoutStatus; errors_json: string } | undefined;
    if (!row) return null;
    const validators: Record<string, WebScoutValidators> = {};
    const resourceRows = this.db.prepare("SELECT resource, etag, last_modified FROM web_scout_resources WHERE host = ? ORDER BY resource")
      .all(normalized) as Array<{ resource: string; etag: string | null; last_modified: string | null }>;
    for (const resource of resourceRows) {
      validators[resource.resource] = {
        ...(resource.etag === null ? {} : { etag: resource.etag }),
        ...(resource.last_modified === null ? {} : { lastModified: resource.last_modified }),
      };
    }
    return { host: row.host, fetchedAt: row.fetched_at, status: row.status, validators, errors: parseErrors(row.errors_json) };
  }

  /**
   * True when the host was never scouted or its entry has aged past the TTL. Hosts whose
   * last scout errored use `errorTtlMs` when given, so a transient failure can be retried
   * sooner than settled knowledge is refreshed.
   */
  isStale(host: string, ttlMs: number, now = Date.now(), errorTtlMs?: number): boolean {
    const state = this.getScoutState(host);
    if (!state) return true;
    const fetchedAt = Date.parse(state.fetchedAt);
    const effectiveTtl = state.status === "error" && errorTtlMs !== undefined ? errorTtlMs : ttlMs;
    return Number.isNaN(fetchedAt) || fetchedAt + effectiveTtl <= now;
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
   * - `empty`: durable knowledge that the site offers nothing — bundle rows, the
   *   environments row, orphaned capabilities, and the old validators are all dropped.
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
    const errorsJson = JSON.stringify(input.errors ?? []);

    this.db.exec("BEGIN");
    try {
      const before = this.bundleFingerprint(environmentId);
      if (input.status === "content" && !input.bundle && !before) {
        throw new Error(`Web scout status 'content' requires a bundle for ${environmentId} when nothing is stored`);
      }
      this.db.prepare(`
        INSERT INTO web_scouts (host, fetched_at, status, errors_json) VALUES (?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          fetched_at = excluded.fetched_at, status = excluded.status, errors_json = excluded.errors_json
      `).run(host, input.fetchedAt, input.status, errorsJson);
      if (input.status !== "error") {
        this.db.prepare("DELETE FROM web_scout_resources WHERE host = ?").run(host);
        for (const [resource, validators] of Object.entries(input.validators)) {
          this.db.prepare("INSERT INTO web_scout_resources (host, resource, etag, last_modified) VALUES (?, ?, ?, ?)")
            .run(host, resource, validators.etag ?? null, validators.lastModified ?? null);
        }
      }
      if (input.bundle) {
        this.upsertEnvironment({ id: environmentId, displayName: host, description: `Website ${host}`, metadata: {} });
        this.writeBundle(input.bundle, WEB_BUNDLE_ID, host);
        this.deleteOrphanedCapabilities();
      } else if (input.status === "empty") {
        this.db.prepare("DELETE FROM bundles WHERE environment_id = ?").run(environmentId);
        this.db.prepare("DELETE FROM environments WHERE environment_id = ?").run(environmentId);
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
      WHERE b.environment_id = ? AND b.deleted_at IS NULL
      ORDER BY b.bundle_id, c.type, c.name, c.content_hash
    `).all(environmentId) as Array<{ bundle_id: string; type: string; name: string; content_hash: string }>;
    return rows.map((row) => `${row.bundle_id}\u0000${row.type}\u0000${row.name}\u0000${row.content_hash}`).join("\u0001");
  }
}

/** The single synthesized bundle id every scouted host publishes under. */
export const WEB_BUNDLE_ID = "site";

/** Where a server-owned web repository lives when no explicit location is configured. */
export function defaultWebEnvironmentRepositoryPath(): string {
  return path.join(getRookHomeDir(), "web-environment-repository.db");
}

export type WebScoutStatus = "content" | "empty" | "error";

export interface WebScoutValidators {
  etag?: string;
  lastModified?: string;
}

export interface WebScoutState {
  host: string;
  /** ISO-8601 timestamp of the scout that produced this entry. */
  fetchedAt: string;
  status: WebScoutStatus;
  /** Conditional-request validators keyed by resource ('llms.txt', 'AGENTS.md', 'skills-index', 'skill:<name>'). */
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

function parseErrors(json: string): RepositoryReadError[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as RepositoryReadError[]) : [];
  } catch {
    return [];
  }
}
