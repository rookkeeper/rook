import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "./index.js";

const PORT = 18999;

function connect(path = "/api/ws"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function send(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: String(id), method, params }));
}

function notify(ws: WebSocket, method: string, params: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function recv(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
  });
}

function recvWithTimeout(ws: WebSocket, timeoutMs: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(data)));
    };
    ws.once("message", onMessage);
  });
}

async function request(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  send(ws, id, method, params);
  while (true) {
    const msg = await recv(ws);
    if (msg.id === String(id)) {
      if (msg.error) throw new Error((msg.error as Record<string, unknown>).message as string ?? "Request failed");
      return msg.result as Record<string, unknown>;
    }
    // Skip notifications that arrive before the response (e.g. session/update during replay).
  }
}

describe("ACP facade integration", { timeout: 30000 }, () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({ logger: false, environmentDecisionStoreLocation: ":memory:", authToken: "" });
    await app.listen({ host: "127.0.0.1", port: PORT });
  });

  afterAll(async () => {
    await app.close();
  });

  it("initializes and lists configured runtimes", async () => {
    const ws = await connect();
    const result = await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    expect(result.protocolVersion).toBe(1);
    const meta = result._meta as Record<string, unknown>;
    expect(Array.isArray(meta.runtimeIds)).toBe(true);
    ws.close();
  });

  it("creates, loads, prompts, and closes a session", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });

    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "test-session" },
    });
    const sessionId = created.sessionId as string;
    expect(typeof sessionId).toBe("string");

    await request(ws, 3, "session/load", { sessionId });

    const promptResult = await request(ws, 4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "tell me a joke" }],
    });
    expect(promptResult.stopReason).toBe("end_turn");

    const listResponse = await fetch(`http://127.0.0.1:${PORT}/api/sessions`);
    const list = await listResponse.json() as { sessions: Array<Record<string, unknown>> };
    expect(list.sessions.some((session) => session.sessionId === sessionId)).toBe(true);

    await request(ws, 6, "session/close", { sessionId });
    ws.close();
  });

  it("accepts session/cancel as a JSON-RPC notification and cancels the turn", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });

    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "cancel-test" },
    });
    const sessionId = created.sessionId as string;
    await request(ws, 3, "session/load", { sessionId });

    send(ws, 4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "run a long task" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    notify(ws, "session/cancel", { sessionId });

    while (true) {
      const msg = await recv(ws);
      if (msg.error) throw new Error((msg.error as Record<string, unknown>).message as string ?? "Unexpected error");
      if (msg.id === "4") {
        expect((msg.result as Record<string, unknown>).stopReason).toBe("cancelled");
        break;
      }
    }

    ws.close();
  });

  it("rejects unknown runtime IDs", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    await expect(request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "NonExistent" },
    })).rejects.toThrow("Unknown configured runtime");
    ws.close();
  });

  it("rejects unknown session IDs", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    await expect(request(ws, 2, "session/load", { sessionId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow("Unknown session");
    ws.close();
  });

  it("binds a websocket to one session and rejects cross-session use", async () => {
    const control = await connect();
    await request(control, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const a = await request(control, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "bound-a" },
    });
    const b = await request(control, 3, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "bound-b" },
    });
    control.close();

    const ws = await connect(`/api/ws?sessionId=${a.sessionId}`);
    await request(ws, 4, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    await request(ws, 5, "session/load", { sessionId: a.sessionId });
    await expect(request(ws, 6, "session/prompt", {
      sessionId: b.sessionId,
      prompt: [{ type: "text", text: "hi" }],
    })).rejects.toThrow(`WebSocket is bound to session ${a.sessionId}`);
    ws.close();
  });

  it("keeps session/load replay private to the requesting watcher", async () => {
    const creator = await connect();
    await request(creator, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "creator" } });
    const created = await request(creator, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "private-replay" },
    });
    const sessionId = created.sessionId as string;
    await request(creator, 3, "session/load", { sessionId });
    await request(creator, 4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "tell me a joke" }],
    });

    const watcherA = await connect(`/api/ws?sessionId=${sessionId}`);
    await request(watcherA, 5, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "watcher-a" } });

    const watcherB = await connect(`/api/ws?sessionId=${sessionId}`);
    await request(watcherB, 7, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "watcher-b" } });
    const loadB = request(watcherB, 8, "session/load", { sessionId });
    const replayLeak = await recvWithTimeout(watcherA, 200);
    await loadB;

    expect(replayLeak).toBeNull();

    creator.close();
    watcherA.close();
    watcherB.close();
  });

  it("keeps a running session alive with zero viewers and allows a clean reopen", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "zero-viewers" },
    });
    const sessionId = created.sessionId as string;
    await request(ws, 3, "session/load", { sessionId });
    send(ws, 4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "run a long task" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    ws.close();

    const during = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((r) => r.json()) as { sessions: Array<Record<string, unknown>> };
    expect(during.sessions.find((item) => item.sessionId === sessionId)?.running).toBe(true);

    const transcript = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/transcript`).then((r) => r.json()) as { events: Array<Record<string, unknown>> };
    expect(transcript.events.length).toBeGreaterThan(0);

    const reopened = await connect(`/api/ws?sessionId=${sessionId}`);
    await request(reopened, 5, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "reopen" } });
    const after = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((r) => r.json()) as { sessions: Array<Record<string, unknown>> };
    expect(after.sessions.find((item) => item.sessionId === sessionId)?.running).toBe(true);
    reopened.close();
  });

  it("isolates updates between two simultaneously running sessions", async () => {
    const control = await connect();
    await request(control, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "control" } });
    const a = await request(control, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "iso-a" },
    });
    const b = await request(control, 3, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "iso-b" },
    });
    control.close();

    const watcherA = await connect(`/api/ws?sessionId=${a.sessionId}`);
    const watcherB = await connect(`/api/ws?sessionId=${b.sessionId}`);
    await request(watcherA, 4, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "a" } });
    await request(watcherB, 5, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "b" } });
    await request(watcherA, 6, "session/load", { sessionId: a.sessionId });
    send(watcherA, 7, "session/prompt", { sessionId: a.sessionId, prompt: [{ type: "text", text: "tell me a joke" }] });
    const leakedToB = await recvWithTimeout(watcherB, 120);
    expect(leakedToB).toBeNull();
    watcherA.close();
    watcherB.close();
  });

  it.skip("resumes a session across connections", async () => {
    // TODO: reconnect test needs runtime serialization investigation.
  });

  it("lists sessions via REST /api/sessions", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });

    // Create two sessions
    const a = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "rest-test-a" },
    });
    const b = await request(ws, 3, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "rest-test-b" },
    });

    // Fetch via REST
    const response = await fetch(`http://127.0.0.1:${PORT}/api/sessions`);
    expect(response.status).toBe(200);
    const body = await response.json() as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions.length).toBeGreaterThanOrEqual(2);

    const titles = body.sessions.map((s) => s.title);
    expect(titles).toContain("rest-test-a");
    expect(titles).toContain("rest-test-b");

    // running should be true for sessions with active runtimes
    const sessionA = body.sessions.find((s) => s.title === "rest-test-a")!;
    expect(sessionA.running).toBe(true);
    expect(sessionA._meta).toBeDefined();
    expect((sessionA._meta as Record<string, unknown>).runtimeId).toBe("MockAcpAgent");

    ws.close();
  });
});
