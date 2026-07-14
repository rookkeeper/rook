import { describe, expect, it } from "vitest";
import { SqliteSessionRepository } from "./SqliteSessionRepository.js";

describe("SqliteSessionRepository", () => {
  it("persists and orders the unified public session space by update time", async () => {
    const repository = new SqliteSessionRepository(":memory:");
    await repository.save({
      sessionId: "Pi:pi-1",
      runtimeId: "Pi",
      runtimeSessionId: "pi-1",
      title: "Older",
      cwd: "/tmp",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repository.save({
      sessionId: "Claude:claude-1",
      runtimeId: "Claude",
      runtimeSessionId: "claude-1",
      title: "Newer",
      cwd: "/tmp",
      startedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });

    expect((await repository.list()).map((session) => session.sessionId)).toEqual(["Claude:claude-1", "Pi:pi-1"]);
    await repository.touch("Pi:pi-1", "2026-01-04T00:00:00.000Z");
    expect((await repository.list())[0]?.sessionId).toBe("Pi:pi-1");
    await repository.replaceEnvironmentIds("Pi:pi-1", ["web:example.com", "location:target"]);
    expect(await repository.environmentIds("Pi:pi-1")).toEqual(["web:example.com", "location:target"]);
    repository.close();
  });
});
