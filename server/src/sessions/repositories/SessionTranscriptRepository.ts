import type { DatabaseSync } from "node:sqlite";
import type { RookDatastore } from "../../infrastructure/datastores/RookDatastore.js";

export interface TranscriptEventRecord {
  sequence: number;
  sessionId: string;
  createdAt: string;
  event: Record<string, unknown>;
}

const LOGICAL_TRANSCRIPT_MIGRATION = "logical-transcript-v1";

/**
 * Durable logical transcript records owned by the server, not the runtime.
 *
 * ACP notifications are chunked for streaming, but the transcript stores one
 * record per logical text section and one record per tool call. In-progress
 * records are updated in place so a second viewer can hydrate a running turn
 * without creating one database row per token.
 */
export class SessionTranscriptRepository {
  private readonly db: DatabaseSync;
  private readonly sessionQueues = new Map<string, Promise<void>>();

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
      CREATE TABLE IF NOT EXISTS session_transcript_migrations (
        migration_key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    this.clearLegacyTranscriptOnce();
  }

  async append(sessionId: string, event: Record<string, unknown>, createdAt = new Date().toISOString()): Promise<number> {
    return this.enqueue(sessionId, () => {
      const latest = this.readLatest(sessionId);
      const kind = typeof event.kind === "string" ? event.kind : "";
      let target: TranscriptEventRecord | undefined;
      if (isTextKind(kind) && latest?.event.kind === kind) target = latest;
      if ((kind === "plan_update" || kind === "usage_update") && latest?.event.kind === kind) target = latest;
      if (kind === "tool_call" || kind === "tool_call_update") {
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
        if (toolCallId) target = this.readLatestToolCall(sessionId, toolCallId);
      }
      if (target) {
        target.event = mergeExistingRecord(target.event, event);
        this.update(target.sequence, target.event);
        return target.sequence;
      }

      const eventToInsert = event.kind === "tool_call_update" ? toolCallFromUpdate(event) : event;
      const result = this.db.prepare(`
        INSERT INTO session_transcript_events (session_id, created_at, event_json)
        VALUES (?, ?, ?)
      `).run(sessionId, createdAt, JSON.stringify(eventToInsert));
      return Number(result.lastInsertRowid);
    });
  }

  async list(sessionId: string): Promise<TranscriptEventRecord[]> {
    return this.enqueue(sessionId, () => this.read(sessionId));
  }

  async clear(sessionId: string): Promise<void> {
    await this.enqueue(sessionId, () => {
      this.db.prepare(`DELETE FROM session_transcript_events WHERE session_id = ?`).run(sessionId);
    });
  }

  private clearLegacyTranscriptOnce(): void {
    const applied = this.db.prepare(`
      SELECT migration_key FROM session_transcript_migrations WHERE migration_key = ?
    `).get(LOGICAL_TRANSCRIPT_MIGRATION);
    if (applied) return;

    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM session_transcript_events");
      this.db.prepare(`
        INSERT INTO session_transcript_migrations (migration_key, applied_at)
        VALUES (?, ?)
      `).run(LOGICAL_TRANSCRIPT_MIGRATION, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private read(sessionId: string): TranscriptEventRecord[] {
    return this.db.prepare(`
      SELECT sequence, session_id, created_at, event_json
      FROM session_transcript_events
      WHERE session_id = ?
      ORDER BY sequence ASC
    `).all(sessionId).map(rowToTranscriptEvent);
  }

  private readLatest(sessionId: string): TranscriptEventRecord | undefined {
    const records = this.db.prepare(`
      SELECT sequence, session_id, created_at, event_json
      FROM session_transcript_events
      WHERE session_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).all(sessionId);
    return records.length === 0 ? undefined : rowToTranscriptEvent(records[0]);
  }

  private readLatestToolCall(sessionId: string, toolCallId: string): TranscriptEventRecord | undefined {
    const records = this.db.prepare(`
      SELECT sequence, session_id, created_at, event_json
      FROM session_transcript_events
      WHERE session_id = ?
        AND json_extract(event_json, '$.kind') = 'tool_call'
        AND json_extract(event_json, '$.toolCallId') = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).all(sessionId, toolCallId);
    return records.length === 0 ? undefined : rowToTranscriptEvent(records[0]);
  }

  private update(sequence: number, event: Record<string, unknown>): void {
    this.db.prepare(`UPDATE session_transcript_events SET event_json = ? WHERE sequence = ?`)
      .run(JSON.stringify(event), sequence);
  }

  private enqueue<T>(sessionId: string, operation: () => T): Promise<T> {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.sessionQueues.set(sessionId, next.then(() => undefined, () => undefined));
    return next;
  }
}

function rowToTranscriptEvent(row: unknown): TranscriptEventRecord {
  const value = row as Record<string, unknown>;
  return {
    sequence: Number(value.sequence),
    sessionId: String(value.session_id),
    createdAt: String(value.created_at),
    event: JSON.parse(String(value.event_json)) as Record<string, unknown>,
  };
}

function mergeExistingRecord(base: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const kind = typeof update.kind === "string" ? update.kind : "";
  if (isTextKind(kind)) return { ...base, text: stringValue(base.text) + stringValue(update.text) };
  if (kind === "tool_call" || kind === "tool_call_update") return mergeToolCall(base, update);
  return { ...update };
}

function toolCallFromUpdate(update: Record<string, unknown>): Record<string, unknown> {
  const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "unknown-tool";
  return mergeToolCall({
    kind: "tool_call",
    toolCallId,
    title: typeof update.toolName === "string" ? update.toolName : "Tool",
    toolKind: "",
    status: "pending",
    rawInput: null,
  }, update);
}

function mergeToolCall(base: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base };
  if (typeof update.title === "string" && (!merged.title || merged.title === "Tool")) merged.title = update.title;
  if (typeof update.toolName === "string" && (!merged.title || merged.title === "Tool")) merged.title = update.toolName;
  if (typeof update.rawInput !== "undefined") merged.rawInput = update.rawInput;
  if (typeof update.status === "string" && update.status.length > 0) merged.status = update.status;

  const outputDelta = typeof update.outputDelta === "string" ? update.outputDelta : undefined;
  if (outputDelta !== undefined) {
    merged.output = stringValue(merged.output) + outputDelta;
  } else if (update.rawOutput !== undefined && update.rawOutput !== null) {
    merged.output = update.rawOutput;
  }
  return merged;
}

function isTextKind(kind: string): boolean {
  return kind === "user_message_chunk" || kind === "agent_message_chunk" || kind === "agent_thought_chunk";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}
