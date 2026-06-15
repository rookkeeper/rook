import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AcpSessionUpdateNotification } from "../../shared/acp";
import { BaseAgent } from "./BaseAgent";

const FIXTURE = path.resolve("src/server/agents/test-fixtures/mockAcpServer.mjs");

function collectAcp(agent: BaseAgent): AcpSessionUpdateNotification[] {
  const notifications: AcpSessionUpdateNotification[] = [];
  agent.setAcpEventSink((n) => notifications.push(n));
  return notifications;
}

describe("BaseAgent", () => {
  it("starts a new ACP session and routes all events through ACP passthrough", async () => {
    const agent = new BaseAgent({
      command: "node",
      args: [FIXTURE],
      cwd: path.resolve("."),
      sessionCwd: path.resolve("."),
      agentName: "TestAcpAgent",
    });
    const acp = collectAcp(agent);

    await agent.ensureStarted();
    await agent.run("hello");

    expect(agent.record?.restart).toEqual({ sessionId: "acp-session-1", cwd: path.resolve(".") });
    // Server-synthesized user_message_chunk
    expect(acp).toContainEqual(
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "hello" },
          }),
        }),
      }),
    );
    // Server-synthesized run_completed
    expect(acp).toContainEqual(
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: expect.objectContaining({ sessionUpdate: "_rookery_run_completed" }),
        }),
      }),
    );
    // Subprocess agent_message_chunk
    const agentChunks = acp.filter((n) => {
      const u = n.params?.update as { sessionUpdate?: string };
      return u?.sessionUpdate === "agent_message_chunk";
    });
    expect(agentChunks).toHaveLength(1);
    const update = agentChunks[0]?.params?.update as { content?: { text?: string } };
    expect(update?.content?.text).toBe("echo:hello");

    await agent.stop();
  });

  it("forwards raw ACP session/update notifications through acpEventSink", async () => {
    const agent = new BaseAgent({
      command: "node",
      args: [FIXTURE],
      cwd: path.resolve("."),
      sessionCwd: path.resolve("."),
      agentName: "TestAcpAgent",
    });
    const acp = collectAcp(agent);

    await agent.ensureStarted();
    await agent.run("hello");

    expect(acp.length).toBeGreaterThanOrEqual(2);
    // First is server-synthesized user_message_chunk
    const userChunk = acp[0];
    expect(userChunk?.method).toBe("session/update");
    const userUpdate = userChunk?.params?.update as { sessionUpdate?: string; content?: { text?: string } };
    expect(userUpdate?.sessionUpdate).toBe("user_message_chunk");
    expect(userUpdate?.content?.text).toBe("hello");
    // Second is subprocess agent_message_chunk
    const agentChunk = acp[1];
    expect(agentChunk?.method).toBe("session/update");
    const agentUpdate = agentChunk?.params?.update as { sessionUpdate?: string; content?: { text?: string } };
    expect(agentUpdate?.sessionUpdate).toBe("agent_message_chunk");
    expect(agentUpdate?.content?.text).toBe("echo:hello");

    await agent.stop();
  });

  it("applies send-now messages inside the current workflow before completing the run", async () => {
    const agent = new BaseAgent({
      command: "node",
      args: [FIXTURE],
      cwd: path.resolve("."),
      sessionCwd: path.resolve("."),
      agentName: "TestAcpAgent",
    });
    const acp = collectAcp(agent);

    await agent.ensureStarted();
    const runPromise = agent.run("slow");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sendNowPromise = agent.sendSteeringMessage("please continue with tests");

    await Promise.all([runPromise, sendNowPromise]);

    expect(acp).toContainEqual(
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "please continue with tests" },
          }),
        }),
      }),
    );
    expect(acp).toContainEqual(
      expect.objectContaining({
        method: "session/update",
        params: expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "echo:please continue with tests" },
          }),
        }),
      }),
    );
    expect(agent.lastStopReason).toBe("end_turn");

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
    const acp = collectAcp(agent);

    await agent.ensureStarted();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(agent.sessionId).toBe("restored-session");
    // Session/load replay content goes through ACP passthrough
    const reloadedChunks = acp.filter((n) => {
      const u = n.params?.update as { sessionUpdate?: string; content?: { text?: string } };
      return u?.sessionUpdate === "agent_message_chunk" && u?.content?.text === "[reloaded]";
    });
    expect(reloadedChunks).toHaveLength(1);

    await agent.stop();
  });
});
