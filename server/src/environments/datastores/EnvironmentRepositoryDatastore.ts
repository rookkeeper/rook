import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "../../infrastructure/paths.js";

/** SQLite connection owned by one environment repository, separate from app state. */
export class EnvironmentRepositoryDatastore {
  readonly db: DatabaseSync;

  constructor(location = path.join(REPO_ROOT, "environment-repository.db")) {
    if (location !== ":memory:") mkdirSync(path.dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS environment_repository_environments (
        environment_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS environment_repository_bundles (
        bundle_key TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        environment_id TEXT NOT NULL REFERENCES environment_repository_environments(environment_id) ON DELETE CASCADE,
        bundle_id TEXT NOT NULL,
        valid INTEGER NOT NULL,
        agents_md TEXT,
        source_bundle_path TEXT,
        errors_json TEXT NOT NULL DEFAULT '[]',
        UNIQUE(repository_id, environment_id, bundle_id)
      );
      CREATE INDEX IF NOT EXISTS environment_repository_bundles_environment_idx
        ON environment_repository_bundles(environment_id);

      CREATE TABLE IF NOT EXISTS environment_repository_artifacts (
        bundle_key TEXT NOT NULL REFERENCES environment_repository_bundles(bundle_key) ON DELETE CASCADE,
        artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('skills', 'mcp-servers', 'apps')),
        artifact_id TEXT NOT NULL,
        files_json TEXT NOT NULL,
        source_path TEXT,
        PRIMARY KEY(bundle_key, artifact_kind, artifact_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }
}
