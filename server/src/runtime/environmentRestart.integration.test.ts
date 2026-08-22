// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../index.js";
import { SQLiteEnvironmentRepository } from "../environments/repositories/SQLiteEnvironmentRepository.js";

const PORT = 19001;
const ENVIRONMENT_ID = "web:restart.example.com";
const BUNDLE_ID = "55555555-5555-4555-8555-555555555555";
const PERSONAL_BUNDLE_ID = "66666666-6666-4666-8666-666666666666";

function connect(sessionId?: string): Promise<WebSocket> {
  const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws${suffix}`);
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function send(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: String(id), method, params }));
}

function receive(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data: unknown) => resolve(JSON.parse(String(data))));
  });
}

async function request(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  send(ws, id, method, params);
  while (true) {
    const message = await receive(ws);
    if (message.id !== String(id)) continue;
    if (message.error) throw new Error((message.error as Record<string, unknown>).message as string ?? "Request failed");
    return message.result as Record<string, unknown>;
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition.");
}

async function buildTestServer(options: {
  canonicalDatabase: string;
  personalDatabase: string;
  applicationDatabase: string;
}) {
  return buildServer({
    environmentRepositoryDatabase: options.canonicalDatabase,
    personalEnvironmentRepositoryDatabase: options.personalDatabase,
    environmentDecisionStoreLocation: options.applicationDatabase,
    authToken: "",
    runtimeOptions: {
      runtimeRequestTimeoutMs: 1_000,
      promptInactivityTimeoutMs: 100,
      cancelGraceMs: 50,
      runtimeShutdownTimeoutMs: 100,
      runtimeIdleTimeoutMs: 1_000,
      runtimeIdleCheckIntervalMs: 25,
    },
  });
}

describe("persistent session environments across server restart", { timeout: 30_000 }, () => {
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let tempHome: string;
  let originalHome: string | undefined;
  let originalRookHome: string | undefined;
  let originalRuntimePath: string | undefined;
  let sessionId: string;
  let workspaceRoot: string;
  let runtimePath: string;

  beforeAll(async () => {
    tempHome = mkdtempSync(path.join(os.tmpdir(), "rook-environment-restart-"));
    originalHome = process.env.HOME;
    originalRookHome = process.env.ROOK_HOME;
    originalRuntimePath = process.env.ROOK_AGENT_RUNTIMES_PATH;
    process.env.HOME = tempHome;
    process.env.ROOK_HOME = path.join(tempHome, "rook-home");
    runtimePath = path.join(tempHome, "agent-runtimes.json");
    const mockServerPath = path.join(process.cwd(), "src", "agents", "test-fixtures", "mockAcpServer.mjs");
    writeFileSync(runtimePath, JSON.stringify({
      profiles: [{
        id: "MockAcpAgent",
        type: "acp",
        command: "node",
        args: [mockServerPath],
        cwd: process.cwd(),
        env: { MOCK_ACP_PID_FILE: path.join(tempHome, "mock-pids") },
      }],
    }));
    process.env.ROOK_AGENT_RUNTIMES_PATH = runtimePath;

    const canonicalDatabase = path.join(tempHome, "canonical.db");
    const canonicalRepository = new SQLiteEnvironmentRepository(canonicalDatabase, "canonical");
    canonicalRepository.saveResult({
      environment: { id: ENVIRONMENT_ID, displayName: "Restart Example", description: "Restart fixture" },
      bundles: [{
        id: `${ENVIRONMENT_ID}#${BUNDLE_ID}`,
        bundleId: BUNDLE_ID,
        environmentId: ENVIRONMENT_ID,
        repository: "canonical",
        skills: [{ id: "restart-skill", files: { "restart-skill/SKILL.md": "restored canonical skill" } }],
        mcpServers: [],
        apps: [],
        agentsMd: "restored canonical instructions",
        valid: true,
        errors: [],
      }],
      errors: [],
    });
    canonicalRepository.close();

    const personalDatabase = path.join(tempHome, "personal.db");
    mkdirSync(path.dirname(personalDatabase), { recursive: true });
    const personalRepository = new SQLiteEnvironmentRepository(personalDatabase, "personal");
    personalRepository.saveResult({
      environment: { id: ENVIRONMENT_ID, displayName: "Restart Example", description: "Restart fixture" },
      bundles: [{
        id: `${ENVIRONMENT_ID}#${PERSONAL_BUNDLE_ID}`,
        bundleId: PERSONAL_BUNDLE_ID,
        environmentId: ENVIRONMENT_ID,
        repository: "personal",
        skills: [{ id: "personal-restart-skill", files: { "personal-restart-skill/SKILL.md": "restored personal skill" } }],
        mcpServers: [],
        apps: [],
        agentsMd: "restored personal instructions",
        valid: true,
        errors: [],
      }],
      errors: [],
    });
    personalRepository.close();

    app = await buildTestServer({
      canonicalDatabase,
      personalDatabase,
      applicationDatabase: path.join(tempHome, "application.db"),
    });
    await app.listen({ host: "127.0.0.1", port: PORT });
  });

  afterAll(async () => {
    await app?.close();
    const pidPath = path.join(tempHome, "mock-pids");
    if (existsSync(pidPath)) {
      const livePids = readFileSync(pidPath, "utf8").trim().split("\n").filter(Boolean).filter((value) => {
        try {
          process.kill(Number(value), 0);
          return true;
        } catch {
          return false;
        }
      });
      if (livePids.length > 0) throw new Error(`Mock runtimes survived server shutdown: ${livePids.join(", ")}`);
    }
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalRookHome === undefined) delete process.env.ROOK_HOME;
    else process.env.ROOK_HOME = originalRookHome;
    if (originalRuntimePath === undefined) delete process.env.ROOK_AGENT_RUNTIMES_PATH;
    else process.env.ROOK_AGENT_RUNTIMES_PATH = originalRuntimePath;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("restores entered environment projections when a session resumes after restart", async () => {
    const firstSocket = await connect();
    await request(firstSocket, 1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "restart-test" } });
    const created = await request(firstSocket, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title: "restart-test" },
    });
    sessionId = String(created.sessionId);
    workspaceRoot = path.join(process.env.ROOK_HOME!, "agent-workspaces", sessionId);

    await fetch(`http://127.0.0.1:${PORT}/api/environments/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ENVIRONMENT_ID, metadata: { displayName: "Restart Example" } }),
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/diagnostics/environments`);
      const body = await response.json() as { environments: Array<{ environmentId: string; status: string }> };
      return body.environments.some((environment) => environment.environmentId === ENVIRONMENT_ID && environment.status === "active");
    });

    const preview = await fetch(`http://127.0.0.1:${PORT}/api/environments/preview?environmentId=${encodeURIComponent(ENVIRONMENT_ID)}`).then((response) => response.json()) as { bundles: Array<{ bundleId: string; bundleHash: string; repository: string }> };
    const canonicalBundle = preview.bundles.find((bundle) => bundle.bundleId === BUNDLE_ID);
    expect(canonicalBundle).toBeDefined();
    await fetch(`http://127.0.0.1:${PORT}/api/environments/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environmentId: ENVIRONMENT_ID, bundleHash: canonicalBundle!.bundleHash, decision: "approve" }),
    });
    const entered = await fetch(`http://127.0.0.1:${PORT}/api/session/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, enterEnvironmentIds: [ENVIRONMENT_ID], leaveEnvironmentIds: [] }),
    }).then((response) => response.json()) as { entered: string[] };
    expect(entered.entered).toEqual([ENVIRONMENT_ID]);
    expect(readFileSync(path.join(workspaceRoot, ".agents", "skills", "restart-skill", "SKILL.md"), "utf8")).toBe("restored canonical skill");
    expect(readFileSync(path.join(workspaceRoot, ".agents", "skills", "personal-restart-skill", "SKILL.md"), "utf8")).toBe("restored personal skill");
    expect(readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8")).toContain("restored canonical instructions");

    firstSocket.close();
    await app?.close();
    app = await buildTestServer({
      canonicalDatabase: path.join(tempHome, "canonical.db"),
      personalDatabase: path.join(tempHome, "personal.db"),
      applicationDatabase: path.join(tempHome, "application.db"),
    });
    await app.listen({ host: "127.0.0.1", port: PORT });

    const resumedSocket = await connect(sessionId);
    await request(resumedSocket, 3, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "resumed-restart-test" } });
    await request(resumedSocket, 4, "session/load", { sessionId });

    const environments = await fetch(`http://127.0.0.1:${PORT}/api/environments/list?sessionId=${encodeURIComponent(sessionId)}`).then((response) => response.json()) as Array<{ environmentId: string; entered: boolean }>;
    expect(environments.find((environment) => environment.environmentId === ENVIRONMENT_ID)?.entered).toBe(true);
    expect(readFileSync(path.join(workspaceRoot, ".agents", "skills", "restart-skill", "SKILL.md"), "utf8")).toBe("restored canonical skill");
    expect(readFileSync(path.join(workspaceRoot, ".agents", "skills", "personal-restart-skill", "SKILL.md"), "utf8")).toBe("restored personal skill");
    expect(readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8")).toContain("restored canonical instructions");
    resumedSocket.close();
  });
});
