import { describe, expect, it } from "vitest";
import { boundedClientMessage, MAX_CLIENT_MESSAGE_BYTES } from "./clientMessage.js";

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

describe("boundedClientMessage", () => {
  it("preserves messages within the client limit", () => {
    const message = { jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } } };
    expect(boundedClientMessage(message)).toEqual(message);
  });

  it("preserves presentation messages up to the 1 MB client limit", () => {
    const message = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } } },
    };
    const textBytes = MAX_CLIENT_MESSAGE_BYTES - serializedBytes(message);
    const bounded = { ...message, params: { ...message.params, update: { ...message.params.update, content: { type: "text", text: "A".repeat(textBytes) } } } };

    expect(serializedBytes(bounded)).toBe(MAX_CLIENT_MESSAGE_BYTES);
    expect(boundedClientMessage(bounded)).toEqual(bounded);
  });

  it("truncates oversized tool output while preserving the ACP update identity", () => {
    const message = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          rawOutput: { role: "toolResult", content: [{ type: "image", data: "A".repeat(2_000_000) }] },
        },
      },
    };

    const bounded = boundedClientMessage(message);
    expect(serializedBytes(bounded)).toBeLessThanOrEqual(MAX_CLIENT_MESSAGE_BYTES);
    expect(bounded.params).toMatchObject({
      sessionId: "session-1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" },
    });
    expect(JSON.stringify(bounded)).not.toContain("A".repeat(1_000));
    expect(JSON.stringify(bounded)).toContain("[Rook truncated this presentation payload because it exceeded 1 MB.]");
  });
});
