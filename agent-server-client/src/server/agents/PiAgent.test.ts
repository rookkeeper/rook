import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../shared/realtime";
import { REPO_ROOT } from "../paths";
import { PiAgent } from "./PiAgent";

const MY_AGENT_PACKAGE = path.join(REPO_ROOT, "..", "my-agent");

function attachEventCollector(agent: PiAgent): SessionEvent[] {
  const events: SessionEvent[] = [];
  agent.setEventSink((event) => events.push(event));
  return events;
}

describe("PiAgent startup args", () => {
  it("passes multiple skill directories to pi", () => {
    const agent = new PiAgent({ skillPaths: ["/tmp/a/skills", "/tmp/b/skills"] });
    const args = (agent as unknown as { getPiArgs: () => string[] }).getPiArgs();

    expect(args).toEqual(["--mode", "rpc", "--skill", "/tmp/a/skills", "--skill", "/tmp/b/skills"]);
  });

  it("passes extension paths to pi", () => {
    const agent = new PiAgent({ extensionPaths: ["/tmp/parentMessageTool.ts"] });
    const args = (agent as unknown as { getPiArgs: () => string[] }).getPiArgs();

    expect(args).toEqual(["--mode", "rpc", "-e", "/tmp/parentMessageTool.ts"]);
  });

  it("supports configured pi args while merging restart and requested skill paths", () => {
    const agent = new PiAgent({
      args: ["-e", MY_AGENT_PACKAGE, "--mode", "rpc"],
      skillPaths: ["/tmp/b/skills"],
      extensionPaths: ["/tmp/parentMessageTool.ts"],
      agentName: "MyPiAgent",
    });
    const args = (agent as unknown as { getPiArgs: (metadata?: Record<string, unknown>) => string[] }).getPiArgs({
      sessionId: "s1",
      skillPaths: ["/tmp/a/skills", "/tmp/b/skills"],
    });

    expect(args).toEqual(["-e", MY_AGENT_PACKAGE, "--mode", "rpc", "-e", "/tmp/parentMessageTool.ts", "--skill", "/tmp/a/skills", "--skill", "/tmp/b/skills", "--session", "s1"]);
  });
});

describe("PiAgent event handling", () => {
  it("maps assistant text and thinking events to session events", () => {
    const agent = new PiAgent();
    const events = attachEventCollector(agent);
    const handleEvent = (agent as unknown as { handleEvent: (event: Record<string, unknown>) => void }).handleEvent.bind(agent);

    handleEvent({ type: "message_start", message: { role: "assistant", id: "m1", model: "gpt", provider: "test" } });
    handleEvent({ type: "message_update", message: { id: "m1" }, assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } });
    handleEvent({ type: "message_update", message: { id: "m1" }, assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    handleEvent({ type: "message_end", message: { role: "assistant", id: "m1" } });

    expect(events).toContainEqual({ type: "assistant_message_started", id: "m1", model: "gpt", provider: "test" });
    expect(events).toContainEqual({ type: "thinking_delta", delta: "hmm" });
    expect(events).toContainEqual({ type: "text_delta", delta: "hello" });
    expect(events).toContainEqual({ type: "assistant_message_completed", id: "m1" });
  });

  it("maps tool call and tool execution events", () => {
    const agent = new PiAgent();
    const events = attachEventCollector(agent);
    const handleEvent = (agent as unknown as { handleEvent: (event: Record<string, unknown>) => void }).handleEvent.bind(agent);

    handleEvent({
      type: "message_update",
      message: { id: "m1" },
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        toolCall: { id: "tool-1", name: "read" },
      },
    });
    handleEvent({ type: "message_update", message: { id: "m1" }, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"path"' } });
    handleEvent({ type: "message_update", message: { id: "m1" }, assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { id: "tool-1", name: "read" } } });
    handleEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read" });
    handleEvent({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "read", partialResult: { content: "partial" } });
    handleEvent({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: { content: [{ text: "done" }] } });

    expect(events).toContainEqual({ type: "tool_call_started", toolCallId: "tool-1", toolName: "read", rawInput: "" });
    expect(events).toContainEqual({ type: "tool_input_delta", toolCallId: "tool-1", toolName: "read", delta: '{"path"' });
    expect(events).toContainEqual({ type: "tool_call_ready", toolCallId: "tool-1", toolName: "read" });
    expect(events).toContainEqual({ type: "status_changed", status: "using_tool", message: "Using read" });
    expect(events).toContainEqual({ type: "tool_running", toolCallId: "tool-1" });
    expect(events).toContainEqual({ type: "tool_output_delta", toolCallId: "tool-1", toolName: "read", delta: "partial" });
    expect(events).toContainEqual({ type: "tool_completed", toolCallId: "tool-1", toolName: "read", output: "done" });
  });

  it("surfaces an error when a turn ends without producing any assistant content", () => {
    const agent = new PiAgent();
    const events = attachEventCollector(agent);
    const handleEvent = (agent as unknown as { handleEvent: (event: Record<string, unknown>) => void }).handleEvent.bind(agent);

    // Pi fails silently (e.g. invalid auth token): an assistant turn with no text,
    // thinking, or tool calls, then agent_end.
    handleEvent({ type: "agent_start" });
    handleEvent({ type: "message_start", message: { role: "assistant", id: "m1" } });
    handleEvent({ type: "message_end", message: { role: "assistant", id: "m1" } });
    handleEvent({ type: "agent_end" });

    const runFailed = events.find((event) => event.type === "run_failed");
    expect(runFailed).toBeDefined();
    expect(runFailed && "error" in runFailed ? runFailed.error : "").toContain("sign in");
    expect(events).toContainEqual({ type: "assistant_message_error", error: expect.stringContaining("empty response") });
    expect(events.some((event) => event.type === "run_completed")).toBe(false);
  });

  it("completes normally when the turn produced assistant text", () => {
    const agent = new PiAgent();
    const events = attachEventCollector(agent);
    const handleEvent = (agent as unknown as { handleEvent: (event: Record<string, unknown>) => void }).handleEvent.bind(agent);

    handleEvent({ type: "agent_start" });
    handleEvent({ type: "message_start", message: { role: "assistant", id: "m1" } });
    handleEvent({ type: "message_update", message: { id: "m1" }, assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    handleEvent({ type: "message_end", message: { role: "assistant", id: "m1" } });
    handleEvent({ type: "agent_end" });

    expect(events).toContainEqual({ type: "run_completed" });
    expect(events.some((event) => event.type === "run_failed")).toBe(false);
  });

  it("reports protocol errors for malformed tool events", () => {
    const agent = new PiAgent();
    const events = attachEventCollector(agent);
    const handleEvent = (agent as unknown as { handleEvent: (event: Record<string, unknown>) => void }).handleEvent.bind(agent);

    handleEvent({ type: "tool_execution_start", toolName: "read" });

    expect(events).toContainEqual({ type: "protocol_error", error: "Pi tool_execution_start did not include toolCallId." });
  });
});
