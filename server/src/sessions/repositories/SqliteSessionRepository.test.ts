import { describe, expect, it } from "vitest";
import { RookDatastore } from "../../infrastructure/datastores/RookDatastore.js";
import { SqliteSessionRepository } from "./SqliteSessionRepository.js";

describe("SqliteSessionRepository", () => {
  it("persists and orders the unified public session space by update time", async () => {
    const datastore = new RookDatastore(":memory:");
    const repository = new SqliteSessionRepository(datastore);
    await repository.save({
      sessionId: "Pi:pi-1",
      runtimeId: "Pi",
      runtimeSessionId: "pi-1",
      title: "Older",
      cwd: "/tmp",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      attentionStatus: "clear",
      pinned: false,
      pinnedOrder: 0,
    });
    await repository.save({
      sessionId: "Claude:claude-1",
      runtimeId: "Claude",
      runtimeSessionId: "claude-1",
      title: "Newer",
      cwd: "/tmp",
      startedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      attentionStatus: "clear",
      pinned: false,
      pinnedOrder: 0,
    });

    expect((await repository.list()).map((session) => session.sessionId)).toEqual(["Claude:claude-1", "Pi:pi-1"]);

    await repository.rename("Pi:pi-1", "Renamed");
    expect((await repository.get("Pi:pi-1"))?.title).toBe("Renamed");
    expect((await repository.list()).map((session) => session.sessionId)).toEqual(["Claude:claude-1", "Pi:pi-1"]);

    await repository.touch("Pi:pi-1", "2026-01-04T00:00:00.000Z");
    expect((await repository.list())[0]?.sessionId).toBe("Pi:pi-1");

    await repository.setPinned("Pi:pi-1", true);
    await repository.setPinned("Claude:claude-1", true);
    expect((await repository.list()).filter((session) => session.pinned).map((session) => session.sessionId)).toEqual(["Pi:pi-1", "Claude:claude-1"]);
    expect((await repository.get("Pi:pi-1"))?.updatedAt).toBe("2026-01-04T00:00:00.000Z");

    await expect(repository.reorderPinned(["Pi:pi-1"])).rejects.toThrow("each currently pinned session");
    await repository.reorderPinned(["Claude:claude-1", "Pi:pi-1"]);
    expect((await repository.list()).filter((session) => session.pinned).map((session) => session.sessionId)).toEqual(["Claude:claude-1", "Pi:pi-1"]);

    await repository.setPinned("Claude:claude-1", false);
    expect((await repository.get("Claude:claude-1"))?.pinned).toBe(false);
    expect((await repository.get("Pi:pi-1"))?.pinnedOrder).toBe(1);

    await repository.replaceEnvironmentIds("Pi:pi-1", ["web:example.com", "location:target"]);
    expect(new Set(await repository.environmentIds("Pi:pi-1"))).toEqual(new Set(["web:example.com", "location:target"]));

    await repository.setAttentionStatus("Pi:pi-1", "ready");
    expect((await repository.get("Pi:pi-1"))?.attentionStatus).toBe("ready");
    expect(() => datastore.db.prepare("UPDATE sessions SET attention_status = 'invalid'").run()).toThrow();

    await repository.delete("Pi:pi-1");
    expect(await repository.get("Pi:pi-1")).toBeUndefined();
    expect(await repository.environmentIds("Pi:pi-1")).toEqual([]);
    repository.close();
    datastore.close();
  });

  it("initializes pin columns in an existing database", async () => {
    const datastore = new RookDatastore(":memory:");
    datastore.db.exec(`CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      runtime_id TEXT NOT NULL,
      runtime_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(runtime_id, runtime_session_id)
    )`);
    datastore.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run("old", "Pi", "old-runtime", "Old", "/tmp", "2026-01-01", "2026-01-01");
    const repository = new SqliteSessionRepository(datastore);
    expect(await repository.get("old")).toMatchObject({ pinned: false, pinnedOrder: 0, attentionStatus: "clear" });
    await repository.setPinned("old", true);
    expect((await repository.get("old"))?.pinned).toBe(true);
    repository.close();
    datastore.close();
  });
});
