import { describe, expect, it } from "vitest";
import { normalizedEventsFromRuntimeMessage, transcriptHasContent } from "./sessionTranscriptEvents.js";

describe("normalizedEventsFromRuntimeMessage", () => {
  it("normalizes ACP terminal commands and output deltas", () => {
    const toolCall = normalizedEventsFromRuntimeMessage({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "find .agents -maxdepth 5",
          kind: "execute",
          status: "pending",
          _meta: { terminal_info: { terminal_id: "tool-1", cwd: "/tmp" } },
        },
      },
    });
    expect(toolCall).toEqual([
      expect.objectContaining({
        kind: "tool_call",
        rawInput: { command: "find .agents -maxdepth 5" },
      }),
    ]);

    const output = normalizedEventsFromRuntimeMessage({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "in_progress",
          _meta: { terminal_output: { terminal_id: "tool-1", data: "AGENTS.md\n" } },
        },
      },
    });
    expect(output).toEqual([
      expect.objectContaining({
        kind: "tool_call_update",
        rawOutput: "AGENTS.md\n",
        outputDelta: "AGENTS.md\n",
      }),
    ]);
  });
});

describe("transcriptHasContent", () => {
  it("treats an empty transcript and bookkeeping-only markers as contentless", () => {
    expect(transcriptHasContent([])).toBe(false);
    expect(transcriptHasContent([
      { kind: "run_failed", message: "Resource not found" },
      { kind: "run_completed", stopReason: "end_turn" },
      { kind: "plan_update", entries: [] },
      { kind: "usage_update", used: 1 },
    ])).toBe(false);
  });

  it("recognizes user, agent, thought, and tool call records as content", () => {
    expect(transcriptHasContent([{ kind: "user_message_chunk", text: "hi" }])).toBe(true);
    expect(transcriptHasContent([{ kind: "agent_message_chunk", text: "hello" }])).toBe(true);
    expect(transcriptHasContent([{ kind: "agent_thought_chunk", text: "hmm" }])).toBe(true);
    expect(transcriptHasContent([{ kind: "run_failed" }, { kind: "tool_call", toolCallId: "tool-1" }])).toBe(true);
  });
});
