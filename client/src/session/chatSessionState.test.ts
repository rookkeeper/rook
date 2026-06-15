import { describe, expect, it } from "vitest";
import { createInitialChatSessionState, finalizeStreamingBlocks, reduceChatSession, type ChatSessionState } from "./chatSessionState";

function baseState(): ChatSessionState {
  return createInitialChatSessionState();
}

describe("chatSessionState", () => {
  it("queues messages and updates queued status", () => {
    const state = reduceChatSession(baseState(), {
      type: "USER_MESSAGE_QUEUED",
      message: { id: "q1", text: "hello", draftText: "hello", isEditing: false },
    });

    expect(state.queuedMessages).toHaveLength(1);
    expect(state.status).toEqual({ status: "queued", message: "1 queued message" });
  });

  it("appends streaming assistant chunks to the active assistant block", () => {
    let state = reduceChatSession(baseState(), { type: "AGENT_MESSAGE_CHUNK", text: "Hello" });
    state = reduceChatSession(state, { type: "AGENT_MESSAGE_CHUNK", text: " world" });

    expect(state.blocks).toEqual([
      { type: "text", role: "assistant", text: "Hello world", isStreaming: true },
    ]);
  });

  it("creates and updates tool blocks through input/running/completed states", () => {
    let state = reduceChatSession(baseState(), {
      type: "TOOL_CALL_STARTED",
      toolCallId: "tool-1",
      toolName: "Read File",
      rawInput: '{\n  "path": "README.md"\n}',
    });

    state = reduceChatSession(state, {
      type: "TOOL_INPUT_DELTA",
      toolCallId: "tool-1",
      delta: '{\n  "path": "README.md",\n  "offset": 1\n}',
    });

    state = reduceChatSession(state, { type: "TOOL_RUNNING", toolCallId: "tool-1" });
    state = reduceChatSession(state, {
      type: "TOOL_COMPLETED",
      toolCallId: "tool-1",
      toolName: "Read File",
      output: "# Title",
    });

    expect(state.blocks).toEqual([
      {
        type: "toolBlock",
        id: "tool-1",
        name: "Read File",
        status: "completed",
        arguments: '{\n  "path": "README.md",\n  "offset": 1\n}',
        argumentsStreaming: false,
        result: "# Title",
        isError: false,
      },
    ]);
  });

  it("restores queued status after run completion when queued messages remain", () => {
    let state = reduceChatSession(baseState(), {
      type: "USER_MESSAGE_QUEUED",
      message: { id: "q1", text: "a", draftText: "a", isEditing: false },
    });
    state = reduceChatSession(state, {
      type: "STATUS_CHANGED",
      status: "busy",
      message: "Agent is working",
    });

    state = reduceChatSession(state, { type: "RUN_COMPLETED", stopReason: "end_turn" });

    expect(state.isAgentProcessing).toBe(false);
    expect(state.status).toEqual({ status: "queued", message: "1 queued message" });
  });

  it("turns failures into error blocks and clears pending permission", () => {
    let state = reduceChatSession(baseState(), {
      type: "PERMISSION_REQUESTED",
      requestId: "perm-1",
      toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    });

    state = reduceChatSession(state, {
      type: "RUN_FAILED",
      error: "Remote exploded",
      source: "connection",
    });

    expect(state.pendingPermission).toBeNull();
    expect(state.status).toEqual({ status: "error", message: "Remote exploded" });
    expect(state.blocks.at(-1)).toEqual({ type: "error", source: "connection", message: "Remote exploded" });
  });

  it("finalizes streaming blocks", () => {
    const finalized = finalizeStreamingBlocks([
      { type: "text", role: "assistant", text: "Hello", isStreaming: true },
      { type: "thinking", thinking: "plan", isStreaming: true },
      { type: "toolBlock", id: "tool-1", name: "Read", status: "input_streaming", arguments: "{}", argumentsStreaming: true, result: null, isError: false },
    ]);

    expect(finalized).toEqual([
      { type: "text", role: "assistant", text: "Hello", isStreaming: false },
      { type: "thinking", thinking: "plan", isStreaming: false },
      { type: "toolBlock", id: "tool-1", name: "Read", status: "ready", arguments: "{}", argumentsStreaming: false, result: null, isError: false },
    ]);
  });
});
