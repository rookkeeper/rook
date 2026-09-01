// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../index.js";
import type { GuardedFetchOptions, GuardedFetchResult } from "../infrastructure/http/guardedFetch.js";
import type { GuardedFetcher } from "../environments/services/WebEnvironmentScout.js";

type Json = Record<string, any>;
type Fixture = {
  version: number;
  siteSkillName: string;
  agentsMd: string;
  llmsTxt: string;
  skillMd: string;
};
type PreviewBundle = Json & {
  bundleHash: string;
  skills: Array<{ id: string; files: Record<string, string> }>;
};
type SocketClient = {
  ws: WebSocket;
  next: (timeoutMs?: number) => Promise<Json>;
};

const SITE_SKILL_NAME = "shared-site-skill";
const SITE_SKILL_MARKER = "SITE_SKILL_MARKER";
const SITE_AGENTS_MARKER = "SITE_AGENTS_MARKER";
const SITE_LLMS_MARKER = "SITE_LLMS_MARKER";
const LOCAL_SKILL_MARKER = "LOCAL_SKILL_MARKER";
const LOCAL_AGENTS_MARKER = "LOCAL_AGENTS_MARKER";
const UPDATED_LOCAL_SKILL_MARKER = "UPDATED_LOCAL_SKILL_MARKER";
const UPDATED_LOCAL_AGENTS_MARKER = "UPDATED_LOCAL_AGENTS_MARKER";
const NEW_SKILL_NAME = "new-local-skill";
const FIXTURE_HOSTS = [
  "discovery.example",
  "case.example",
  "always.example",
  "visit.example",
  "ignore.example",
  "reject.example",
  "author.example",
];

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function fixture(host: string): Fixture {
  return {
    version: 1,
    siteSkillName: SITE_SKILL_NAME,
    agentsMd: `${SITE_AGENTS_MARKER} for ${host}`,
    llmsTxt: `${SITE_LLMS_MARKER} for ${host}`,
    skillMd: `${SITE_SKILL_MARKER} for ${host}`,
  };
}

function response(url: string, body: string, contentType: string, etag: string): GuardedFetchResult {
  return {
    kind: "ok",
    status: 200,
    body,
    bytes: new Uint8Array(Buffer.from(body, "utf8")),
    contentType,
    etag,
    finalUrl: url,
  };
}

function fakeWebsiteFetcher(fixtures: Map<string, Fixture>): GuardedFetcher {
  return async (url: string, options: GuardedFetchOptions): Promise<GuardedFetchResult> => {
    const parsed = new URL(url);
    const current = fixtures.get(parsed.hostname);
    if (!current) return { kind: "absent", status: 404 };

    const etag = `"${current.version}"`;
    if (options.ifNoneMatch === etag) return { kind: "not_modified", etag };

    if (parsed.pathname === "/llms.txt") {
      return response(url, current.llmsTxt, "text/plain", etag);
    }
    if (parsed.pathname === "/AGENTS.md") {
      return response(url, current.agentsMd, "text/markdown", etag);
    }
    if (parsed.pathname === "/.well-known/agent-skills/index.json") {
      const index = JSON.stringify({
        $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        skills: [
          {
            name: current.siteSkillName,
            description: "A site-published skill.",
            type: "skill-md",
            url: `https://${parsed.hostname}/skills/${current.siteSkillName}/SKILL.md`,
            digest: `sha256:${sha256(current.skillMd)}`,
          },
          {
            name: "archived-site-skill",
            description: "An archive that is intentionally unsupported.",
            type: "archive",
            url: `https://${parsed.hostname}/skills/archived-site-skill.tar.gz`,
            digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
      });
      return response(url, index, "application/json", etag);
    }
    if (parsed.pathname === `/skills/${current.siteSkillName}/SKILL.md`) {
      return response(url, current.skillMd, "text/markdown", etag);
    }
    return { kind: "absent", status: 404 };
  };
}

function waitForMessage(client: SocketClient, method: string, timeoutMs = 2_000): Promise<Json> {
  return (async () => {
    while (true) {
      const message = await client.next(timeoutMs);
      if (message.method === method) return message;
    }
  })();
}

async function request(client: SocketClient, id: number, method: string, params: Json = {}): Promise<Json> {
  client.ws.send(JSON.stringify({ jsonrpc: "2.0", id: String(id), method, params }));
  while (true) {
    const message = await client.next();
    if (message.id !== String(id)) continue;
    if (message.error) throw new Error(String(message.error.message ?? "ACP request failed"));
    return message.result as Json;
  }
}

async function noMessage(client: SocketClient, method: string, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const message = await client.next(Math.max(1, deadline - Date.now()));
      if (message.method === method) throw new Error(`Unexpected ACP notification: ${method}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unexpected ACP")) throw error;
      return;
    }
  }
}

describe("web environment API integration", { timeout: 30_000 }, () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let root: string;
  let port: number;
  let fixtures: Map<string, Fixture>;
  let originalHome: string | undefined;
  let originalRookHome: string | undefined;
  let originalRuntimePath: string | undefined;

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "rook-web-environment-integration-"));
    const rookHome = path.join(root, "rook-home");
    const runtimePath = path.join(root, "agent-runtimes.json");
    const pidFile = path.join(root, "mock-pids");
    const mockServerPath = path.join(process.cwd(), "src", "agents", "test-fixtures", "mockAcpServer.mjs");
    writeFileSync(runtimePath, JSON.stringify({
      profiles: [{
        id: "MockAcpAgent",
        type: "acp",
        command: "node",
        args: [mockServerPath],
        cwd: process.cwd(),
        env: { MOCK_ACP_PID_FILE: pidFile },
      }],
    }));

    originalHome = process.env.HOME;
    originalRookHome = process.env.ROOK_HOME;
    originalRuntimePath = process.env.ROOK_AGENT_RUNTIMES_PATH;
    process.env.HOME = root;
    process.env.ROOK_HOME = rookHome;
    process.env.ROOK_AGENT_RUNTIMES_PATH = runtimePath;

    fixtures = new Map(FIXTURE_HOSTS.map((host) => [host, fixture(host)]));
    app = await buildServer({
      logger: false,
      authToken: "",
      environmentRepositoryDatabase: path.join(root, "canonical.db"),
      personalEnvironmentRepositoryDatabase: path.join(root, "environment-repository.db"),
      environmentDecisionStoreLocation: path.join(root, "decisions.db"),
      webScout: {
        fetch: fakeWebsiteFetcher(fixtures),
        ttlMs: 0,
        errorTtlMs: 0,
      },
      runtimeOptions: {
        runtimeRequestTimeoutMs: 1_000,
        cancelGraceMs: 50,
        runtimeShutdownTimeoutMs: 100,
        runtimeIdleTimeoutMs: 5_000,
        runtimeIdleCheckIntervalMs: 25,
      },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app?.close();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalRookHome === undefined) delete process.env.ROOK_HOME;
    else process.env.ROOK_HOME = originalRookHome;
    if (originalRuntimePath === undefined) delete process.env.ROOK_AGENT_RUNTIMES_PATH;
    else process.env.ROOK_AGENT_RUNTIMES_PATH = originalRuntimePath;

    const pidFile = path.join(root, "mock-pids");
    if (existsSync(pidFile)) {
      for (const value of readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean)) {
        try { process.kill(Number(value), "SIGTERM"); } catch { /* already exited */ }
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  async function http(method: string, url: string, payload?: Json): Promise<{ status: number; body: Json }> {
    const result = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });
    return { status: result.statusCode, body: result.body ? JSON.parse(result.body) : {} };
  }

  async function preview(host: string): Promise<{ environmentId: string; bundles: PreviewBundle[] }> {
    const result = await http("GET", `/api/environments/preview?environmentId=web:${host}`);
    expect(result.status).toBe(200);
    return result.body as { environmentId: string; bundles: PreviewBundle[] };
  }

  async function registerAndWait(host: string, differentFrom?: string): Promise<PreviewBundle> {
    const result = await http("POST", "/api/environments/register", { id: `web:${host}` });
    expect(result.status).toBe(200);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const current = await preview(host);
      const site = current.bundles.find((bundle) => bundle.scoutPublished === true);
      const diagnostics = await http("GET", "/api/diagnostics/environments");
      const remembered = (diagnostics.body.environments as Json[]).find((entry) => entry.environmentId === `web:${host}`);
      const registeredBundle = remembered?.bundles?.some((bundle: Json) => bundle.bundleHash === site?.bundleHash);
      if (site && registeredBundle && site.bundleHash !== differentFrom) return site;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${host} to be scouted`);
  }

  async function openSession(title: string): Promise<{ client: SocketClient; sessionId: string }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
    const queue: Json[] = [];
    const waiters: Array<(message: Json) => void> = [];
    const client: SocketClient = {
      ws,
      next: (timeoutMs = 2_000) => new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued) {
          resolve(queued);
          return;
        }
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ACP message (queued: ${queue.map((message) => message.method ?? `response:${message.id}`).join(", ")})`));
        }, timeoutMs);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      }),
    };
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as Json;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    try {
      await request(client, 1, "initialize", {
        protocolVersion: 1,
        clientCapabilities: { _meta: { "com.rookkeeper": { environmentOffers: true } } },
        clientInfo: { name: "integration-test" },
      });
    } catch (error) {
      throw new Error(`${title}: initialize failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let created: Json;
    try {
      created = await request(client, 2, "session/new", {
      cwd: "/tmp",
      mcpServers: [],
      _meta: { runtimeId: "MockAcpAgent", title },
      });
    } catch (error) {
      throw new Error(`${title}: session/new failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { client, sessionId: String(created.sessionId) };
  }

  async function closeSession(client: SocketClient, _sessionId: string, _id: number): Promise<void> {
    // Closing the facade is sufficient for these tests and immediately clears the
    // in-memory temporary decision. The server owns cleanup of the test runtimes.
    if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
    await new Promise<void>((resolve) => {
      if (client.ws.readyState === WebSocket.CLOSED) resolve();
      else client.ws.once("close", () => resolve());
    });
  }

  async function enter(client: SocketClient, sessionId: string, host: string): Promise<void> {
    const result = await http("POST", "/api/session/environments", {
      sessionId,
      enterEnvironmentIds: [`web:${host}`],
      leaveEnvironmentIds: [],
    });
    expect(result.status).toBe(200);
  }

  async function leave(sessionId: string, host: string): Promise<void> {
    const result = await http("POST", "/api/session/environments", {
      sessionId,
      enterEnvironmentIds: [],
      leaveEnvironmentIds: [`web:${host}`],
    });
    expect(result.status).toBe(200);
  }

  async function decide(host: string, bundleHash: string, decision: string, sessionId?: string): Promise<void> {
    const result = await http("POST", "/api/environments/decision", {
      environmentId: `web:${host}`,
      bundleHash,
      decision,
      ...(sessionId ? { sessionId } : {}),
    });
    expect(result.status).toBe(200);
  }

  function workspaceText(sessionId: string): string {
    const root = path.join(process.env.ROOK_HOME!, "agent-workspaces", sessionId);
    const readTree = (directory: string): string[] => {
      const text: string[] = [];
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        let isDirectory = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try { isDirectory = statSync(entryPath).isDirectory(); } catch { isDirectory = false; }
        }
        if (isDirectory) text.push(...readTree(entryPath));
        else {
          try { text.push(readFileSync(entryPath, "utf8")); } catch { /* transient cleanup */ }
        }
      }
      return text;
    };
    return existsSync(root) ? readTree(root).join("\n") : "";
  }

  async function expectOffer(client: SocketClient, host: string): Promise<Json> {
    try {
      return await waitForMessage(client, "_com.rookkeeper/environment_offer");
    } catch (error) {
      throw new Error(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function waitForWorkspaceMarker(sessionId: string, marker: string): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const root = path.join(process.env.ROOK_HOME!, "agent-workspaces", sessionId);
      if (existsSync(path.join(root, "AGENTS.md")) && workspaceText(sessionId).includes(marker)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${marker} in session ${sessionId}`);
  }

  async function waitForPersonalBundle(host: string, condition: (bundle: PreviewBundle) => boolean): Promise<PreviewBundle> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const personal = (await preview(host)).bundles.find((bundle) => bundle.scoutPublished !== true);
      if (personal && condition(personal)) return personal;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for personal bundle for ${host}`);
  }

  it("discovers all website resources and exposes a preview", async () => {
    const site = await registerAndWait("discovery.example");
    expect(site.publisher).toBe("discovery.example");
    expect(site.scoutPublished).toBe(true);
    expect(site.agentsMd).toContain(SITE_AGENTS_MARKER);
    expect(site.llmsTxt).toContain(SITE_LLMS_MARKER);
    expect(site.skills.find((skill) => skill.id === SITE_SKILL_NAME)?.files[`${SITE_SKILL_NAME}/SKILL.md`]).toContain(SITE_SKILL_MARKER);
    expect(site.errors.some((error: Json) => error.code === "unsupported_capability")).toBe(true);
    expect((await preview("discovery.example")).bundles).toContainEqual(expect.objectContaining({ bundleHash: site.bundleHash }));
  });

  async function exerciseDecision(host: string, decision: "approve" | "accept" | "ignore" | "reject", secondSessionOffers: boolean): Promise<void> {
    const site = await registerAndWait(host);
    const first = await openSession(`${decision}-first`);
    await enter(first.client, first.sessionId, host);
    const offer = await expectOffer(first.client, host);
    expect(offer.params).toMatchObject({ environmentId: `web:${host}`, bundleHash: site.bundleHash });
    await decide(host, site.bundleHash, decision, decision === "approve" || decision === "reject" ? undefined : first.sessionId);
    if (decision === "approve" || decision === "accept") {
      await waitForWorkspaceMarker(first.sessionId, SITE_SKILL_MARKER);
    } else {
      expect(workspaceText(first.sessionId)).not.toContain(SITE_SKILL_MARKER);
    }
    await leave(first.sessionId, host);
    await closeSession(first.client, first.sessionId, 10);

    const second = await openSession(`${decision}-second`);
    await enter(second.client, second.sessionId, host);
    if (secondSessionOffers) await expectOffer(second.client, host);
    else await noMessage(second.client, "_com.rookkeeper/environment_offer");
    if (decision === "approve") await waitForWorkspaceMarker(second.sessionId, SITE_SKILL_MARKER);
    else expect(workspaceText(second.sessionId)).not.toContain(SITE_SKILL_MARKER);
    await closeSession(second.client, second.sessionId, 11);
  }

  it("canonicalizes web host candidates before lookup", async () => {
    const site = await registerAndWait("case.example");
    const result = await http("POST", "/api/environments/register", { id: "web:CASE.EXAMPLE" });
    expect(result.status).toBe(200);
    const current = await preview("CASE.EXAMPLE");
    expect(current.bundles.find((bundle) => bundle.scoutPublished === true)?.bundleHash).toBe(site.bundleHash);
  });

  it("persists an always-allow decision across sessions", async () => {
    await exerciseDecision("always.example", "approve", false);
  });

  it("keeps allow-this-visit scoped to its session", async () => {
    await exerciseDecision("visit.example", "accept", true);
  });

  it("keeps not-now scoped to its session", async () => {
    await exerciseDecision("ignore.example", "ignore", true);
  });

  it("persists never-reject and reoffers changed content", async () => {
    const host = "reject.example";
    const original = await registerAndWait(host);
    const first = await openSession("reject-first");
    await enter(first.client, first.sessionId, host);
    await expectOffer(first.client, host);
    await decide(host, original.bundleHash, "reject");
    await closeSession(first.client, first.sessionId, 12);

    const second = await openSession("reject-second");
    await enter(second.client, second.sessionId, host);
    await noMessage(second.client, "_com.rookkeeper/environment_offer");
    await closeSession(second.client, second.sessionId, 13);

    const changed = fixtures.get(host)!;
    changed.version = 2;
    changed.agentsMd += " CHANGED";
    changed.llmsTxt += " CHANGED";
    changed.skillMd += " CHANGED";
    const refreshed = await registerAndWait(host, original.bundleHash);
    expect(refreshed.bundleHash).not.toBe(original.bundleHash);
    const third = await openSession("reject-changed");
    await enter(third.client, third.sessionId, host);
    await expectOffer(third.client, host);
    await closeSession(third.client, third.sessionId, 14);
  });

  it("keeps site and personal content separate through creation, editing, and deletion in later sessions", async () => {
    const host = "author.example";
    const site = await registerAndWait(host);
    const first = await openSession("author-first");
    await enter(first.client, first.sessionId, host);
    await waitForMessage(first.client, "_com.rookkeeper/environment_offer");
    await decide(host, site.bundleHash, "approve");
    await waitForWorkspaceMarker(first.sessionId, SITE_SKILL_MARKER);

    const workspaceRoot = path.join(process.env.ROOK_HOME!, "agent-workspaces", first.sessionId);
    const personalRoot = path.join(workspaceRoot, ".agents", "editable-per-environment", "author-example");
    const personalSkillsRoot = path.join(personalRoot, ".agents", "skills");
    mkdirSync(path.join(personalSkillsRoot, NEW_SKILL_NAME), { recursive: true });
    mkdirSync(path.join(personalSkillsRoot, SITE_SKILL_NAME), { recursive: true });
    writeFileSync(path.join(personalSkillsRoot, NEW_SKILL_NAME, "SKILL.md"), `---\nname: ${NEW_SKILL_NAME}\ndescription: Local skill.\n---\n${LOCAL_SKILL_MARKER}\n`);
    writeFileSync(path.join(personalSkillsRoot, SITE_SKILL_NAME, "SKILL.md"), `---\nname: ${SITE_SKILL_NAME}\ndescription: Local replacement name.\n---\n${LOCAL_SKILL_MARKER}\n`);
    writeFileSync(path.join(personalRoot, "AGENTS.md"), LOCAL_AGENTS_MARKER);
    await waitForPersonalBundle(host, (bundle) =>
      bundle.agentsMd === LOCAL_AGENTS_MARKER
      && bundle.skills.some((skill) => skill.id === NEW_SKILL_NAME)
      && bundle.skills.some((skill) => skill.id === SITE_SKILL_NAME));
    await waitForWorkspaceMarker(first.sessionId, LOCAL_AGENTS_MARKER);

    let current = await preview(host);
    let personal = current.bundles.find((bundle) => bundle.scoutPublished !== true);
    const external = current.bundles.find((bundle) => bundle.scoutPublished === true);
    expect(external?.publisher).toBe(host);
    expect(external?.agentsMd).toContain(SITE_AGENTS_MARKER);
    expect(external?.llmsTxt).toContain(SITE_LLMS_MARKER);
    expect(external?.skills.find((skill) => skill.id === SITE_SKILL_NAME)?.files[`${SITE_SKILL_NAME}/SKILL.md`]).toContain(SITE_SKILL_MARKER);
    expect(personal?.publisher).not.toBe(host);
    expect(personal?.agentsMd).toBe(LOCAL_AGENTS_MARKER);
    expect(personal?.skills.find((skill) => skill.id === NEW_SKILL_NAME)?.files[`${NEW_SKILL_NAME}/SKILL.md`]).toContain(LOCAL_SKILL_MARKER);
    expect(personal?.skills.find((skill) => skill.id === SITE_SKILL_NAME)?.files[`${SITE_SKILL_NAME}/SKILL.md`]).toContain(LOCAL_SKILL_MARKER);

    const visibleSkillDirs = readdirSync(path.join(workspaceRoot, ".agents", "skills"));
    const visibleSiteSkill = visibleSkillDirs.find((name) => readFileSync(path.join(workspaceRoot, ".agents", "skills", name, "SKILL.md"), "utf8").includes(SITE_SKILL_MARKER));
    expect(visibleSiteSkill).toBeDefined();
    expect((statSync(path.join(workspaceRoot, ".agents", "skills", visibleSiteSkill!, "SKILL.md")).mode & 0o222)).toBe(0);
    expect((statSync(path.join(workspaceRoot, "AGENTS.md")).mode & 0o222)).toBe(0);
    expect(readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8")).toContain(SITE_AGENTS_MARKER);
    expect(readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8")).toContain(LOCAL_AGENTS_MARKER);
    await closeSession(first.client, first.sessionId, 21);

    const second = await openSession("author-second");
    await enter(second.client, second.sessionId, host);
    await waitForWorkspaceMarker(second.sessionId, SITE_AGENTS_MARKER);
    await waitForWorkspaceMarker(second.sessionId, LOCAL_SKILL_MARKER);
    const secondRoot = path.join(process.env.ROOK_HOME!, "agent-workspaces", second.sessionId);
    const secondSkillDirs = readdirSync(path.join(secondRoot, ".agents", "skills"));
    const secondSiteSkill = secondSkillDirs.find((name) => readFileSync(path.join(secondRoot, ".agents", "skills", name, "SKILL.md"), "utf8").includes(SITE_SKILL_MARKER));
    const secondLocalSkill = secondSkillDirs.find((name) =>
      (name === SITE_SKILL_NAME || name.startsWith(`${SITE_SKILL_NAME}_`))
      && readFileSync(path.join(secondRoot, ".agents", "skills", name, "SKILL.md"), "utf8").includes(LOCAL_SKILL_MARKER));
    expect(secondSiteSkill).toBeDefined();
    expect(secondLocalSkill).toBeDefined();
    expect(secondSiteSkill).not.toBe(secondLocalSkill);
    expect(secondLocalSkill).toMatch(new RegExp(`^${SITE_SKILL_NAME}(_\\d+)?$`));
    expect((statSync(path.join(secondRoot, ".agents", "skills", secondSiteSkill!, "SKILL.md")).mode & 0o222)).toBe(0);
    expect(lstatSync(path.join(secondRoot, ".agents", "skills", secondLocalSkill!)).isSymbolicLink()).toBe(true);
    const secondPersonalRoot = path.join(secondRoot, ".agents", "editable-per-environment", "author-example");
    writeFileSync(path.join(secondPersonalRoot, "AGENTS.md"), UPDATED_LOCAL_AGENTS_MARKER);
    writeFileSync(path.join(secondPersonalRoot, ".agents", "skills", NEW_SKILL_NAME, "SKILL.md"), `---\nname: ${NEW_SKILL_NAME}\ndescription: Local skill.\n---\n${UPDATED_LOCAL_SKILL_MARKER}\n`);
    await waitForPersonalBundle(host, (bundle) =>
      bundle.agentsMd === UPDATED_LOCAL_AGENTS_MARKER
      && bundle.skills.find((skill) => skill.id === NEW_SKILL_NAME)?.files[`${NEW_SKILL_NAME}/SKILL.md`]?.includes(UPDATED_LOCAL_SKILL_MARKER) === true);

    current = await preview(host);
    personal = current.bundles.find((bundle) => bundle.scoutPublished !== true);
    expect(personal?.agentsMd).toBe(UPDATED_LOCAL_AGENTS_MARKER);
    expect(personal?.skills.find((skill) => skill.id === NEW_SKILL_NAME)?.files[`${NEW_SKILL_NAME}/SKILL.md`]).toContain(UPDATED_LOCAL_SKILL_MARKER);
    expect(personal?.skills.find((skill) => skill.id === SITE_SKILL_NAME)?.files[`${SITE_SKILL_NAME}/SKILL.md`]).toContain(LOCAL_SKILL_MARKER);
    expect(current.bundles.find((bundle) => bundle.scoutPublished === true)?.agentsMd).toContain(SITE_AGENTS_MARKER);

    expect(readFileSync(path.join(secondRoot, "AGENTS.md"), "utf8")).toContain(UPDATED_LOCAL_AGENTS_MARKER);
    await closeSession(second.client, second.sessionId, 23);

    const third = await openSession("author-third");
    await enter(third.client, third.sessionId, host);
    await waitForWorkspaceMarker(third.sessionId, SITE_AGENTS_MARKER);
    const thirdRoot = path.join(process.env.ROOK_HOME!, "agent-workspaces", third.sessionId);
    const thirdPersonalRoot = path.join(thirdRoot, ".agents", "editable-per-environment", "author-example");
    rmSync(path.join(thirdPersonalRoot, ".agents", "skills", NEW_SKILL_NAME), { recursive: true, force: true });
    rmSync(path.join(thirdPersonalRoot, "AGENTS.md"), { force: true });
    await waitForPersonalBundle(host, (bundle) =>
      bundle.agentsMd === undefined
      && !bundle.skills.some((skill) => skill.id === NEW_SKILL_NAME));
    current = await preview(host);
    personal = current.bundles.find((bundle) => bundle.scoutPublished !== true);
    expect(personal?.agentsMd).toBeUndefined();
    expect(personal?.skills.some((skill) => skill.id === NEW_SKILL_NAME)).toBe(false);
    expect(personal?.skills.find((skill) => skill.id === SITE_SKILL_NAME)?.files[`${SITE_SKILL_NAME}/SKILL.md`]).toContain(LOCAL_SKILL_MARKER);
    await closeSession(third.client, third.sessionId, 25);

    const fourth = await openSession("author-fourth");
    await enter(fourth.client, fourth.sessionId, host);
    await waitForWorkspaceMarker(fourth.sessionId, SITE_AGENTS_MARKER);
    const fourthRoot = path.join(process.env.ROOK_HOME!, "agent-workspaces", fourth.sessionId);
    expect(readFileSync(path.join(fourthRoot, "AGENTS.md"), "utf8")).toContain(SITE_AGENTS_MARKER);
    expect(readFileSync(path.join(fourthRoot, "AGENTS.md"), "utf8")).not.toContain(LOCAL_AGENTS_MARKER);
    const fourthSkillDirs = readdirSync(path.join(fourthRoot, ".agents", "skills"));
    expect(fourthSkillDirs.some((name) => readFileSync(path.join(fourthRoot, ".agents", "skills", name, "SKILL.md"), "utf8").includes(SITE_SKILL_MARKER))).toBe(true);
    expect(fourthSkillDirs.some((name) => readFileSync(path.join(fourthRoot, ".agents", "skills", name, "SKILL.md"), "utf8").includes(LOCAL_SKILL_MARKER))).toBe(true);
    expect(existsSync(path.join(fourthRoot, ".agents", "skills", NEW_SKILL_NAME))).toBe(false);
    await closeSession(fourth.client, fourth.sessionId, 26);
  });
});
