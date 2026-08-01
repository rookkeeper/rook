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
        current_revision_key TEXT,
        UNIQUE(repository_id, environment_id, bundle_id)
      );
      CREATE INDEX IF NOT EXISTS environment_repository_bundles_environment_idx
        ON environment_repository_bundles(environment_id);

      CREATE TABLE IF NOT EXISTS environment_repository_bundle_revisions (
        revision_key TEXT PRIMARY KEY,
        bundle_key TEXT NOT NULL REFERENCES environment_repository_bundles(bundle_key) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        publisher_version TEXT,
        fetched_at TEXT NOT NULL,
        source_locator TEXT,
        provenance_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(bundle_key, content_hash)
      );
      CREATE INDEX IF NOT EXISTS environment_repository_revisions_bundle_idx
        ON environment_repository_bundle_revisions(bundle_key, fetched_at DESC);

      CREATE TABLE IF NOT EXISTS environment_repository_revision_artifacts (
        revision_key TEXT NOT NULL REFERENCES environment_repository_bundle_revisions(revision_key) ON DELETE CASCADE,
        artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('skills', 'mcp-servers', 'apps')),
        artifact_id TEXT NOT NULL,
        files_json TEXT NOT NULL,
        source_path TEXT,
        PRIMARY KEY(revision_key, artifact_kind, artifact_id)
      );
    `);
    // Databases created by the first prototype may lack this column. The old
    // artifact table is intentionally left untouched until an explicit importer
    // rewrites those databases into the revision-aware shape.
    try {
      this.db.exec("ALTER TABLE environment_repository_bundles ADD COLUMN current_revision_key TEXT");
    } catch {
      // Column already exists.
    }
  }

  close(): void {
    this.db.close();
  }
}
