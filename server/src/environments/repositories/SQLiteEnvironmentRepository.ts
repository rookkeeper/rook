import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  BundleArtifact,
  EnvironmentBundle,
  EnvironmentBundleResult,
  EnvironmentRecord,
  RepositoryReadError,
} from "../../shared/environmentRepository.js";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { DirectoryEnvironmentRepository } from "./DirectoryEnvironmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

export interface SQLiteEnvironmentRepositoryOptions {
  /** Optional projection root for compatibility consumers that still require bundlePath. */
  materializationRoot?: string;
}

/**
 * SQLite-backed environment repository.
 *
 * The public result shape intentionally remains EnvironmentBundle-shaped during
 * migration. SQLite stores the content and metadata; an optional materialization
 * root can provide a compatibility bundlePath for older runtime consumers.
 */
export class SQLiteEnvironmentRepository extends EnvironmentRepository {
  private readonly db: DatabaseSync;
  private readonly ownedDatastore: EnvironmentRepositoryDatastore | null;
  private readonly materializationRoot?: string;

  constructor(
    datastore: EnvironmentRepositoryDatastore | string = new EnvironmentRepositoryDatastore(),
    readonly repositoryId: string = typeof datastore === "string" ? datastore : "sqlite",
    options: SQLiteEnvironmentRepositoryOptions = {},
  ) {
    super();
    if (typeof datastore === "string") {
      this.ownedDatastore = new EnvironmentRepositoryDatastore(datastore);
      this.db = this.ownedDatastore.db;
    } else {
      this.ownedDatastore = null;
      this.db = datastore.db;
    }
    this.materializationRoot = options.materializationRoot;
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
      FROM environment_repository_environments WHERE environment_id = ?
    `).get(environmentId);
    const environment = environmentRow ? environmentFromRow(environmentRow) : defaultEnvironmentRecord(environmentId);
    const bundleRows = this.db.prepare(`
      SELECT bundle_key, bundle_id, environment_id, repository_id, valid, agents_md, source_bundle_path, errors_json
      FROM environment_repository_bundles
      WHERE repository_id = ? AND environment_id = ?
      ORDER BY bundle_id
    `).all(this.repositoryId, environmentId);

    const bundles: EnvironmentBundle[] = [];
    const errors: RepositoryReadError[] = [];
    for (const row of bundleRows) {
      const value = row as Record<string, unknown>;
      const bundleKey = String(value.bundle_key);
      const artifacts = this.db.prepare(`
        SELECT artifact_kind, artifact_id, files_json, source_path
        FROM environment_repository_artifacts WHERE bundle_key = ?
        ORDER BY artifact_kind, artifact_id
      `).all(bundleKey);
      const grouped = groupArtifacts(artifacts);
      const bundleErrors = parseJson<RepositoryReadError[]>(value.errors_json, []);
      const bundle: EnvironmentBundle = {
        id: `${environmentId}#${String(value.bundle_id)}`,
        bundleId: String(value.bundle_id),
        environmentId,
        repository: String(value.repository_id),
        ...(this.materializationRoot ? { bundlePath: this.bundleProjectionPath(environmentId, String(value.bundle_id)) } : {}),
        skills: grouped.skills,
        mcpServers: grouped["mcp-servers"],
        apps: grouped.apps,
        ...(typeof value.agents_md === "string" ? { agentsMd: value.agents_md } : {}),
        valid: Number(value.valid) === 1,
        errors: bundleErrors,
      };
      bundles.push(bundle);
      errors.push(...bundleErrors);
    }

    return { environment, bundles, errors };
  }

  async listEnvironments(): Promise<EnvironmentRecord[]> {
    return this.db.prepare(`
      SELECT environment_id, display_name, description, metadata_json
      FROM environment_repository_environments ORDER BY environment_id
    `).all().map(environmentFromRow);
  }

  async searchBundles(query: string): Promise<EnvironmentBundle[]> {
    const term = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT DISTINCT b.environment_id
      FROM environment_repository_bundles b
      LEFT JOIN environment_repository_artifacts a ON a.bundle_key = b.bundle_key
      WHERE b.repository_id = ?
        AND (lower(b.bundle_id) LIKE ? OR lower(coalesce(b.agents_md, '')) LIKE ? OR lower(a.artifact_id) LIKE ?)
      ORDER BY b.environment_id
    `).all(this.repositoryId, term, term, term);
    const bundles: EnvironmentBundle[] = [];
    for (const row of rows) {
      const result = await this.getBundles(String((row as Record<string, unknown>).environment_id));
      bundles.push(...result.bundles.filter((bundle) => bundle.bundleId.toLowerCase().includes(query.toLowerCase()) || bundle.skills.some((skill) => skill.id.toLowerCase().includes(query.toLowerCase())) || bundle.mcpServers.some((server) => server.id.toLowerCase().includes(query.toLowerCase())) || bundle.apps.some((app) => app.id.toLowerCase().includes(query.toLowerCase())) || bundle.agentsMd?.toLowerCase().includes(query.toLowerCase())));
    }
    return bundles;
  }

  /** Replaces all stored content for one environment from a parsed repository result. */
  saveResult(result: EnvironmentBundleResult): void {
    if (!result.environment) return;
    const environment = result.environment;
    this.db.prepare(`
      INSERT INTO environment_repository_environments (environment_id, display_name, description, metadata_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(environment_id) DO UPDATE SET display_name = excluded.display_name, description = excluded.description, metadata_json = excluded.metadata_json
    `).run(environment.id, environment.displayName, environment.description, JSON.stringify({}));

    this.db.exec("BEGIN");
    try {
      const oldBundles = this.db.prepare(`SELECT bundle_key FROM environment_repository_bundles WHERE repository_id = ? AND environment_id = ?`).all(this.repositoryId, environment.id);
      for (const row of oldBundles) this.db.prepare("DELETE FROM environment_repository_bundles WHERE bundle_key = ?").run(String((row as Record<string, unknown>).bundle_key));
      for (const bundle of result.bundles) this.saveBundle(bundle);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveBundle(bundle: EnvironmentBundle): void {
    const bundleKey = this.bundleKey(bundle.environmentId, bundle.bundleId);
    this.db.prepare(`
      INSERT INTO environment_repository_bundles (bundle_key, repository_id, environment_id, bundle_id, valid, agents_md, source_bundle_path, errors_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bundle_key) DO UPDATE SET valid = excluded.valid, agents_md = excluded.agents_md, source_bundle_path = excluded.source_bundle_path, errors_json = excluded.errors_json
    `).run(bundleKey, this.repositoryId, bundle.environmentId, bundle.bundleId, bundle.valid ? 1 : 0, bundle.agentsMd ?? null, bundle.bundlePath ?? null, JSON.stringify(bundle.errors));
    this.db.prepare("DELETE FROM environment_repository_artifacts WHERE bundle_key = ?").run(bundleKey);
    const insert = this.db.prepare(`
      INSERT INTO environment_repository_artifacts (bundle_key, artifact_kind, artifact_id, files_json, source_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const [kind, artifacts] of [["skills", bundle.skills], ["mcp-servers", bundle.mcpServers], ["apps", bundle.apps]] as const) {
      for (const artifact of artifacts) insert.run(bundleKey, kind, artifact.id, JSON.stringify(artifact.files), artifact.sourcePath ?? null);
    }
  }

  async importDirectory(root: string): Promise<number> {
    const directoryRepository = new DirectoryEnvironmentRepository(root, this.repositoryId);
    const environmentIds = await discoverEnvironmentIds(root);
    for (const environmentId of environmentIds) this.saveResult(await directoryRepository.getBundles(environmentId));
    return environmentIds.length;
  }

  close(): void {
    this.ownedDatastore?.close();
  }

  private bundleKey(environmentId: string, bundleId: string): string {
    return `${this.repositoryId}\n${environmentId}\n${bundleId}`;
  }

  private bundleProjectionPath(environmentId: string, bundleId: string): string {
    return path.join(this.materializationRoot!, encodePath(environmentId), encodePath(bundleId));
  }
}

function validEnvironmentId(environmentId: string): boolean {
  const separator = environmentId.indexOf(":");
  return separator > 0 && separator < environmentId.length - 1;
}

function defaultEnvironmentRecord(environmentId: string): EnvironmentRecord {
  const envPath = environmentId.split(":")[1] ?? environmentId;
  const displayName = envPath.split("/").filter(Boolean).map((segment) => segment.replace(/[-_]+/g, " ")).join(" / ") || environmentId;
  return { id: environmentId, displayName, description: `Environment ${environmentId}` };
}

function environmentFromRow(row: unknown): EnvironmentRecord {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.environment_id),
    displayName: String(value.display_name),
    description: String(value.description),
  };
}

function groupArtifacts(rows: unknown[]): Record<"skills" | "mcp-servers" | "apps", BundleArtifact[]> {
  const grouped: Record<"skills" | "mcp-servers" | "apps", BundleArtifact[]> = { skills: [], "mcp-servers": [], apps: [] };
  for (const row of rows) {
    const value = row as Record<string, unknown>;
    const kind = String(value.artifact_kind) as keyof typeof grouped;
    if (!(kind in grouped)) continue;
    grouped[kind].push({
      id: String(value.artifact_id),
      files: parseJson<Record<string, string>>(value.files_json, {}),
      ...(typeof value.source_path === "string" ? { sourcePath: value.source_path } : {}),
    });
  }
  return grouped;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function encodePath(value: string): string {
  return value.replaceAll("/", "--").replaceAll(":", "-");
}

async function discoverEnvironmentIds(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isDirectory() && entry.name === ".bundles")) {
      const relative = path.relative(root, directory).split(path.sep).filter(Boolean);
      if (relative.length >= 2) {
        const kind = relative[0];
        const remainder = relative.slice(1).join("/");
        result.push(kind === "dir" ? `dir:/${remainder}` : `${kind}:${remainder}`);
      }
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && !entry.name.startsWith(".")) await walk(path.join(directory, entry.name));
    }
  }
  await walk(root);
  return [...new Set(result)].sort((a, b) => a.localeCompare(b));
}
