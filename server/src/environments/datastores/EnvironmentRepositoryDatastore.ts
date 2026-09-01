import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "../../infrastructure/paths.js";

/** SQLite connection and schema bootstrap for one environment repository. */
export class EnvironmentRepositoryDatastore {
  readonly db: DatabaseSync;

  constructor(location = path.join(REPO_ROOT, "environment-repository.db")) {
    if (location !== ":memory:") mkdirSync(path.dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
    this.createSchema();
  }

  close(): void {
    this.db.close();
  }

  private createSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS environments (
        environment_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS capabilities (
        capability_id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('skill', 'instructions', 'llms-txt', 'facts', 'mcp', 'app')),
        name TEXT NOT NULL,
        files_json TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bundles (
        bundle_id TEXT NOT NULL,
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE CASCADE,
        capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
        publisher TEXT NOT NULL DEFAULT 'default',
        deleted_at TEXT,
        PRIMARY KEY (bundle_id, capability_id)
      );
    `);
    this.migrateRepositoryScopedSchema();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS bundles_environment_idx ON bundles(environment_id);
      CREATE INDEX IF NOT EXISTS bundles_capability_idx ON bundles(capability_id);
    `);
  }

  /**
   * An interim revision of this branch scoped environment rows and bundle keys by
   * repository. That shape never shipped in a release, but databases that ran it
   * exist; collapse them back to the repository-neutral schema. Personal identity
   * wins where a web row duplicated an environment, and web bundle rows keep the
   * scouted host as their publisher.
   */
  private migrateRepositoryScopedSchema(): void {
    const environmentColumns = this.db.prepare("PRAGMA table_info(environments)").all() as Array<Record<string, unknown>>;
    const bundleColumns = this.db.prepare("PRAGMA table_info(bundles)").all() as Array<Record<string, unknown>>;
    if (!environmentColumns.some((column) => column.name === "repository") && !bundleColumns.some((column) => column.name === "repository")) return;

    const environmentRows = this.db.prepare("SELECT environment_id, repository, display_name, description, metadata_json FROM environments").all() as Array<Record<string, unknown>>;
    const bundleRows = this.db.prepare("SELECT bundle_id, environment_id, repository, capability_id, publisher, deleted_at FROM bundles").all() as Array<Record<string, unknown>>;
    const environments = new Map<string, { displayName: string; description: string; metadata: Record<string, unknown> }>();
    environmentRows.sort((left, right) => (String(left.repository) === "personal" ? -1 : 0) - (String(right.repository) === "personal" ? -1 : 0));
    for (const row of environmentRows) {
      const id = String(row.environment_id);
      const existing = environments.get(id);
      const metadata = { ...(existing?.metadata ?? {}), ...parseMetadata(row.metadata_json) };
      environments.set(id, {
        // Personal identity wins over the web display fallback when both existed.
        displayName: existing?.displayName ?? String(row.display_name),
        description: existing?.description ?? String(row.description),
        metadata,
      });
    }

    this.db.exec("PRAGMA foreign_keys = OFF");
    try {
      this.db.exec(`
        BEGIN;
        DROP INDEX IF EXISTS bundles_environment_idx;
        DROP INDEX IF EXISTS bundles_capability_idx;
        ALTER TABLE bundles RENAME TO bundles_legacy_repository_scope;
        ALTER TABLE environments RENAME TO environments_legacy_repository_scope;

        CREATE TABLE environments (
          environment_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          description TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE bundles (
          bundle_id TEXT NOT NULL,
          environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE CASCADE,
          capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
          publisher TEXT NOT NULL DEFAULT 'default',
          deleted_at TEXT,
          PRIMARY KEY (bundle_id, capability_id)
        );
      `);
      const insertEnvironment = this.db.prepare(`
        INSERT INTO environments (environment_id, display_name, description, metadata_json)
        VALUES (?, ?, ?, ?)
      `);
      for (const [id, environment] of environments) {
        insertEnvironment.run(id, environment.displayName, environment.description, JSON.stringify(environment.metadata));
      }

      const insertBundle = this.db.prepare(`
        INSERT OR IGNORE INTO bundles (bundle_id, environment_id, capability_id, publisher, deleted_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const row of bundleRows) {
        const repository = String(row.repository);
        const oldPublisher = String(row.publisher ?? "default");
        const publisher = repository === "personal"
          ? "personal"
          : repository === "web"
            ? (oldPublisher === "default" ? hostFromEnvironmentId(String(row.environment_id)) : oldPublisher)
            : oldPublisher;
        insertBundle.run(String(row.bundle_id), String(row.environment_id), String(row.capability_id), publisher, row.deleted_at == null ? null : String(row.deleted_at));
      }
      this.db.exec(`
        DROP TABLE bundles_legacy_repository_scope;
        DROP TABLE environments_legacy_repository_scope;
        COMMIT;
      `);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON");
    }
  }
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

function hostFromEnvironmentId(environmentId: string): string {
  return environmentId.startsWith("web:") ? environmentId.slice("web:".length) : "web";
}
