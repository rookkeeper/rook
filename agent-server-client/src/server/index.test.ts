// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSession = { id: "s-mock", agent: "MockAgent", createdAt: "now", restart: {} };
const olderSession = { id: "s-old", agent: "MockAgent", createdAt: "2025-12-31T00:00:00.000Z", restart: {} };
const myPiSession = { id: "s1", agent: "MyPiAgent", createdAt: "2026-01-01T00:00:00.000Z", restart: { sessionId: "abc" } };

const agentDiscoveryMock = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
}));

vi.mock("./agents/agentDiscovery.js", () => ({
  getAgentDefinitions: () => [],
  isKnownAgent: (id: string) => id === "MockAgent" || id === "MyPiAgent" || id === "PiAgent",
  createAgent: agentDiscoveryMock.createAgentMock.mockImplementation((id: string, restart?: Record<string, unknown>) => {
    let eventSink: ((event: Record<string, unknown>) => void) | undefined;

    return {
      get record() {
        return id === "MockAgent" ? mockSession : { ...myPiSession, agent: id, restart: restart ?? myPiSession.restart };
      },
      setEventSink(nextEventSink: ((event: Record<string, unknown>) => void) | undefined) {
        eventSink = nextEventSink;
      },
      async ensureStarted() {
        return undefined;
      },
      async stop() {
        return undefined;
      },
      async run(message: string) {
        eventSink?.({ type: "user_message", text: message, queued: false });
        eventSink?.({ type: "text_delta", delta: "ok" });
        eventSink?.({ type: "run_completed" });
      },
    };
  }),
}));

vi.mock("./agents/sessionLog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agents/sessionLog.js")>();
  return {
    ...actual,
    readSessionRecords: async () => [myPiSession, olderSession],
  };
});

const { buildServer } = await import("./index");
const { setSessionEventsRoot } = await import("./sessionEvents");

async function listen(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose an address.");
  return `http://127.0.0.1:${address.port}`;
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open.")), { once: true });
  });
  return socket;
}

async function collectJsonMessages(socket: WebSocket, count: number): Promise<any[]> {
  return await new Promise<any[]>((resolve, reject) => {
    const messages: any[] = [];
    const timeout = setTimeout(() => reject(new Error(`Timed out after receiving ${messages.length}/${count} websocket messages.`)), 3_000);
    const onMessage = (event: MessageEvent) => {
      messages.push(JSON.parse(String(event.data)));
      if (messages.length >= count) {
        clearTimeout(timeout);
        socket.removeEventListener("message", onMessage);
        resolve(messages);
      }
    };
    socket.addEventListener("message", onMessage);
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("server", () => {
  let sessionEventsRoot = "";

  beforeEach(async () => {
    sessionEventsRoot = await mkdtemp(path.join(os.tmpdir(), "agent-station-session-events-"));
    setSessionEventsRoot(sessionEventsRoot);
  });

  afterEach(async () => {
    agentDiscoveryMock.createAgentMock.mockClear();
    vi.restoreAllMocks();
    if (sessionEventsRoot) await rm(sessionEventsRoot, { recursive: true, force: true });
  });

  it("serves health status", async () => {
    const app = await buildServer({ enableClient: false });
    const response = await app.inject({ method: "GET", url: "/api/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "agent-station" });
  });

  it("starts the selected agent and returns its session", async () => {
    const app = await buildServer({ enableClient: false });
    const response = await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MockAgent" } });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, agent: "MockAgent", session: mockSession });
  });

  it("starts from a provided session bolus", async () => {
    const app = await buildServer({ enableClient: false });
    const response = await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({ ok: true, agent: "MyPiAgent", session: myPiSession }));
  });

  it("lists saved sessions for an agent", async () => {
    const app = await buildServer({ enableClient: false });
    const response = await app.inject({ method: "GET", url: "/api/agent/sessions?agent=MyPiAgent" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toEqual([{ ...myPiSession, running: false, connectedClients: 0 }]);
  });

  it("returns the most recent saved session across agents", async () => {
    const app = await buildServer({ enableClient: false });
    const response = await app.inject({ method: "GET", url: "/api/agent/session/recent" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ session: { ...myPiSession, running: false, connectedClients: 0 } });
  });

  it("marks active sessions as running", async () => {
    const app = await buildServer({ enableClient: false });
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });
    const response = await app.inject({ method: "GET", url: "/api/agent/sessions?agent=MyPiAgent" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toEqual([{ ...myPiSession, running: true, connectedClients: 0 }]);
  });

  it("automatically stops a room after the last websocket client leaves", async () => {
    const app = await buildServer({ enableClient: false, roomIdleTimeoutMs: 25 });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const socket = await openWebSocket(`${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`);
    socket.close();
    await delay(120);

    const response = await app.inject({ method: "GET", url: "/api/agent/sessions?agent=MyPiAgent" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toEqual([{ ...myPiSession, running: false, connectedClients: 0 }]);
  });

  it("keeps a session alive when a client rejoins before idle shutdown", async () => {
    const app = await buildServer({ enableClient: false, roomIdleTimeoutMs: 80 });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const wsUrl = `${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`;
    const firstSocket = await openWebSocket(wsUrl);
    firstSocket.close();
    await delay(30);

    const secondSocket = await openWebSocket(wsUrl);
    await delay(10);
    const response = await app.inject({ method: "GET", url: "/api/agent/sessions?agent=MyPiAgent" });

    secondSocket.close();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toEqual([{ ...myPiSession, running: true, connectedClients: 1 }]);
  });

  it("restarts an active session", async () => {
    const app = await buildServer({ enableClient: false });
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });
    const response = await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession, restartExisting: true } });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({ ok: true, agent: "MyPiAgent", session: myPiSession }));
  });

  it("returns replay events on restart when requested", async () => {
    const app = await buildServer({ enableClient: false });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const socket = await openWebSocket(`${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`);
    const eventsPromise = collectJsonMessages(socket, 4);
    socket.send(JSON.stringify({ type: "user_event", event: { kind: "text_message", text: "hello" } }));
    await eventsPromise;
    socket.close();

    const response = await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession, restartExisting: true, includeReplayEvents: true } });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as { replayEvents?: Array<{ type: string }> };
    expect(body.replayEvents).toEqual(expect.arrayContaining([
      { type: "user_message", text: "hello", queued: false },
      { type: "text_delta", delta: "ok" },
      { type: "run_completed" },
    ]));
  });

  it("automatically returns replay events when a session is provided", async () => {
    const app = await buildServer({ enableClient: false });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const socket = await openWebSocket(`${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`);
    const eventsPromise = collectJsonMessages(socket, 4);
    socket.send(JSON.stringify({ type: "user_event", event: { kind: "text_message", text: "hello" } }));
    await eventsPromise;
    socket.close();

    const response = await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as { replayEvents?: Array<{ type: string }> };
    expect(body.replayEvents).toEqual(expect.arrayContaining([
      { type: "user_message", text: "hello", queued: false },
      { type: "text_delta", delta: "ok" },
      { type: "run_completed" },
    ]));
  });

  it("rejects unknown agents", async () => {
    const app = await buildServer({ enableClient: false });
    const response = await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "unknown" } });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Unknown agent" });
  });

  it("pushes an environment offer over the websocket and resolves it on decision", async () => {
    const app = await buildServer({ enableClient: false, environmentDecisionStoreLocation: ":memory:" });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MockAgent" } });
    const socket = await openWebSocket(`${baseUrl.replace("http", "ws")}/api/ws?sessionId=s-mock`);

    const offerPromise = collectJsonMessages(socket, 1);
    const register = await app.inject({ method: "POST", url: "/api/environments/register", payload: { id: "demo:demo", sourceName: "Demo" } });
    expect(register.json()).toEqual({ ok: true, id: "demo:demo" });
    const [offer] = await offerPromise;
    expect(offer.event).toMatchObject({
      type: "environment_event",
      kind: "environment_offer_available",
      payload: { environmentId: "demo:demo", sourceName: "Demo" },
    });

    // Accepting enters the env (entered event) and resolves the offer (resolved event).
    const resolvedPromise = collectJsonMessages(socket, 2);
    const decision = await app.inject({ method: "POST", url: "/api/environments/decision", payload: { environmentId: "demo:demo", decision: "accept" } });
    expect(decision.statusCode).toBe(200);
    const messages = await resolvedPromise;
    expect(messages.some((m) => m.event?.kind === "environment_offer_resolved" && m.event?.payload?.decision === "approved")).toBe(true);

    socket.close();
    await app.close();
  });

  it("validates environment decision input", async () => {
    const app = await buildServer({ enableClient: false, environmentDecisionStoreLocation: ":memory:" });
    const bad = await app.inject({ method: "POST", url: "/api/environments/decision", payload: { environmentId: "demo:demo", decision: "maybe" } });
    expect(bad.statusCode).toBe(400);
    const unavailable = await app.inject({ method: "POST", url: "/api/environments/unavailable", payload: { id: "demo:demo" } });
    expect(unavailable.statusCode).toBe(200);
    await app.close();
  });

  it("returns environment skill previews", async () => {
    const app = await buildServer({ enableClient: false });
    const register = await app.inject({
      method: "POST",
      url: "/api/environments/register",
      payload: { id: "demo:demo" },
    });
    expect(register.statusCode).toBe(200);

    const preview = await app.inject({ method: "GET", url: "/api/environments/preview?environmentId=demo:demo" });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as { environmentId: string; skills: Array<{ id: string; files: Record<string, string> }> };
    expect(body.environmentId).toBe("demo:demo");
    expect(body.skills.some((skill) => skill.id === "joke-telling" && skill.files["joke-telling/SKILL.md"]?.includes("pirate"))).toBe(true);

    await app.close();
  });

  it("returns wikipedia environment skill previews from the repository", async () => {
    const app = await buildServer({ enableClient: false });
    const register = await app.inject({
      method: "POST",
      url: "/api/environments/register",
      payload: { id: "web:wikipedia" },
    });
    expect(register.statusCode).toBe(200);

    const preview = await app.inject({ method: "GET", url: "/api/environments/preview?environmentId=web:wikipedia" });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as { environmentId: string; skills: Array<{ id: string }> };
    expect(body.environmentId).toBe("web:wikipedia");
    expect(body.skills.some((skill) => skill.id === "wikipedia-discovery")).toBe(true);

    await app.close();
  });

  it("reports connected websocket client counts in session listings", async () => {
    const app = await buildServer({ enableClient: false, roomIdleTimeoutMs: 1_000 });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const wsUrl = `${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`;
    const socketA = await openWebSocket(wsUrl);
    const socketB = await openWebSocket(wsUrl);
    await delay(10);

    const response = await app.inject({ method: "GET", url: "/api/agent/sessions?agent=MyPiAgent" });

    socketA.close();
    socketB.close();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toEqual([{ ...myPiSession, running: true, connectedClients: 2 }]);
  });

  it("broadcasts websocket session events to all subscribers", async () => {
    const app = await buildServer({ enableClient: false });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const wsUrl = `${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`;
    const socketA = await openWebSocket(wsUrl);
    const socketB = await openWebSocket(wsUrl);
    const messagesA = collectJsonMessages(socketA, 4);
    const messagesB = collectJsonMessages(socketB, 3);

    socketA.send(JSON.stringify({ type: "user_event", requestId: "req-1", event: { kind: "text_message", text: "hello" } }));

    const [eventsA, eventsB] = await Promise.all([messagesA, messagesB]);
    socketA.close();
    socketB.close();
    await app.close();

    expect(eventsA).toContainEqual({ type: "ack", requestId: "req-1" });
    expect(eventsA.filter((event) => event.type === "session_event")).toEqual(eventsB);
    expect(eventsB).toEqual([
      { type: "session_event", sessionId: "s1", sequence: 1, event: { type: "user_message", text: "hello", queued: false } },
      { type: "session_event", sessionId: "s1", sequence: 2, event: { type: "text_delta", delta: "ok" } },
      { type: "session_event", sessionId: "s1", sequence: 3, event: { type: "run_completed" } },
    ]);
  });

  it("replays websocket events from a requested sequence", async () => {
    const app = await buildServer({ enableClient: false });
    const baseUrl = await listen(app);
    await app.inject({ method: "POST", url: "/api/agent/start", payload: { agent: "MyPiAgent", session: myPiSession } });

    const firstSocket = await openWebSocket(`${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}`);
    const firstMessages = collectJsonMessages(firstSocket, 4);
    firstSocket.send(JSON.stringify({ type: "user_event", event: { kind: "text_message", text: "hello" } }));
    await firstMessages;
    firstSocket.close();

    const replaySocket = await openWebSocket(`${baseUrl.replace("http", "ws")}/api/ws?sessionId=${myPiSession.id}&fromSequence=1`);
    const replayed = await collectJsonMessages(replaySocket, 2);
    replaySocket.close();
    await app.close();

    expect(replayed).toEqual([
      { type: "session_event", sessionId: "s1", sequence: 2, event: { type: "text_delta", delta: "ok" } },
      { type: "session_event", sessionId: "s1", sequence: 3, event: { type: "run_completed" } },
    ]);
  });
});
