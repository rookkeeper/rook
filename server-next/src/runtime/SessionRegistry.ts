import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SessionRecord } from "./types.js";

export class SessionRegistry {
  private readonly records = new Map<string, SessionRecord>();

  constructor(private readonly storagePath: string) {
    if (!existsSync(storagePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(storagePath, "utf8")) as SessionRecord[];
      for (const record of parsed) {
        if (record?.sessionId && record.runtimeId && record.runtimeSessionId && record.cwd && record.updatedAt && record.startedAt && record.title) {
          this.records.set(record.sessionId, record);
        }
      }
    } catch {
      // A playground registry is disposable; start empty if its file is invalid.
    }
  }

  list(): SessionRecord[] {
    return [...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.records.get(sessionId);
  }

  save(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.persist();
  }

  touch(sessionId: string): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    record.updatedAt = new Date().toISOString();
    this.persist();
  }

  updateInfo(sessionId: string, update: Record<string, unknown>): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    if (typeof update.title === "string") record.title = update.title;
    else if (update.title === null) record.title = "session";
    if (typeof update.updatedAt === "string") record.updatedAt = update.updatedAt;
    else record.updatedAt = new Date().toISOString();
    this.persist();
  }

  private persist(): void {
    mkdirSync(path.dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, JSON.stringify(this.list(), null, 2) + "\n", "utf8");
  }
}
