import type { DatabaseSync } from "node:sqlite";
import type { PermanentDecision } from "../support/types.js";
import { RookDatastore } from "../../infrastructure/datastores/RookDatastore.js";

/**
 * Repository layer for persistent bundle decisions (Approve / Reject).
 *
 * Backed by Node's built-in `node:sqlite`. The service layer never sees SQL — if we
 * later swap in another backend, only this file changes. Ephemeral decisions
 * (Accept / Ignore) are NOT stored here; they live in memory on the EnvironmentManager.
 *
 * The stored key is a bundle-content hash. Each row also records which
 * environment and bundle the decision was made for, for auditability.
 */
export class EnvironmentDecisionStore {
  private readonly db: DatabaseSync;
  private readonly ownedDatastore: RookDatastore | null;

  /**
   * @param location filesystem path to the SQLite file, or ":memory:" for tests.
   * Defaults to a gitignored runtime location under `.var`.
   */
  constructor(datastore: RookDatastore | string = new RookDatastore()) {
    if (typeof datastore === "string") {
      this.ownedDatastore = new RookDatastore(datastore);
      this.db = this.ownedDatastore.db;
    } else {
      this.ownedDatastore = null;
      this.db = datastore.db;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS environment_decisions (
        bundle_hash TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
        updated_at TEXT NOT NULL
      )
    `);
    // THIS IS COMPATIBILITY CODE
    // Preserves existing SQLite databases created before durable decisions required bundle_id.
    const columns = this.db.prepare("PRAGMA table_info(environment_decisions)").all() as Array<{ name: string; notnull: number }>;
    const bundleColumn = columns.find((column) => column.name === "bundle_id");
    if (bundleColumn && bundleColumn.notnull === 0) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE environment_decisions_v2 (
          bundle_hash TEXT PRIMARY KEY,
          environment_id TEXT NOT NULL,
          bundle_id TEXT NOT NULL,
          decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
          updated_at TEXT NOT NULL
        );
        INSERT INTO environment_decisions_v2 (bundle_hash, environment_id, bundle_id, decision, updated_at)
          SELECT bundle_hash, environment_id, bundle_id, decision, updated_at
          FROM environment_decisions
          WHERE bundle_id IS NOT NULL;
        DROP TABLE environment_decisions;
        ALTER TABLE environment_decisions_v2 RENAME TO environment_decisions;
        COMMIT;
      `);
    }
  }

  getDecision(bundleHash: string): PermanentDecision | null {
    const row = this.db
      .prepare("SELECT decision FROM environment_decisions WHERE bundle_hash = ?")
      .get(bundleHash) as { decision: PermanentDecision } | undefined;
    return row?.decision ?? null;
  }

  setDecision(bundleHash: string, environmentId: string, bundleId: string, decision: PermanentDecision): void {
    this.db
      .prepare(`
        INSERT INTO environment_decisions (bundle_hash, environment_id, bundle_id, decision, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (bundle_hash) DO UPDATE SET environment_id = excluded.environment_id, bundle_id = excluded.bundle_id, decision = excluded.decision, updated_at = excluded.updated_at
      `)
      .run(bundleHash, environmentId, bundleId, decision, new Date().toISOString());
  }

  clearDecision(bundleHash: string): void {
    this.db.prepare("DELETE FROM environment_decisions WHERE bundle_hash = ?").run(bundleHash);
  }

  close(): void {
    this.ownedDatastore?.close();
  }
}
