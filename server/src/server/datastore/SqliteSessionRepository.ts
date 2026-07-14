import type { DatabaseSync } from "node:sqlite";
import type { SessionRecord, SessionRepository } from "../repositories/SessionRepository.js";
import { RookDatastore } from "./RookDatastore.js";

/** SQLite datastore implementation for the unified public session space. */
export class SqliteSessionRepository implements SessionRepository {
  private readonly db: DatabaseSync;
  private readonly ownedDatastore: RookDatastore | null;

  constructor(datastore: RookDatastore | string = new RookDatastore()) {
    if (typeof datastore === "string") {
      this.ownedDatastore = new RookDatastore(datastore);
      this.db = this.ownedDatastore.db;
    } else {
      this.ownedDatastore = null;
      this.db = datastore.db;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        runtime_session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(runtime_id, runtime_session_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS session_environments (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        environment_id TEXT NOT NULL,
        entered_at TEXT NOT NULL,
        PRIMARY KEY (session_id, environment_id)
      );
    `);
  }

  async list(): Promise<SessionRecord[]> {
    return this.db.prepare(`
      SELECT session_id, runtime_id, runtime_session_id, title, cwd, started_at, updated_at
      FROM sessions ORDER BY updated_at DESC
    `).all().map(rowToRecord);
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const row = this.db.prepare(`
      SELECT session_id, runtime_id, runtime_session_id, title, cwd, started_at, updated_at
      FROM sessions WHERE session_id = ?
    `).get(sessionId);
    return row ? rowToRecord(row) : undefined;
  }

  async save(record: SessionRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO sessions (session_id, runtime_id, runtime_session_id, title, cwd, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        runtime_id = excluded.runtime_id,
        runtime_session_id = excluded.runtime_session_id,
        title = excluded.title,
        cwd = excluded.cwd,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `).run(record.sessionId, record.runtimeId, record.runtimeSessionId, record.title, record.cwd, record.startedAt, record.updatedAt);
  }

  async touch(sessionId: string, updatedAt = new Date().toISOString()): Promise<void> {
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE session_id = ?").run(updatedAt, sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    this.db.prepare("DELETE FROM session_environments WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  async environmentIds(sessionId: string): Promise<string[]> {
    return this.db.prepare("SELECT environment_id FROM session_environments WHERE session_id = ? ORDER BY entered_at, environment_id")
      .all(sessionId)
      .map((row) => String((row as Record<string, unknown>).environment_id));
  }

  async replaceEnvironmentIds(sessionId: string, environmentIds: string[]): Promise<void> {
    const ids = [...new Set(environmentIds)];
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM session_environments WHERE session_id = ?").run(sessionId);
      const insert = this.db.prepare("INSERT INTO session_environments (session_id, environment_id, entered_at) VALUES (?, ?, ?)");
      const now = new Date().toISOString();
      for (const environmentId of ids) insert.run(sessionId, environmentId, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.ownedDatastore?.close();
  }
}

function rowToRecord(row: unknown): SessionRecord {
  const value = row as Record<string, unknown>;
  return {
    sessionId: String(value.session_id),
    runtimeId: String(value.runtime_id),
    runtimeSessionId: String(value.runtime_session_id),
    title: String(value.title),
    cwd: String(value.cwd),
    startedAt: String(value.started_at),
    updatedAt: String(value.updated_at),
  };
}
