import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { SessionEvent } from "../../shared/realtime";
import { MockAgent } from "./MockAgent";
import { getSessionLogPath, setSessionLogPath } from "./sessionLog";

function attachEventCollector(agent: MockAgent): SessionEvent[] {
  const events: SessionEvent[] = [];
  agent.setEventSink((event) => events.push(event));
  return events;
}

async function flushRun(promise: Promise<void>) {
  await vi.runAllTimersAsync();
  await promise;
}

describe("MockAgent", () => {
  beforeEach(() => {
    (MockAgent as unknown as { turnIndex: number; messageIndex: number }).turnIndex = 0;
    (MockAgent as unknown as { turnIndex: number; messageIndex: number }).messageIndex = 0;
    setSessionLogPath(path.join(os.tmpdir(), `agent-station-mock-${crypto.randomUUID()}.jsonl`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers sessions with only the agent class name and session name", async () => {
    const agent = new MockAgent();
    agent.setSessionName("Planning");

    await agent.ensureStarted();

    const [line] = (await readFile(getSessionLogPath(), "utf8")).trim().split("\n");
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record.agent).toBe("MockAgent");
    expect(record.name).toBe("Planning");
    expect(record).not.toHaveProperty("displayName");
  });

  it("rejects an active run when stopped", async () => {
    const agent = new MockAgent();
    attachEventCollector(agent);
    const promise = agent.run("stop this run");

    await agent.stop();

    await expect(promise).rejects.toThrow("MockAgent stopped.");
  });

  it("accepts a user message, streams content, uses tools, and completes", async () => {
    vi.useFakeTimers();
    const agent = new MockAgent({});
    const events = attachEventCollector(agent);
    const promise = agent.run("Summarize planning");

    await flushRun(promise);

    expect(events).toContainEqual(expect.objectContaining({ type: "user_message", text: "Summarize planning", queued: false }));
    expect(events).toContainEqual({ type: "status_changed", status: "busy", message: "Agent is working" });
    expect(events.some((event) => event.type === "thinking_delta")).toBe(true);
    expect(events.some((event) => event.type === "text_delta")).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_started", toolName: "read_note" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_completed", toolName: "write" }));
    expect(events).toContainEqual({ type: "run_completed" });
    expect(events.at(-1)).toEqual({ type: "status_changed", status: "idle", message: "Ready" });
  });

  it("surfaces the mock failure turn through run_failed", async () => {
    vi.useFakeTimers();
    const firstAgent = new MockAgent({});
    attachEventCollector(firstAgent);
    const first = firstAgent.run("first");
    await flushRun(first);

    const secondAgent = new MockAgent({});
    attachEventCollector(secondAgent);
    const second = secondAgent.run("second");
    await flushRun(second);

    const agent = new MockAgent({});
    const events = attachEventCollector(agent);
    const third = agent.run("third");
    await flushRun(third);

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_error", error: "File not found: Missing Planning Appendix.md" }));
    expect(events).toContainEqual({ type: "run_failed", error: "Mock provider stopped after the missing-file tool failure." });
    expect(events.at(-1)).toEqual({
      type: "status_changed",
      status: "error",
      message: "Mock provider stopped after the missing-file tool failure.",
    });
  });
});
