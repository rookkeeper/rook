import { describe, expect, it } from "vitest";
import { translateSessionEventToAcp } from "./sessionEventToAcp";

describe("sessionEventToAcp", () => {
  it("translates user and assistant message streaming into ACP session/update notifications", () => {
    expect(translateSessionEventToAcp("s1", { type: "user_message", id: "m1", text: "hello", queued: false }, 3)).toEqual([
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          _meta: { rookery: { sequence: 3 } },
          update: {
            sessionUpdate: "user_message_chunk",
            messageId: "m1",
            content: { type: "text", text: "hello" },
            _meta: { rookery: { sequence: 3 } },
          },
        },
      },
    ]);

    expect(translateSessionEventToAcp("s1", { type: "text_delta", delta: "world" }, 4)).toEqual([
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          _meta: { rookery: { sequence: 4 } },
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "world" },
            _meta: { rookery: { sequence: 4 } },
          },
        },
      },
    ]);
  });

  it("preserves tool metadata needed by the client model", () => {
    expect(translateSessionEventToAcp("s1", { type: "tool_call_started", toolCallId: "tool-1", toolName: "search", rawInput: '{"q":"acp"}' }, 5)).toEqual([
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "search",
            status: "pending",
            _meta: { rookery: { sequence: 5, rawInput: '{"q":"acp"}' } },
          }),
        }),
      }),
    ]);

    expect(translateSessionEventToAcp("s1", { type: "tool_completed", toolCallId: "tool-1", toolName: "search", output: "done" }, 6)).toEqual([
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
            _meta: { rookery: { sequence: 6, toolName: "search" } },
          }),
        }),
      }),
    ]);
  });

  it("sends custom ACP updates for run and environment state", () => {
    expect(translateSessionEventToAcp("s1", { type: "run_completed" }, 7)).toEqual([
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: { sessionUpdate: "_rookery_run_completed", _meta: { rookery: { sequence: 7 } } },
        }),
      }),
    ]);

    expect(translateSessionEventToAcp("s1", { type: "environment_event", kind: "environment_offer_available", payload: { environmentId: "demo:demo" } }, 8)).toEqual([
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: {
            sessionUpdate: "_rookery_environment_event",
            kind: "environment_offer_available",
            payload: { environmentId: "demo:demo" },
            _meta: { rookery: { sequence: 8 } },
          },
        }),
      }),
    ]);
  });
});
