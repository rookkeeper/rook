import { afterEach, describe, expect, it } from "vitest";
import { RookDatastore } from "../../infrastructure/datastores/RookDatastore.js";
import { SqliteSessionRepository } from "./SqliteSessionRepository.js";
import { SessionTranscriptRepository } from "./SessionTranscriptRepository.js";

const sessionId = "session-1";

let datastore: RookDatastore;
let transcripts: SessionTranscriptRepository;

afterEach(() => datastore?.close());

async function makeRepository(): Promise<SessionTranscriptRepository> {
  datastore = new RookDatastore(":memory:");
  const sessions = new SqliteSessionRepository(datastore);
  await sessions.save({
    sessionId,
    runtimeId: "runtime",
    runtimeSessionId: "runtime-session",
    title: "test",
    cwd: "/tmp",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attentionStatus: "clear",
    pinned: false,
    pinnedOrder: 0,
  });
  transcripts = new SessionTranscriptRepository(datastore);
  return transcripts;
}

describe("SessionTranscriptRepository", () => {
  it("stores contiguous text chunks as one logical record", async () => {
    const repository = await makeRepository();

    await repository.append(sessionId, { kind: "user_message_chunk", text: "hel" });
    await repository.append(sessionId, { kind: "user_message_chunk", text: "lo" });
    await repository.append(sessionId, { kind: "agent_message_chunk", text: "wor" });
    await repository.append(sessionId, { kind: "agent_message_chunk", text: "ld" });
    await repository.append(sessionId, { kind: "run_completed", stopReason: "end_turn" });

    const records = await repository.list(sessionId);
    expect(records.map((record) => record.event)).toEqual([
      { kind: "user_message_chunk", text: "hello" },
      { kind: "agent_message_chunk", text: "world" },
      { kind: "run_completed", stopReason: "end_turn" },
    ]);
    expect(Number(datastore.db.prepare("SELECT COUNT(*) AS count FROM session_transcript_events WHERE session_id = ?").get(sessionId)?.count)).toBe(3);
  });

  it("keeps separate logical assistant sections around tools", async () => {
    const repository = await makeRepository();

    await repository.append(sessionId, { kind: "agent_message_chunk", text: "before" });
    await repository.append(sessionId, {
      kind: "tool_call",
      toolCallId: "tool-1",
      title: "read",
      toolKind: "read",
      status: "pending",
      rawInput: { path: "README.md" },
    });
    await repository.append(sessionId, { kind: "agent_message_chunk", text: "after" });

    const records = await repository.list(sessionId);
    expect(records.map((record) => record.event.kind)).toEqual([
      "agent_message_chunk",
      "tool_call",
      "agent_message_chunk",
    ]);
    expect(records[0]?.event.text).toBe("before");
    expect(records[2]?.event.text).toBe("after");
  });

  it("merges tool updates into one tool record", async () => {
    const repository = await makeRepository();

    await repository.append(sessionId, {
      kind: "tool_call",
      toolCallId: "tool-1",
      title: "shell",
      toolKind: "execute",
      status: "pending",
      rawInput: { command: "pwd" },
    });
    await repository.append(sessionId, {
      kind: "tool_call_update",
      toolCallId: "tool-1",
      status: "in_progress",
      outputDelta: "/tmp",
      rawOutput: null,
    });
    await repository.append(sessionId, {
      kind: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      outputDelta: "\nrook",
      rawOutput: null,
    });

    const records = await repository.list(sessionId);
    expect(records).toHaveLength(1);
    expect(records[0]?.event).toMatchObject({
      kind: "tool_call",
      toolCallId: "tool-1",
      status: "completed",
      output: "/tmp\nrook",
    });
  });
});
