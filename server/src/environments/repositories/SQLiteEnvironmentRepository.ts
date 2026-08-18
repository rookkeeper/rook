import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  BundleArtifact,
  CapabilityType,
  EnvironmentBundle,
  EnvironmentBundleResult,
  EnvironmentRecord,
  RepositoryReadError,
} from "../../shared/environmentRepository.js";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

/** SQLite-backed repository using current capability content and bundle memberships. */
export class SQLiteEnvironmentRepository extends EnvironmentRepository {
  protected readonly db: DatabaseSync;
  private readonly ownedDatastore: EnvironmentRepositoryDatastore | null;

  constructor(
    datastore: EnvironmentRepositoryDatastore | string = new EnvironmentRepositoryDatastore(),
    readonly repositoryId: string = typeof datastore === "string" ? datastore : "sqlite",
  ) {
    super();
    if (typeof datastore === "string") {
      this.ownedDatastore = new EnvironmentRepositoryDatastore(datastore);
      this.db = this.ownedDatastore.db;
    } else {
      this.ownedDatastore = null;
      this.db = datastore.db;
    }
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    if (!validEnvironmentId(environmentId)) {
      return {
        environment: null,
        bundles: [],
        errors: [{
          code: "invalid_environment_id",
          message: `Invalid environment id: ${environmentId}`,
          repository: this.repositoryId,
          environmentId,
        }],
      };
    }

    const environmentRow = this.db.prepare(`
      SELECT environment_id, display_name, description, metadata_json
      FROM environments WHERE environment_id = ?
    `).get(environmentId);
    const environment = environmentRow ? environmentFromRow(environmentRow) : defaultEnvironmentRecord(environmentId);
    const rows = this.db.prepare(`
      SELECT b.bundle_id, b.environment_id, b.publisher,
             c.capability_id, c.type, c.name, c.files_json, c.content_hash
      FROM bundles b
      JOIN capabilities c ON c.capability_id = b.capability_id
      WHERE b.environment_id = ? AND b.deleted_at IS NULL
      ORDER BY b.bundle_id, c.type, c.name
    `).all(environmentId) as Array<Record<string, unknown>>;

    const byBundle = new Map<string, EnvironmentBundle>();
    for (const row of rows) {
      const bundleId = String(row.bundle_id);
      let bundle = byBundle.get(bundleId);
      if (!bundle) {
        bundle = {
          id: `${environmentId}#${bundleId}`,
          bundleId,
          environmentId,
          repository: this.repositoryId,
          skills: [],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        };
        byBundle.set(bundleId, bundle);
      }
      const type = String(row.type) as CapabilityType;
      const name = String(row.name);
      const files = parseFiles(row.files_json);
      if (type === "instructions") bundle.agentsMd = files["AGENTS.md"] ?? firstFile(files);
      else if (type === "llms-txt") bundle.llmsTxt = files["llms.txt"] ?? firstFile(files);
      else if (type === "facts") bundle.facts = [...(bundle.facts ?? []), { id: name, files }];
      else if (type === "skill") bundle.skills.push({ id: name, files });
      else if (type === "mcp") bundle.mcpServers.push({ id: name, files });
      else if (type === "app") bundle.apps.push({ id: name, files });
    }

    return { environment, bundles: [...byBundle.values()], errors: [] };
  }

  async listEnvironments(): Promise<EnvironmentRecord[]> {
    return this.db.prepare(`
      SELECT environment_id, display_name, description, metadata_json
      FROM environments ORDER BY environment_id
    `).all().map(environmentFromRow);
  }

  async searchBundles(query: string, repositoryId?: string): Promise<EnvironmentBundle[]> {
    if (repositoryId && repositoryId !== this.repositoryId) return [];
    const normalized = query.trim().toLowerCase();
    const results: EnvironmentBundle[] = [];
    for (const environment of await this.listEnvironments()) {
      const bundles = (await this.getBundles(environment.id)).bundles;
      for (const bundle of bundles) {
        const searchable = [
          bundle.bundleId,
          bundle.agentsMd ?? "",
          bundle.llmsTxt ?? "",
          ...bundle.skills.flatMap((artifact) => [artifact.id, ...Object.values(artifact.files)]),
          ...bundle.mcpServers.flatMap((artifact) => [artifact.id, ...Object.values(artifact.files)]),
          ...bundle.apps.flatMap((artifact) => [artifact.id, ...Object.values(artifact.files)]),
          ...(bundle.facts ?? []).flatMap((artifact) => [artifact.id, ...Object.values(artifact.files)]),
        ];
        if (!normalized || searchable.some((value) => value.toLowerCase().includes(normalized))) results.push(bundle);
      }
    }
    return results;
  }

  /** Replaces the current repository content for one environment. */
  saveResult(result: EnvironmentBundleResult): void {
    if (!result.environment) return;
    const environment = result.environment;
    this.db.exec("BEGIN");
    try {
      this.upsertEnvironment(environment);
      this.db.prepare("DELETE FROM bundles WHERE environment_id = ?").run(environment.id);
      for (const bundle of result.bundles.filter((candidate) => candidate.valid)) {
        this.writeBundle(bundle, normalizedBundleId(bundle.bundleId));
      }
      this.deleteOrphanedCapabilities();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveBundle(bundle: EnvironmentBundle): void {
    this.db.exec("BEGIN");
    try {
      this.upsertEnvironment({ id: bundle.environmentId, displayName: bundle.environmentId, description: `Environment ${bundle.environmentId}`, metadata: {} });
      this.writeBundle(bundle, normalizedBundleId(bundle.bundleId));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async replaceCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>): Promise<boolean> {
    if (this.repositoryId !== "personal") return false;
    this.ensureEnvironment(environmentId);
    const membership = this.findMembership(environmentId, bundleId, type, capabilityName);
    const capabilityId = membership?.capabilityId ?? randomUUID();
    const filesJson = JSON.stringify(files);
    this.db.prepare(`
      INSERT INTO capabilities (capability_id, type, name, files_json, content_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(capability_id) DO UPDATE SET type = excluded.type, name = excluded.name, files_json = excluded.files_json, content_hash = excluded.content_hash
    `).run(capabilityId, type, capabilityName, filesJson, hashFiles(files));
    this.db.prepare(`
      INSERT INTO bundles (bundle_id, environment_id, capability_id, publisher, deleted_at)
      VALUES (?, ?, ?, 'default', NULL)
      ON CONFLICT(bundle_id, capability_id) DO UPDATE SET environment_id = excluded.environment_id, deleted_at = NULL
    `).run(bundleId, environmentId, capabilityId);
    return true;
  }

  async createCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>): Promise<boolean> {
    if (this.repositoryId !== "personal") return false;
    const existing = this.findMembership(environmentId, bundleId, type, capabilityName);
    if (existing && !existing.deletedAt) return false;
    return this.replaceCapabilityFiles(environmentId, bundleId, type, capabilityName, files);
  }

  async deleteCapability(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string): Promise<boolean> {
    if (this.repositoryId !== "personal") return false;
    const membership = this.findMembership(environmentId, bundleId, type, capabilityName);
    if (!membership) return false;
    this.db.prepare("UPDATE bundles SET deleted_at = ? WHERE bundle_id = ? AND environment_id = ? AND capability_id = ?")
      .run(new Date().toISOString(), bundleId, environmentId, membership.capabilityId);
    return true;
  }

  async restoreCapability(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string): Promise<boolean> {
    if (this.repositoryId !== "personal") return false;
    const membership = this.findMembership(environmentId, bundleId, type, capabilityName);
    if (!membership) return false;
    this.db.prepare("UPDATE bundles SET deleted_at = NULL WHERE bundle_id = ? AND environment_id = ? AND capability_id = ?")
      .run(bundleId, environmentId, membership.capabilityId);
    return true;
  }

  close(): void {
    this.ownedDatastore?.close();
  }

  protected writeBundle(bundle: EnvironmentBundle, bundleId: string, publisher = "default"): void {
    this.db.prepare("DELETE FROM bundles WHERE bundle_id = ? AND environment_id = ?").run(bundleId, bundle.environmentId);
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
      `).run(bundleId, bundle.environmentId, capabilityId, publisher);
    }
  }

  protected upsertEnvironment(environment: EnvironmentRecord): void {
    const metadataJson = JSON.stringify(environment.metadata ?? {});
    this.db.prepare(`
      INSERT INTO environments (environment_id, display_name, description, metadata_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(environment_id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        metadata_json = excluded.metadata_json
    `).run(environment.id, environment.displayName, environment.description, metadataJson);
  }

  private ensureEnvironment(environmentId: string): void {
    this.upsertEnvironment(defaultEnvironmentRecord(environmentId));
  }

  private findMembership(environmentId: string, bundleId: string, type: CapabilityType, name: string): { capabilityId: string; deletedAt: string | null } | undefined {
    const row = this.db.prepare(`
      SELECT c.capability_id, b.deleted_at
      FROM bundles b JOIN capabilities c ON c.capability_id = b.capability_id
      WHERE b.environment_id = ? AND b.bundle_id = ? AND c.type = ? AND c.name = ?
      LIMIT 1
    `).get(environmentId, bundleId, type, name) as { capability_id?: string; deleted_at?: string | null } | undefined;
    return row?.capability_id ? { capabilityId: row.capability_id, deletedAt: row.deleted_at ?? null } : undefined;
  }

  protected deleteOrphanedCapabilities(): void {
    this.db.exec("DELETE FROM capabilities WHERE capability_id NOT IN (SELECT capability_id FROM bundles)");
  }
}

function validEnvironmentId(environmentId: string): boolean {
  const separator = environmentId.indexOf(":");
  return separator > 0 && separator < environmentId.length - 1;
}

function defaultEnvironmentRecord(environmentId: string): EnvironmentRecord {
  const envPath = environmentId.split(":")[1] ?? environmentId;
  const displayName = envPath.split("/").filter(Boolean).map((segment) => segment.replace(/[-_]+/g, " ")).join(" / ") || environmentId;
  return { id: environmentId, displayName, description: `Environment ${environmentId}`, metadata: {} };
}

function environmentFromRow(row: unknown): EnvironmentRecord {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.environment_id),
    displayName: String(value.display_name),
    description: String(value.description),
    metadata: parseMetadata(value.metadata_json),
  };
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseFiles(value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter(([, content]) => typeof content === "string"))
      : {};
  } catch {
    return {};
  }
}

function firstFile(files: Record<string, string>): string | undefined {
  return Object.values(files)[0];
}

function hashFiles(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const filePath of Object.keys(files).sort()) hash.update(`${filePath}\u0000${files[filePath]}\u0000`);
  return hash.digest("hex");
}

function normalizedBundleId(value: string): string {
  if (isUuid(value)) return value;
  const hex = createHash("sha256").update(`rook-bundle:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
