import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../index.js";
import { SQLiteEnvironmentRepository } from "../environments/repositories/SQLiteEnvironmentRepository.js";

const PORT = 18999;
const CANONICAL_OBSIDIAN_BUNDLE_ID = "22222222-2222-4222-8222-222222222222";
const CANONICAL_EXAMPLE_BUNDLE_ID = "33333333-3333-4333-8333-333333333333";
const PERSONAL_EXAMPLE_BUNDLE_ID = "44444444-4444-4444-8444-444444444444";

function agentWorkspaceRoot(home: string, sessionId: string): string {
  return path.join(process.env.ROOK_HOME ?? path.join(home, ".rook"), "agent-workspaces", sessionId);
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
  const originalRookHome = process.env.ROOK_HOME;

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
        {
          id: "ImageMockAcpAgent",
          type: "acp",
          command: "node",
          args: [mockServerPath],
          cwd: process.cwd(),
          promptCapabilities: { image: true },
        },
      ],
    }));
    process.env.ROOK_AGENT_RUNTIMES_PATH = runtimesPath;
    process.env.HOME = tempConfigDir;
    process.env.ROOK_HOME = path.join(tempConfigDir, "profile-home");
    const canonicalRepository = new SQLiteEnvironmentRepository(path.join(tempConfigDir, "canonical.db"), "canonical");
    canonicalRepository.saveResult({
      environment: { id: "mac:md.obsidian", displayName: "md.obsidian", description: "Obsidian vault" },
      bundles: [{
        id: `mac:md.obsidian#${CANONICAL_OBSIDIAN_BUNDLE_ID}`,
        bundleId: CANONICAL_OBSIDIAN_BUNDLE_ID,
        environmentId: "mac:md.obsidian",
        repository: "canonical",
        skills: ["content-production", "how-to-use-peeps-obsidian", "how-to-use-reads-obsidian", "intro-email", "video-editor"].map((id) => ({ id, files: { [`${id}/SKILL.md`]: id } })),
        mcpServers: [],
        apps: [],
        agentsMd: "Obsidian instructions.",
        valid: true,
        errors: [],
      }],
      errors: [],
    });
    canonicalRepository.saveResult({
      environment: { id: "web:example.com", displayName: "Example", description: "Example website" },
      bundles: [{
        id: `web:example.com#${CANONICAL_EXAMPLE_BUNDLE_ID}`,
        bundleId: CANONICAL_EXAMPLE_BUNDLE_ID,
        environmentId: "web:example.com",
        repository: "canonical",
        skills: [{ id: "testing-fixture", files: { "testing-fixture/SKILL.md": "Testing fixture" } }],
        mcpServers: [],
        apps: [],
        valid: true,
        errors: [],
      }],
      errors: [],
    });
    canonicalRepository.close();
    const personalRepository = new SQLiteEnvironmentRepository(path.join(tempConfigDir, ".rook", "environment-repository.db"), "personal");
    personalRepository.saveResult({
      environment: { id: "web:example.com", displayName: "Example", description: "Example website" },
      bundles: [{
        id: `web:example.com#${PERSONAL_EXAMPLE_BUNDLE_ID}`,
        bundleId: PERSONAL_EXAMPLE_BUNDLE_ID,
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
    app = await buildServer({
      environmentRepositoryDatabase: path.join(tempConfigDir, "canonical.db"),
      personalEnvironmentRepositoryDatabase: path.join(tempConfigDir, ".rook", "environment-repository.db"),
      environmentDecisionStoreLocation: ":memory:",
      authToken: "",
    });
    expect(existsSync(path.join(process.env.ROOK_HOME!, "global-workspace", "manifest.json"))).toBe(true);
    await app.listen({ host: "127.0.0.1", port: PORT });
  });

  afterAll(async () => {
    await app?.close();
    if (originalRuntimePath === undefined) delete process.env.ROOK_AGENT_RUNTIMES_PATH;
    else process.env.ROOK_AGENT_RUNTIMES_PATH = originalRuntimePath;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalRookHome === undefined) delete process.env.ROOK_HOME;
    else process.env.ROOK_HOME = originalRookHome;
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
    const bundle = preview.bundles.find((candidate) => candidate.bundleId === CANONICAL_OBSIDIAN_BUNDLE_ID);
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

    const promptResult = await request(ws, 4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "tell me a joke" }],
    });
    expect(promptResult.stopReason).toBe("end_turn");

    const listResponse = await fetch(`http://127.0.0.1:${PORT}/api/sessions`);
    const list = await listResponse.json() as { sessions: Array<Record<string, unknown>> };
    const listed = list.sessions.find((session) => session.sessionId === sessionId);
    expect(listed?.activityStatus).toBe("ready");

    const touched = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/touch`, { method: "POST" }).then((response) => response.json()) as Record<string, unknown>;
    expect(touched.activityStatus).toBe("on");

    send(ws, 5, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "long task" }],
    });
    let activeStatus = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const activeList = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
      activeStatus = String(activeList.sessions.find((session) => session.sessionId === sessionId)?.activityStatus ?? "");
      if (activeStatus === "active") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(activeStatus).toBe("active");
    while (true) {
      const message = await recv(ws);
      if (message.id === "5") break;
    }

    const unviewed = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/unview`, { method: "POST" }).then((response) => response.json()) as Record<string, unknown>;
    expect(unviewed.activityStatus).toBe("on");

    await expect(request(ws, 5, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "boom" }],
    })).rejects.toThrow("boom");
    const failedList = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
    expect(failedList.sessions.find((session) => session.sessionId === sessionId)?.activityStatus).toBe("error");

    await request(ws, 6, "session/close", { sessionId });
    ws.close();
  });


  it("moves a prompted session to the front of the recency-sorted list", async () => {
    const olderWs = await connect();
    const newerWs = await connect();
    await request(olderWs, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "older" } });
    await request(newerWs, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "newer" } });
    const older = await request(olderWs, 2, "session/new", { cwd: "/tmp", mcpServers: [], _meta: { runtimeId: "MockAcpAgent", title: "older" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newer = await request(newerWs, 2, "session/new", { cwd: "/tmp", mcpServers: [], _meta: { runtimeId: "MockAcpAgent", title: "newer" } });

    await request(olderWs, 3, "session/prompt", { sessionId: older.sessionId, prompt: [{ type: "text", text: "tell me a joke" }] });
    const list = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
    expect(list.sessions[0]?.sessionId).toBe(older.sessionId);

    await request(olderWs, 4, "session/close", { sessionId: older.sessionId });
    await request(newerWs, 3, "session/close", { sessionId: newer.sessionId });
    olderWs.close();
    newerWs.close();
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
    const bundle = preview.bundles.find((candidate) => candidate.valid && candidate.bundleId === CANONICAL_EXAMPLE_BUNDLE_ID);
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
    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ valid: boolean; bundleHash: string; bundleId: string; repository: string }> };
    const bundle = preview.bundles.find((candidate) => candidate.valid && candidate.repository === "personal");
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

    const afterSkill = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ repository: string; skills: Array<{ id: string; files: Record<string, string> }> }> };
    const personalAfterSkill = afterSkill.bundles.find((candidate) => candidate.repository === "personal");
    expect(personalAfterSkill?.skills.find((skill) => skill.id === "personal-skill")?.files["personal-skill/SKILL.md"]).toBe("updated by the mock agent");
    const workspaceAgents = path.join(workspaceRoot, ".agents", "editable-per-environment", "example", "AGENTS.md");
    await request(ws, 5, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: `edit personal instructions write-to:${workspaceAgents}` }],
    });
    const afterInstructions = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ repository: string; agentsMd?: string }> };
    expect(afterInstructions.bundles.find((candidate) => candidate.repository === "personal")?.agentsMd).toBe("updated by the mock agent");
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
    const beforeEntry = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=${environmentId}`).then((response) => response.json()) as { bundles: Array<{ repository: string }> };
    expect(beforeEntry.bundles.find((bundle) => bundle.repository === "personal")).toBeUndefined();
    const entered = await fetch(`http://127.0.0.1:${PORT}/api/session/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, enterEnvironmentIds: [environmentId], leaveEnvironmentIds: [] }),
    }).then((response) => response.json()) as { entered: string[] };
    expect(entered.entered).toContain(environmentId);

    const workspaceSkill = path.join(agentWorkspaceRoot(tempConfigDir, sessionId), ".agents", "editable-per-environment", "new-skill-test", ".agents", "skills", "navigating-xkcd");
    mkdirSync(workspaceSkill, { recursive: true });
    writeFileSync(path.join(workspaceSkill, "SKILL.md"), "---\nname: navigating-xkcd\ndescription: Navigate XKCD.\n---\n", "utf8");
    await request(ws, 3, "session/prompt", { sessionId, prompt: [{ type: "text", text: "say hi briefly" }] });

    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=${environmentId}`).then((response) => response.json()) as { bundles: Array<{ repository: string; skills: Array<{ id: string; files: Record<string, string> }> }> };
    const personal = preview.bundles.find((bundle) => bundle.repository === "personal");
    expect(personal?.skills.find((skill) => skill.id === "navigating-xkcd")?.files["navigating-xkcd/SKILL.md"]).toContain("Navigate XKCD.");
    await request(ws, 4, "session/close", { sessionId });
    ws.close();
  });

  it("soft-deletes personal skills and instructions removed through authoring paths", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "delete-test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "delete-test" },
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

    const workspaceRoot = agentWorkspaceRoot(tempConfigDir, sessionId);
    rmSync(path.join(workspaceRoot, ".agents", "editable-per-environment", "example", ".agents", "skills", "personal-skill"), { recursive: true, force: true });
    rmSync(path.join(workspaceRoot, ".agents", "editable-per-environment", "example", "AGENTS.md"), { recursive: true, force: true });
    await request(ws, 3, "session/prompt", { sessionId, prompt: [{ type: "text", text: "say hi briefly" }] });

    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=web:example.com`).then((response) => response.json()) as { bundles: Array<{ repository: string; skills: Array<{ id: string }>; agentsMd?: string }> };
    const personal = preview.bundles.find((bundle) => bundle.repository === "personal");
    expect(personal?.skills.some((skill) => skill.id === "personal-skill")).not.toBe(true);
    expect(personal?.agentsMd).toBeUndefined();
    await request(ws, 4, "session/close", { sessionId });
    ws.close();
  });

  it("forwards image prompt blocks for runtimes that advertise image support", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "ImageMockAcpAgent", title: "image-test" },
    });
    expect(created.promptCapabilities).toEqual({ image: true });
    const result = await request(ws, 3, "session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "describe this" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    });
    expect(result.stopReason).toBe("end_turn");
    await request(ws, 4, "session/close", { sessionId: created.sessionId });
    ws.close();
  });

  it("rejects image prompts for runtimes without image support", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "text-only-image-test" },
    });
    await expect(request(ws, 3, "session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    })).rejects.toThrow("does not support image prompts");
    await request(ws, 4, "session/close", { sessionId: created.sessionId });
    ws.close();
  });

  it("rejects malformed image prompt data", async () => {
    const ws = await connect();
    await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } });
    const created = await request(ws, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "ImageMockAcpAgent", title: "invalid-image-test" },
    });
    await expect(request(ws, 3, "session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "image", mimeType: "image/png", data: "not base64!" }],
    })).rejects.toThrow("Invalid or oversized image data");
    await request(ws, 4, "session/close", { sessionId: created.sessionId });

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

  it("renames, touches, and deletes sessions via REST session management endpoints", async () => {
    const wsA = await connect();
    await request(wsA, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "manage-a" } });
    const sessionA = await request(wsA, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "manage-a" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const wsB = await connect();
    await request(wsB, 3, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "manage-b" } });
    const sessionB = await request(wsB, 4, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "manage-b" },
    });

    let sessions = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
    const managedOrderBeforeTouch = sessions.sessions
      .filter((session) => session.sessionId === sessionA.sessionId || session.sessionId === sessionB.sessionId)
      .map((session) => session.sessionId);
    expect(managedOrderBeforeTouch).toEqual([sessionB.sessionId, sessionA.sessionId]);

    const renamed = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionA.sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "renamed-a" }),
    }).then((response) => response.json()) as Record<string, unknown>;
    expect(renamed.title).toBe("renamed-a");
    sessions = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
    const managedOrderAfterRename = sessions.sessions
      .filter((session) => session.sessionId === sessionA.sessionId || session.sessionId === sessionB.sessionId)
      .map((session) => session.sessionId);
    expect(managedOrderAfterRename).toEqual([sessionB.sessionId, sessionA.sessionId]);

    await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionA.sessionId}/touch`, { method: "POST" });
    sessions = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
    expect(sessions.sessions[0]?.sessionId).toBe(sessionA.sessionId);

    await request(wsA, 5, "session/prompt", {
      sessionId: sessionA.sessionId as string,
      prompt: [{ type: "text", text: "tell me a joke" }],
    });
    const transcriptBeforeDelete = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionA.sessionId}/transcript`).then((response) => response.json()) as { events: Array<Record<string, unknown>> };
    expect(transcriptBeforeDelete.events.length).toBeGreaterThan(0);

    const deleted = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionA.sessionId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    sessions = await fetch(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json()) as { sessions: Array<Record<string, unknown>> };
    expect(sessions.sessions.some((session) => session.sessionId === sessionA.sessionId)).toBe(false);
    expect(await fetch(`http://127.0.0.1:${PORT}/api/sessions/${sessionA.sessionId}/transcript`).then((response) => response.status)).toBe(404);

    wsA.close();
    wsB.close();
  });

  it("deletes a session when its runtime does not implement session/close", async () => {
    const previousUnsupported = process.env.MOCK_ACP_SESSION_CLOSE_UNSUPPORTED;
    process.env.MOCK_ACP_SESSION_CLOSE_UNSUPPORTED = "1";
    try {
      const ws = await connect();
      await request(ws, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "delete-unsupported-close" } });
      const session = await request(ws, 2, "session/new", {
        cwd: "/tmp",
        mcpServers: [],
        _meta: { runtimeId: "MockAcpAgent", title: "delete-unsupported-close" },
      });
      const deleted = await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.sessionId}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(await fetch(`http://127.0.0.1:${PORT}/api/sessions/${session.sessionId}`).then((response) => response.status)).toBe(404);
      ws.close();
    } finally {
      if (previousUnsupported === undefined) delete process.env.MOCK_ACP_SESSION_CLOSE_UNSUPPORTED;
      else process.env.MOCK_ACP_SESSION_CLOSE_UNSUPPORTED = previousUnsupported;
    }
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
    expect(sessionA.runtimeId).toBe("MockAcpAgent");

    wsA.close();
    wsB.close();
  });
});
