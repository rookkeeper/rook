import { describe, expect, it } from "vitest";
import { acpServerMessageToSessionEvents } from "./acpToSessionEvent";

describe("acpToSessionEvent", () => {
  it("maps ACP tool lifecycle updates into session events", () => {
    expect(acpServerMessageToSessionEvents({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "search",
          _meta: { rookery: { rawInput: '{"q":"acp"}' } },
        },
      },
    })).toEqual([{ type: "tool_call_started", toolCallId: "tool-1", toolName: "search", rawInput: '{"q":"acp"}' }]);

    expect(acpServerMessageToSessionEvents({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "done" } }],
          _meta: { rookery: { toolName: "search" } },
        },
      },
    })).toEqual([{ type: "tool_completed", toolCallId: "tool-1", toolName: "search", output: "done" }]);

    expect(acpServerMessageToSessionEvents({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "boom" } }],
          _meta: { rookery: { toolName: "search" } },
        },
      },
    })).toEqual([{ type: "tool_error", toolCallId: "tool-1", toolName: "search", error: "boom" }]);
  });

  it("maps ACP prompt/runtime failures into connection or run failures", () => {
    expect(acpServerMessageToSessionEvents({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "_rookery_run_failed", error: "cancelled" },
      },
    })).toEqual([{ type: "run_failed", error: "cancelled" }]);

    expect(acpServerMessageToSessionEvents({
      jsonrpc: "2.0",
      id: "prompt-1",
      error: { code: -32000, message: "transport broke" },
    })).toEqual([{ type: "connection_error", error: "transport broke" }]);
  });
});
