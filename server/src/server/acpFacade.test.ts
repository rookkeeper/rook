import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "./index.js";

const PORT = 18999;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
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

    const list = await request(ws, 5, "session/list", {});
    const sessions = list.sessions as Array<Record<string, unknown>>;
    expect(sessions.some((session) => session.sessionId === sessionId)).toBe(true);

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

  it.skip("resumes a session across connections", async () => {
    // TODO: reconnect test needs runtime serialization investigation.
  });
});
