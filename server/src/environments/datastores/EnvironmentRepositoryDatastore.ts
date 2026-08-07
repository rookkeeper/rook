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
      CREATE INDEX IF NOT EXISTS bundles_environment_idx ON bundles(environment_id);
      CREATE INDEX IF NOT EXISTS bundles_capability_idx ON bundles(capability_id);
    `);
  }
}
