import path from "node:path";
import type { EnvironmentBundle, EnvironmentBundleResult } from "../../shared/environmentRepository.js";
import { getRookHomeDir } from "../../infrastructure/config/configPaths.js";
import type { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { SQLiteEnvironmentRepository } from "./SQLiteEnvironmentRepository.js";

/**
 * Read-only projection of website capabilities scouted for `web:<host>` environments,
 * persisted per profile so scouted content survives restarts and is searchable offline.
 *
 * It performs no network I/O — `WebEnvironmentScout` fetches and calls `recordScout`.
 * Public writes (`replaceCapabilityFiles` and friends) stay no-ops because the base
 * class only honours them for the `personal` repository.
 *
 * Storage reuses the standard `environments`/`capabilities`/`bundles` schema and adds
 * per-host scout bookkeeping (`web_scouts`, `web_scout_resources`). Hosts scouted with
 * nothing found keep a `web_scouts` row but no `environments` row, so `listEnvironments`
 * and `searchBundles` (inherited unchanged) only ever surface hosts that have content.
 */
export class WebEnvironmentRepository extends SQLiteEnvironmentRepository {
  constructor(datastore: EnvironmentRepositoryDatastore | string = path.join(getRookHomeDir(), "web-environment-repository.db")) {
    super(datastore, "web");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_scouts (
        host TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('content', 'empty', 'error'))
      );

      CREATE TABLE IF NOT EXISTS web_scout_resources (
        host TEXT NOT NULL REFERENCES web_scouts(host) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        PRIMARY KEY (host, resource)
      );
    `);
  }

  override async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const host = hostForWebEnvironmentId(environmentId);
    // Ids this repository does not own (non-web, or path-scoped) and hosts never
    // scouted must not claim the environment record in the composite repository.
    if (!host || !this.getScoutState(host)) return { environment: null, bundles: [], errors: [] };
    const result = await super.getBundles(webEnvironmentIdForHost(host));
    for (const bundle of result.bundles) bundle.sourceUrl = `https://${host}/`;
    return result;
  }

  getScoutState(host: string): WebScoutState | null {
    const normalized = host.toLowerCase();
    const row = this.db.prepare("SELECT host, fetched_at, status FROM web_scouts WHERE host = ?")
      .get(normalized) as { host: string; fetched_at: string; status: WebScoutStatus } | undefined;
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
    return { host: row.host, fetchedAt: row.fetched_at, status: row.status, validators };
  }

  /** True when the host was never scouted or its entry has aged past the TTL. */
  isStale(host: string, ttlMs: number, now = Date.now()): boolean {
    const state = this.getScoutState(host);
    if (!state) return true;
    const fetchedAt = Date.parse(state.fetchedAt);
    return Number.isNaN(fetchedAt) || fetchedAt + ttlMs <= now;
  }

  /**
   * Replaces everything stored for one host in a single transaction: scout timestamp
   * and status, conditional-request validators, and the host's bundle content.
   * Returns whether the stored bundle content differs from what was there before, which
   * is what the scout uses to decide whether the environment needs re-registering.
   */
  recordScout(input: WebScoutRecord): { changed: boolean } {
    const host = input.host.toLowerCase();
    if (!host || host.includes("/")) throw new Error(`Invalid web scout host: ${input.host}`);
    const environmentId = webEnvironmentIdForHost(host);
    const bundle = input.status === "content" ? input.bundle : null;
    if (input.status === "content" && !input.bundle) {
      throw new Error(`Web scout status 'content' requires a bundle for ${environmentId}`);
    }
    if (input.bundle && (input.bundle.environmentId !== environmentId || input.bundle.bundleId !== WEB_BUNDLE_ID)) {
      throw new Error(`Web scout bundle must be ${environmentId}#${WEB_BUNDLE_ID}, got ${input.bundle.environmentId}#${input.bundle.bundleId}`);
    }

    this.db.exec("BEGIN");
    try {
      const before = this.bundleFingerprint(environmentId);
      this.db.prepare(`
        INSERT INTO web_scouts (host, fetched_at, status) VALUES (?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status
      `).run(host, input.fetchedAt, input.status);
      this.db.prepare("DELETE FROM web_scout_resources WHERE host = ?").run(host);
      for (const [resource, validators] of Object.entries(input.validators)) {
        this.db.prepare("INSERT INTO web_scout_resources (host, resource, etag, last_modified) VALUES (?, ?, ?, ?)")
          .run(host, resource, validators.etag ?? null, validators.lastModified ?? null);
      }
      if (bundle) {
        this.upsertEnvironment({ id: environmentId, displayName: host, description: `Website ${host}`, metadata: {} });
        this.writeBundle(bundle, WEB_BUNDLE_ID, host);
      } else {
        this.db.prepare("DELETE FROM bundles WHERE environment_id = ?").run(environmentId);
        this.db.prepare("DELETE FROM environments WHERE environment_id = ?").run(environmentId);
      }
      this.deleteOrphanedCapabilities();
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
}

export interface WebScoutRecord {
  host: string;
  fetchedAt: string;
  status: WebScoutStatus;
  validators: Record<string, WebScoutValidators>;
  /** The host's single bundle, or null when the scout found nothing usable. */
  bundle: EnvironmentBundle | null;
}

export function webEnvironmentIdForHost(host: string): string {
  return `web:${host.toLowerCase()}`;
}

/** The host of a host-rooted `web:` id; null for anything else (path-scoped ids included). */
export function hostForWebEnvironmentId(environmentId: string): string | null {
  if (!environmentId.startsWith("web:")) return null;
  const host = environmentId.slice("web:".length).toLowerCase();
  return host && !host.includes("/") ? host : null;
}
