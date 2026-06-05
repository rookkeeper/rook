import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "./agent";
import type { SessionEvent } from "../shared/realtime";
import { fetchAgentDefinitions, fetchAgentSessions, fetchMostRecentSession, RemoteAgent } from "./remoteAgent";

const session: AgentSessionSummary = { id: "s1", agent: "MockAgent", createdAt: "now", restart: {} };

const websocketMock = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    static instances: MockWebSocket[] = [];
    url: string;
    readyState = 0;
    sent: string[] = [];
    private listeners = new Map<string, Array<(event?: any) => void>>();

    constructor(url: string) {
      this.url = url;
      MockWebSocket.instances.push(this);
    }

    addEventListener(type: string, listener: (event?: any) => void) {
      const existing = this.listeners.get(type) ?? [];
      existing.push(listener);
      this.listeners.set(type, existing);
    }

    send(payload: string) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }

    emitOpen() {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", {});
    }

    emitMessage(data: unknown) {
      this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
    }

    emitError() {
      this.emit("error", {});
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  return { MockWebSocket };
});

async function waitForCondition(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  assertion();
}

describe("RemoteAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    websocketMock.MockWebSocket.instances.length = 0;
  });

  it("sends user messages over websocket and surfaces session events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: SessionEvent[] = [];
    const agent = new RemoteAgent({ wsEndpoint: "/custom-ws", backend: "MockAgent", session, onSessionEvent: (event) => events.push(event) });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    expect(socket.url).toContain("/custom-ws");
    expect(socket.url).toContain("sessionId=s1");

    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: "user_event",
      requestId: "user-event-1",
      event: { kind: "text_message", text: "hello" },
    });

    socket.emitMessage({ type: "session_event", sessionId: "s1", sequence: 1, event: { type: "status_changed", status: "busy", message: "Working" } });
    socket.emitMessage({ type: "session_event", sessionId: "s1", sequence: 2, event: { type: "text_delta", delta: "Hi" } });
    socket.emitMessage({ type: "session_event", sessionId: "s1", sequence: 3, event: { type: "run_completed" } });

    await runPromise;
    expect(events).toEqual([
      { type: "status_changed", status: "busy", message: "Working" },
      { type: "text_delta", delta: "Hi" },
      { type: "run_completed" },
    ]);
  });

  it("starts the selected remote agent and then connects with its returned session", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, agent: "MockAgent", session }));

    const agent = new RemoteAgent({ backend: "MockAgent", startEndpoint: "/start" });
    await expect(agent.start()).resolves.toEqual({ ok: true, agent: "MockAgent", session });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    socket.emitMessage({ type: "session_event", sessionId: "s1", sequence: 1, event: { type: "run_completed" } });
    await runPromise;

    expect(fetchMock).toHaveBeenCalledWith("/start", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "MockAgent" }),
    }));
  });

  it("loads the most recent session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ session }));

    await expect(fetchMostRecentSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/session/recent");
  });

  it("reports start HTTP failures as connection_error session events", async () => {
    const events: SessionEvent[] = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(new RemoteAgent({ onSessionEvent: (event) => events.push(event) }).start()).rejects.toThrow("HTTP 503");

    expect(events).toEqual([{ type: "connection_error", error: "Remote agent start failed with HTTP 503" }]);
  });

  it("loads agent definitions and sessions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ agents: [{ id: "MockAgent", parentId: null }] }))
      .mockResolvedValueOnce(Response.json({ sessions: [session] }));

    await expect(fetchAgentDefinitions()).resolves.toEqual([{ id: "MockAgent", parentId: null }]);
    await expect(fetchAgentSessions("MockAgent")).resolves.toEqual([session]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/agent/sessions?agent=MockAgent");
  });

  it("reports websocket error messages as connection_error session events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: SessionEvent[] = [];
    const agent = new RemoteAgent({ session, onSessionEvent: (event) => events.push(event) });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    socket.emitMessage({ type: "error", error: "Remote exploded" });

    await expect(runPromise).rejects.toThrow("Remote exploded");
    expect(events).toContainEqual({ type: "connection_error", error: "Remote exploded" });
  });

  it("reconnects to an existing session from the last seen event sequence", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const agent = new RemoteAgent({ session });

    void agent.connect();
    const firstSocket = websocketMock.MockWebSocket.instances[0]!;
    firstSocket.emitOpen();
    await Promise.resolve();
    firstSocket.emitMessage({ type: "session_event", sessionId: "s1", sequence: 3, event: { type: "text_delta", delta: "Earlier" } });
    firstSocket.close();

    void agent.connect();
    const secondSocket = websocketMock.MockWebSocket.instances[1]!;
    expect(secondSocket.url).toContain("fromSequence=3");
  });

  it("reports malformed websocket payloads as protocol_error session events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: SessionEvent[] = [];
    const agent = new RemoteAgent({ session, onSessionEvent: (event) => events.push(event) });

    void agent.connect();
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await Promise.resolve();

    socket.emitMessage("not-json");

    expect(events).toContainEqual(expect.objectContaining({ type: "protocol_error" }));
  });
});
