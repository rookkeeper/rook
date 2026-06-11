import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../shared/realtime";
import { BaseAgent } from "./BaseAgent";

const FIXTURE = path.resolve("src/server/agents/test-fixtures/mockAcpServer.mjs");

function attachEventCollector(agent: BaseAgent): SessionEvent[] {
  const events: SessionEvent[] = [];
  agent.setEventSink((event) => events.push(event));
  return events;
}

describe("BaseAgent", () => {
  it("starts a new ACP session and translates prompt output", async () => {
    const agent = new BaseAgent({
      command: "node",
      args: [FIXTURE],
      cwd: path.resolve("."),
      sessionCwd: path.resolve("."),
      agentName: "TestAcpAgent",
    });
    const events = attachEventCollector(agent);

    await agent.ensureStarted();
    await agent.run("hello");

    expect(agent.record?.restart).toEqual({ sessionId: "acp-session-1", cwd: path.resolve(".") });
    expect(events).toContainEqual({ type: "user_message", text: "hello", queued: false });
    expect(events).toContainEqual({ type: "text_delta", delta: "echo:hello" });
    expect(events).toContainEqual({ type: "run_completed" });

    await agent.stop();
  });

  it("reloads an existing ACP session", async () => {
    const agent = new BaseAgent({
      command: "node",
      args: [FIXTURE],
      cwd: path.resolve("."),
      sessionCwd: path.resolve("."),
      agentName: "TestAcpAgent",
    }, {
      sessionId: "restored-session",
      cwd: path.resolve("."),
    });
    const events = attachEventCollector(agent);

    await agent.ensureStarted();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(agent.sessionId).toBe("restored-session");
    expect(events).toContainEqual({ type: "text_delta", delta: "[reloaded]" });

    await agent.stop();
  });
});
