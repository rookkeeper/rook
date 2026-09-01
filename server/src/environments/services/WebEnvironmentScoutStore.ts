import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CapabilityType, EnvironmentBundle, RepositoryReadError } from "../../shared/environmentRepository.js";
import type { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import type { SQLiteEnvironmentRepository } from "../repositories/SQLiteEnvironmentRepository.js";

/**
 * Scout-only persistence over the user's environment repository.
 *
 * The normal SQLite repository reads both user and site publishers. This collaborator
 * owns only the host-published rows and the namespaced scout metadata, and is never part
 * of the composite repository.
 */
export class WebEnvironmentScoutStore {
  private readonly db: DatabaseSync;

  constructor(
    datastore: EnvironmentRepositoryDatastore,
    private readonly repository: Pick<SQLiteEnvironmentRepository, "getBundles">,
  ) {
    this.db = datastore.db;
  }

  async getScoutedBundle(host: string): Promise<EnvironmentBundle | null> {
    const normalized = normalizeHost(host);
    if (!normalized) return null;
    const result = await this.repository.getBundles(webEnvironmentIdForHost(normalized));
    return result.bundles.find((bundle) => bundle.publisher === normalized && bundle.scoutPublished === true) ?? null;
  }

  getScoutState(host: string): WebScoutState | null {
    const normalized = normalizeHost(host);
    if (!normalized) return null;
    const row = this.db.prepare("SELECT metadata_json FROM environments WHERE environment_id = ?")
      .get(webEnvironmentIdForHost(normalized)) as { metadata_json: string } | undefined;
    if (!row) return null;
    return scoutStateFromMetadata(normalized, parseMetadata(row.metadata_json));
  }

  isStale(host: string, options: WebScoutStalenessOptions): boolean {
    const state = this.getScoutState(host);
    if (!state) return true;
    const fetchedAt = Date.parse(state.fetchedAt);
    const effectiveTtl = state.status === "error" && options.errorTtlMs !== undefined ? options.errorTtlMs : options.ttlMs;
    return Number.isNaN(fetchedAt) || fetchedAt + effectiveTtl <= (options.now ?? Date.now());
  }

  /** Records one complete pass transactionally and changes only this host's publisher. */
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
      const before = this.bundleFingerprint(environmentId, host);
      if (input.status === "content" && !input.bundle && !before) {
        throw new Error(`Web scout status 'content' requires a bundle for ${environmentId} when nothing is stored`);
      }
      const existing = this.environmentRow(environmentId);
      const existingMetadata = parseMetadata(existing?.metadata_json);
      const existingState = scoutStateFromMetadata(host, existingMetadata);
      const validators = input.status === "error" ? existingState?.validators ?? {} : input.validators;
      const metadata = {
        ...existingMetadata,
        scout: serializeScoutState(input.fetchedAt, input.status, validators, input.errors ?? []),
      };
      this.writeEnvironment(environmentId, host, metadata, existing);

      if (input.bundle) {
        this.replacePublishedBundle(input.bundle, host);
        this.deleteOrphanedCapabilities();
      } else if (input.status === "empty") {
        this.db.prepare("DELETE FROM bundles WHERE environment_id = ? AND publisher = ?").run(environmentId, host);
        this.deleteOrphanedCapabilities();
      }
      const after = this.bundleFingerprint(environmentId, host);
      this.db.exec("COMMIT");
      return { changed: before !== after };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private writeEnvironment(
    environmentId: string,
    host: string,
    metadata: Record<string, unknown>,
    existing?: EnvironmentRow,
  ): void {
    const scoutDisplayName = host;
    const scoutDescription = `Website ${host}`;
    if (!existing) {
      this.db.prepare(`
        INSERT INTO environments (environment_id, display_name, description, metadata_json)
        VALUES (?, ?, ?, ?)
      `).run(environmentId, scoutDisplayName, scoutDescription, JSON.stringify(metadata));
      return;
    }

    const displayName = !existing.display_name.trim() || existing.display_name === scoutDisplayName
      ? scoutDisplayName
      : existing.display_name;
    const description = !existing.description.trim() || existing.description === scoutDescription
      ? scoutDescription
      : existing.description;
    this.db.prepare(`
      UPDATE environments
      SET display_name = ?, description = ?, metadata_json = ?
      WHERE environment_id = ?
    `).run(displayName, description, JSON.stringify(metadata), environmentId);
  }

  private replacePublishedBundle(bundle: EnvironmentBundle, publisher: string): void {
    this.db.prepare("DELETE FROM bundles WHERE environment_id = ? AND publisher = ?")
      .run(bundle.environmentId, publisher);
    const capabilities: Array<{ type: CapabilityType; name: string; files: Record<string, string> }> = [];
    if (bundle.agentsMd?.trim()) capabilities.push({ type: "instructions", name: "AGENTS.md", files: { "AGENTS.md": bundle.agentsMd } });
    if (bundle.llmsTxt !== undefined) capabilities.push({ type: "llms-txt", name: "llms.txt", files: { "llms.txt": bundle.llmsTxt } });
    capabilities.push(...bundle.skills.map((artifact) => ({ type: "skill" as const, name: artifact.id, files: artifact.files })));
    capabilities.push(...bundle.mcpServers.map((artifact) => ({ type: "mcp" as const, name: artifact.id, files: artifact.files })));
    capabilities.push(...bundle.apps.map((artifact) => ({ type: "app" as const, name: artifact.id, files: artifact.files })));
    capabilities.push(...(bundle.facts ?? []).map((artifact) => ({ type: "facts" as const, name: artifact.id, files: artifact.files })));

    for (const capability of capabilities) {
      const capabilityId = randomUUID();
      const filesJson = JSON.stringify(capability.files);
      this.db.prepare(`
        INSERT INTO capabilities (capability_id, type, name, files_json, content_hash)
        VALUES (?, ?, ?, ?, ?)
      `).run(capabilityId, capability.type, capability.name, filesJson, hashFiles(capability.files));
      this.db.prepare(`
        INSERT INTO bundles (bundle_id, environment_id, capability_id, publisher)
        VALUES (?, ?, ?, ?)
      `).run(WEB_BUNDLE_ID, bundle.environmentId, capabilityId, publisher);
    }
  }

  private bundleFingerprint(environmentId: string, publisher: string): string {
    const rows = this.db.prepare(`
      SELECT b.bundle_id, c.type, c.name, c.content_hash
      FROM bundles b JOIN capabilities c ON c.capability_id = b.capability_id
      WHERE b.environment_id = ? AND b.publisher = ? AND b.deleted_at IS NULL
      ORDER BY b.bundle_id, c.type, c.name, c.content_hash
    `).all(environmentId, publisher) as Array<{ bundle_id: string; type: string; name: string; content_hash: string }>;
    return rows.map((row) => `${row.bundle_id}\u0000${row.type}\u0000${row.name}\u0000${row.content_hash}`).join("\u0001");
  }

  private environmentRow(environmentId: string): EnvironmentRow | undefined {
    return this.db.prepare(`
      SELECT display_name, description, metadata_json
      FROM environments WHERE environment_id = ?
    `).get(environmentId) as EnvironmentRow | undefined;
  }

  private deleteOrphanedCapabilities(): void {
    this.db.exec("DELETE FROM capabilities WHERE capability_id NOT IN (SELECT capability_id FROM bundles)");
  }
}

interface EnvironmentRow {
  display_name: string;
  description: string;
  metadata_json: string;
}

export const WEB_BUNDLE_ID = "site";

export type WebScoutStatus = "content" | "empty" | "error";

export interface WebScoutStalenessOptions {
  ttlMs: number;
  errorTtlMs?: number;
  now?: number;
}

export interface WebScoutValidators {
  etag?: string;
  lastModified?: string;
}

export interface WebScoutState {
  host: string;
  fetchedAt: string;
  status: WebScoutStatus;
  validators: Record<string, WebScoutValidators>;
  errors: RepositoryReadError[];
}

export interface WebScoutRecord {
  host: string;
  fetchedAt: string;
  status: WebScoutStatus;
  validators: Record<string, WebScoutValidators>;
  bundle: EnvironmentBundle | null;
  errors?: RepositoryReadError[];
}

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

function hashFiles(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const filePath of Object.keys(files).sort()) hash.update(`${filePath}\u0000${files[filePath]}\u0000`);
  return hash.digest("hex");
}

function isWebScoutStatus(value: unknown): value is WebScoutStatus {
  return value === "content" || value === "empty" || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
