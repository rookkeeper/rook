import { describe, expect, it } from "vitest";
import { normalizedEventsFromRuntimeMessage } from "./sessionTranscriptEvents.js";

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
