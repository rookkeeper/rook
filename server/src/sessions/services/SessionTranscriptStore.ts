import type { DatabaseSync } from "node:sqlite";
import type { RookDatastore } from "../../infrastructure/datastores/RookDatastore.js";

export interface TranscriptEventRecord {
  sequence: number;
  sessionId: string;
  createdAt: string;
  event: Record<string, unknown>;
}

/**
 * Durable append-only store of normalized session transcript events.
 * This is owned by the server, not the runtime, so second viewers can hydrate
 * without asking the runtime to replay again.
 */
export class SessionTranscriptStore {
  private readonly db: DatabaseSync;

  constructor(datastore: RookDatastore) {
    this.db = datastore.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_transcript_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_transcript_events_session_idx
        ON session_transcript_events(session_id, sequence ASC);
    `);
  }

  async append(sessionId: string, event: Record<string, unknown>, createdAt = new Date().toISOString()): Promise<number> {
    const result = this.db.prepare(`
      INSERT INTO session_transcript_events (session_id, created_at, event_json)
      VALUES (?, ?, ?)
    `).run(sessionId, createdAt, JSON.stringify(event));
    return Number(result.lastInsertRowid);
  }

  async list(sessionId: string): Promise<TranscriptEventRecord[]> {
    return this.db.prepare(`
      SELECT sequence, session_id, created_at, event_json
      FROM session_transcript_events
      WHERE session_id = ?
      ORDER BY sequence ASC
    `).all(sessionId).map((row) => {
      const value = row as Record<string, unknown>;
      return {
        sequence: Number(value.sequence),
        sessionId: String(value.session_id),
        createdAt: String(value.created_at),
        event: JSON.parse(String(value.event_json)) as Record<string, unknown>,
      };
    });
  }

  async clear(sessionId: string): Promise<void> {
    this.db.prepare(`DELETE FROM session_transcript_events WHERE session_id = ?`).run(sessionId);
  }
}
