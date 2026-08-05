import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../index.js";
import { SQLiteEnvironmentRepository } from "../environments/repositories/SQLiteEnvironmentRepository.js";

const PORT = 18999;

function agentWorkspaceRoot(home: string, sessionId: string): string {
  return path.join(home, ".rook", "agent-workspaces", sessionId);
}

function connect(path = "/api/ws"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function send(ws: any, id: number, method: string, params: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: String(id), method, params }));
}

function notify(ws: any, method: string, params: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function recv(ws: any): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data: unknown) => resolve(JSON.parse(String(data))));
  });
}

function recvWithTimeout(ws: any, timeoutMs: number): Promise<Record<string, unknown> | null> {
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

async function request(ws: any, id: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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
  let tempConfigDir: string;
  const originalRuntimePath = process.env.ROOK_AGENT_RUNTIMES_PATH;
  const originalHome = process.env.HOME;

  beforeAll(async () => {
    tempConfigDir = mkdtempSync(path.join(os.tmpdir(), "rook-acp-facade-"));
    const mockServerPath = path.join(process.cwd(), "src", "agents", "test-fixtures", "mockAcpServer.mjs");
    const runtimesPath = path.join(tempConfigDir, "agent-runtimes.json");
    writeFileSync(runtimesPath, JSON.stringify({
      profiles: [
        {
          id: "MockAcpAgent",
          type: "acp",
          command: "node",
          args: [mockServerPath],
          cwd: process.cwd(),
        },
      ],
    }));
    process.env.ROOK_AGENT_RUNTIMES_PATH = runtimesPath;
    process.env.HOME = tempConfigDir;
    const personalRepository = new SQLiteEnvironmentRepository(path.join(tempConfigDir, ".rook", "environment-repository.db"), "personal");
    personalRepository.saveResult({
      environment: { id: "web:example.com", displayName: "Example", description: "Example website" },
      bundles: [{
        id: "web:example.com#personal",
        bundleId: "personal",
        environmentId: "web:example.com",
        repository: "personal",
        skills: [{ id: "personal-skill", files: { "personal-skill/SKILL.md": "original personal skill" } }],
        mcpServers: [],
        apps: [],
        agentsMd: "original personal instructions",
        valid: true,
        errors: [],
      }],
      errors: [],
    });
    personalRepository.close();
    app = await buildServer({ environmentDecisionStoreLocation: ":memory:", authToken: "" });
    await app.listen({ host: "127.0.0.1", port: PORT });
  });

  afterAll(async () => {
    await app?.close();
    if (originalRuntimePath === undefined) delete process.env.ROOK_AGENT_RUNTIMES_PATH;
    else process.env.ROOK_AGENT_RUNTIMES_PATH = originalRuntimePath;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tempConfigDir, { recursive: true, force: true });
  });

  it("initializes and lists configured runtimes", async () => {
    const ws = await connect();
    const result = await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    expect(result.protocolVersion).toBe(1);
    const meta = result._meta as Record<string, unknown>;
    expect(Array.isArray(meta.runtimeIds)).toBe(true);
    ws.close();
  });

  it("loads migrated Mac environment capabilities from SQLite without source directories", async () => {
    expect(existsSync(path.resolve(process.cwd(), "..", "environment-repository"))).toBe(false);
    const response = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=mac:md.obsidian`);
    const preview = await response.json() as { bundles: Array<{ bundleId: string; skills: Array<{ id: string }>; agentsMd?: string }> };
    const bundle = preview.bundles.find((candidate) => candidate.bundleId === "default");
    expect(bundle).toBeDefined();
    expect(bundle?.agentsMd).toBeTruthy();
    expect(bundle?.skills.map((skill) => skill.id)).toEqual([
      "content-production",
      "how-to-use-peeps-obsidian",
      "how-to-use-reads-obsidian",
      "intro-email",
      "video-editor",
    ]);
  });

  it("creates, prompts, and closes a session on the same websocket", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });

    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "test-session" },
    });
    const sessionId = created.sessionId as string;
    expect(typeof sessionId).toBe("string");

    await expect(request(ws, 3, "session/list", {})).rejects.toThrow("session/list is not available on a session-bound websocket");

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

  it("materializes approved environment skills during an environment restart", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "materializer-test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "materializer-test" },
    });
    const sessionId = created.sessionId as string;

    await fetch(`http://127.0.0.1:${PORT}/api/environments/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "web:example.com", metadata: { displayName: "Example" } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ valid: boolean; bundleHash: string; bundleId: string }> };
    const bundle = preview.bundles.find((candidate) => candidate.valid && candidate.bundleId === "testing-fixture");
    expect(bundle).toBeDefined();
    await fetch(`http://127.0.0.1:${PORT}/api/environments/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environmentId: "web:example.com", bundleHash: bundle!.bundleHash, decision: "approve" }),
    });

    const entered = await fetch(`http://127.0.0.1:${PORT}/api/session/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, enterEnvironmentIds: ["web:example.com"], leaveEnvironmentIds: [] }),
    }).then((response) => response.json()) as { entered: string[] };
    expect(entered.entered).toContain("web:example.com");

    const workspaceRoot = agentWorkspaceRoot(tempConfigDir, sessionId);
    const materializedSkill = path.join(workspaceRoot, ".agents", "skills", "testing-fixture", "SKILL.md");
    expect(existsSync(materializedSkill)).toBe(true);
    await request(ws, 3, "session/close", { sessionId });
    ws.close();
  });

  it("writes a personal skill edit back after an agent prompt", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "authoring-test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "authoring-test" },
    });
    const sessionId = created.sessionId as string;

    await fetch(`http://127.0.0.1:${PORT}/api/environments/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "web:example.com", metadata: { displayName: "Example" } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fetch(`http://127.0.0.1:${PORT}/api/session/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, enterEnvironmentIds: ["web:example.com"], leaveEnvironmentIds: [] }),
    });
    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ valid: boolean; bundleHash: string; bundleId: string }> };
    const bundle = preview.bundles.find((candidate) => candidate.valid && candidate.bundleId === "personal");
    expect(bundle).toBeDefined();
    await fetch(`http://127.0.0.1:${PORT}/api/environments/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environmentId: "web:example.com", bundleHash: bundle!.bundleHash, decision: "approve" }),
    });

    const workspaceRoot = agentWorkspaceRoot(tempConfigDir, sessionId);
    const workspaceSkill = path.join(workspaceRoot, ".agents", "skills", "personal-skill", "SKILL.md");
    expect(readFileSync(workspaceSkill, "utf8")).toBe("original personal skill");
    await request(ws, 4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: `edit personal skill write-to:${workspaceSkill}` }],
    });

    const afterSkill = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ bundleId: string; skills: Array<{ id: string; files: Record<string, string> }> }> };
    const personalAfterSkill = afterSkill.bundles.find((candidate) => candidate.bundleId === "personal");
    expect(personalAfterSkill?.skills.find((skill) => skill.id === "personal-skill")?.files["personal-skill/SKILL.md"]).toBe("updated by the mock agent");
    const workspaceAgents = path.join(workspaceRoot, ".agents", "AGENTS_FILES", "example", "AGENTS.md");
    await request(ws, 5, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: `edit personal instructions write-to:${workspaceAgents}` }],
    });
    const afterInstructions = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ bundleId: string; agentsMd?: string }> };
    expect(afterInstructions.bundles.find((candidate) => candidate.bundleId === "personal")?.agentsMd).toBe("updated by the mock agent");
    await request(ws, 6, "session/close", { sessionId });
    ws.close();
  });

  it("writes a newly created personal skill to SQLite", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "new-skill-test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "new-skill-test" },
    });
    const sessionId = created.sessionId as string;
    const environmentId = "web:new-skill.example";

    await fetch(`http://127.0.0.1:${PORT}/api/environments/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: environmentId, metadata: { displayName: "New Skill Test" } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const beforeEntry = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=${environmentId}`).then((response) => response.json()) as { bundles: Array<{ bundleId: string }> };
    expect(beforeEntry.bundles.find((bundle) => bundle.bundleId === "personal")).toBeUndefined();
    const entered = await fetch(`http://127.0.0.1:${PORT}/api/session/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, enterEnvironmentIds: [environmentId], leaveEnvironmentIds: [] }),
    }).then((response) => response.json()) as { entered: string[] };
    expect(entered.entered).toContain(environmentId);

    const workspaceSkill = path.join(agentWorkspaceRoot(tempConfigDir, sessionId), ".agents", "editable-skills", "new-skill-test", "navigating-xkcd");
    mkdirSync(workspaceSkill, { recursive: true });
    writeFileSync(path.join(workspaceSkill, "SKILL.md"), "---\nname: navigating-xkcd\ndescription: Navigate XKCD.\n---\n", "utf8");
    await request(ws, 3, "session/prompt", { sessionId, prompt: [{ type: "text", text: "say hi briefly" }] });

    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=${environmentId}`).then((response) => response.json()) as { bundles: Array<{ bundleId: string; skills: Array<{ id: string; files: Record<string, string> }> }> };
    const personal = preview.bundles.find((bundle) => bundle.bundleId === "personal");
    expect(personal?.skills.find((skill) => skill.id === "navigating-xkcd")?.files["navigating-xkcd/SKILL.md"]).toContain("Navigate XKCD.");
    await request(ws, 4, "session/close", { sessionId });
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
    const controlA = await connect();
    await request(controlA, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const a = await request(controlA, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "bound-a" },
    });
    controlA.close();

    const controlB = await connect();
    await request(controlB, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const b = await request(controlB, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "bound-b" },
    });
    controlB.close();

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
    const controlA = await connect();
    await request(controlA, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "control-a" } });
    const a = await request(controlA, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "iso-a" },
    });
    controlA.close();

    const controlB = await connect();
    await request(controlB, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "control-b" } });
    const b = await request(controlB, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "iso-b" },
    });
    controlB.close();

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
    const wsA = await connect();
    await request(wsA, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test-a" } });
    await request(wsA, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "rest-test-a" },
    });

    const wsB = await connect();
    await request(wsB, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test-b" } });
    await request(wsB, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "rest-test-b" },
    });

    const response = await fetch(`http://127.0.0.1:${PORT}/api/sessions`);
    expect(response.status).toBe(200);
    const body = await response.json() as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions.length).toBeGreaterThanOrEqual(2);

    const titles = body.sessions.map((s) => s.title);
    expect(titles).toContain("rest-test-a");
    expect(titles).toContain("rest-test-b");

    const sessionA = body.sessions.find((s) => s.title === "rest-test-a")!;
    expect(sessionA.running).toBe(true);
    expect(sessionA._meta).toBeDefined();
    expect((sessionA._meta as Record<string, unknown>).runtimeId).toBe("MockAcpAgent");

    wsA.close();
    wsB.close();
  });
});
