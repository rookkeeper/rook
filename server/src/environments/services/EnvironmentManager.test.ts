// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { EnvironmentDecisionStore } from "../datastores/EnvironmentDecisionStore.js";
import type { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import { JsonlEnvironmentMetadataCaptureSink } from "./environmentMetadataCapture.js";
import type { EnvironmentEventListener } from "../support/types.js";

function mockRepositoryService(): EnvironmentRepositoryService {
  return {
    getResolvedBundles: vi.fn(async () => []),
    getValidBundles: vi.fn(async () => []),
    getBundleCollectionPaths: vi.fn(async () => []),
    getEnvironmentPreview: vi.fn().mockResolvedValue({ environmentId: "web:example.com", bundles: [] }),
  } as unknown as EnvironmentRepositoryService;
}

function mockListener(): EnvironmentEventListener {
  return {
    onEnvironmentOffered: vi.fn(),
    onEnvironmentEntered: vi.fn(),
    onEnvironmentExited: vi.fn(),
    onEnvironmentResolved: vi.fn(),
  };
}

function resolvedBundle(environmentId: string, bundleId = "default") {
  return [{
    bundle: {
      id: `${environmentId}#${bundleId}`,
      bundleId,
      environmentId,
      repository: "/repo",
      bundlePath: `/repo/${environmentId.replace(":", "/")}/.bundles/${bundleId}`,
      skills: [],
      mcpServers: [],
      apps: [],
      valid: true,
      errors: [],
    },
    bundleHash: `hash-${environmentId}-${bundleId}`,
  }] as any;
}

describe("EnvironmentManager", () => {
  let decisions: EnvironmentDecisionStore;
  let nowMs: number;
  let originalHome: string | undefined;
  let tempHome: string;
  let captureDir: string;

  beforeEach(() => {
    decisions = new EnvironmentDecisionStore(":memory:");
    nowMs = Date.parse("2026-07-02T12:00:00.000Z");
    originalHome = process.env.HOME;
    tempHome = mkdtempSync(path.join(os.tmpdir(), "rook-home-"));
    process.env.HOME = tempHome;
    captureDir = path.join(tempHome, "IGNORED", "environment_metadata_captures");
  });

  afterEach(() => {
    decisions.close();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function captureSink() {
    return new JsonlEnvironmentMetadataCaptureSink(captureDir);
  }

  function newManager(repositoryService = mockRepositoryService(), activeWindowMs = 6 * 60_000, recentRetentionMs = 30 * 60_000): EnvironmentManager {
    return new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: activeWindowMs,
      recentEnvironmentRetentionMs: recentRetentionMs,
      logger: { info: vi.fn() },
      now: () => nowMs,
      registrationCaptureSink: captureSink(),
    });
  }

  it("keeps a registered environment active in memory", async () => {
    const manager = newManager();

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { displayName: "Example" });

    expect(manager.isAvailable("web:example.com")).toBe(true);
  });

  it("captures registration metadata as jsonl", async () => {
    const manager = newManager();

    await manager.registerAvailableEnvironment(
      { id: "web:example.com/docs", metadata: { displayName: "Docs", observedUrls: ["https://example.com/docs"] } },
      { displayName: "Docs" },
    );

    const filePath = path.join(captureDir, "web-example.com--docs.jsonl");
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        capturedAt: "2026-07-02T12:00:00.000Z",
        environmentId: "web:example.com/docs",
        metadata: { displayName: "Docs", observedUrls: ["https://example.com/docs"] },
      },
    ]);
  });

  it("registers the literal candidate environment id", async () => {
    const manager = newManager();

    await manager.registerCandidateEnvironment({
      id: "web:docs.google.com/document/d/abc/edit",
      metadata: { displayName: "edit", observedUrls: ["https://docs.google.com/document/d/abc/edit"] },
    });

    expect(manager.isAvailable("web:docs.google.com/document/d/abc/edit")).toBe(true);
    expect(manager.isAvailable("web:docs.google.com")).toBe(false);
  });

  it("finalizes additional repository-backed environments discovered from observed urls", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockImplementation(async (environmentId: string) => {
      if (environmentId === "web:docs.google.com/document") return resolvedBundle(environmentId);
      return [];
    });
    const manager = newManager(repositoryService);

    await manager.registerCandidateEnvironment({
      id: "web:docs.google.com/document/d/abc/edit",
      metadata: { displayName: "edit", observedUrls: ["https://docs.google.com/document/d/abc/edit"] },
    });

    expect(manager.isAvailable("web:docs.google.com/document/d/abc/edit")).toBe(true);
    expect(manager.isAvailable("web:docs.google.com/document")).toBe(true);
    expect(manager.isAvailable("web:docs.google.com")).toBe(false);
  });

  it("finalizes additional repository-backed dir environments discovered from observed paths", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockImplementation(async (environmentId: string) => {
      if (environmentId === "dir:/Users/john/project") return resolvedBundle(environmentId);
      return [];
    });
    const manager = newManager(repositoryService);

    await manager.registerCandidateEnvironment({
      id: "dir:/Users/john/project/src",
      metadata: { displayName: "src", observedPaths: ["/Users/john/project/src/main.cpp"] },
    });

    expect(manager.isAvailable("dir:/Users/john/project/src")).toBe(true);
    expect(manager.isAvailable("dir:/Users/john/project")).toBe(true);
  });

  it("moves an active environment to recent after the active window", async () => {
    const manager = newManager(mockRepositoryService(), 1_000, 10_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;

    expect(manager.isAvailable("web:example.com")).toBe(false);
  });

  it("forgets recent environments after the recent retention window", async () => {
    const manager = newManager(mockRepositoryService(), 1_000, 2_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);

    nowMs += 2_001;
    expect(manager.diagnosticSnapshot()).toEqual([]);
  });

  it("uses candidate displayName for environment list entries", async () => {
    const manager = newManager();
    manager.subscribe("s1", mockListener());

    await manager.registerCandidateEnvironment({
      id: "dir:/Users/john/project-x",
      metadata: { displayName: "Project X", observedPaths: ["/Users/john/project-x/main.cpp"] },
    });

    expect(manager.environmentList("s1")[0]).toMatchObject({
      environmentId: "dir:/Users/john/project-x",
      displayName: "Project X",
    });
  });

  it("falls back to the last environment-id segment when displayName is absent", async () => {
    const manager = newManager();
    manager.subscribe("s1", mockListener());

    await manager.registerAvailableEnvironment({ id: "web:example.com/docs", metadata: {} });

    expect(manager.environmentList("s1")[0]).toMatchObject({
      displayName: "docs",
    });
  });

  it("entering a child environment does not implicitly enter its parent", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "mac:md.obsidian", metadata: { displayName: "Obsidian" } }, { displayName: "Obsidian" });
    await manager.registerAvailableEnvironment({ id: "mac:md.obsidian/Rooknanigans", metadata: { displayName: "Rooknanigans" } }, { displayName: "Rooknanigans" });

    const entered = manager.enterEnvironment("s1", "mac:md.obsidian/Rooknanigans");

    expect(entered).toEqual(["mac:md.obsidian/Rooknanigans"]);
    expect(manager.enteredEnvironments("s1")).toEqual(["mac:md.obsidian/Rooknanigans"]);
    expect(listener.onEnvironmentEntered).toHaveBeenCalledTimes(1);
    expect(listener.onEnvironmentEntered).toHaveBeenCalledWith("mac:md.obsidian/Rooknanigans", []);
  });

  it("resolves approved bundle content for runtime materialization", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockImplementation(async (environmentId: string) => {
      if (environmentId !== "web:example.com") return [];
      return [{
        bundle: {
          id: "web:example.com#mail",
          bundleId: "mail",
          environmentId,
          repository: "canonical",
          skills: [{ id: "mail-search", files: { "mail-search/SKILL.md": "Search mail." } }],
          mcpServers: [],
          apps: [],
          agentsMd: "Confirm before sending.",
          valid: true,
          errors: [],
        },
        bundleHash: "hash-mail",
      }] as any;
    });
    const manager = newManager(repositoryService);
    manager.subscribe("s1", mockListener());
    await manager.registerCandidateEnvironment({ id: "web:example.com", metadata: { displayName: "Gmail" } });
    manager.enterEnvironment("s1", "web:example.com");
    manager.decideEnvironment("web:example.com", "approve", "hash-mail", "s1");

    await expect(manager.runtimeBundlesForSession("s1")).resolves.toMatchObject([{
      environmentName: "Gmail",
      bundleName: "Environment capabilities",
      editable: false,
      bundle: { bundleId: "mail", agentsMd: "Confirm before sending." },
    }]);

    const prompt = manager.runtimeInstructionsForSession("s1", "/tmp/session-workspace");
    expect(prompt).toContain('<bundle name="Environment capabilities">');
    expect(prompt).toContain("Confirm before sending.");
  });

  it("does not render unapproved canonical bundle instructions", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([{
      bundle: {
        id: "web:example.com#mail",
        bundleId: "mail",
        environmentId: "web:example.com",
        repository: "canonical",
        skills: [],
        mcpServers: [],
        apps: [],
        agentsMd: "Do not show this until approved.",
        valid: true,
        errors: [],
      },
      bundleHash: "hash-mail",
    }] as any);
    const manager = newManager(repositoryService);
    manager.subscribe("s1", mockListener());
    await manager.registerCandidateEnvironment({ id: "web:example.com", metadata: { displayName: "Gmail" } });
    manager.enterEnvironment("s1", "web:example.com");

    expect(manager.runtimeInstructionsForSession("s1", "/tmp/session-workspace")).not.toContain("Do not show this until approved.");

    manager.decideEnvironment("web:example.com", "approve", "hash-mail", "s1");

    expect(manager.runtimeInstructionsForSession("s1", "/tmp/session-workspace")).toContain("Do not show this until approved.");
  });

  it("provides the Rook identity for plain sessions", () => {
    expect(newManager().runtimeIdentityInstructions()).toContain("## You are Rook");
  });

  it("offers undecided bundles with displayName only", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockImplementation(async (environmentId: string) => {
      if (environmentId === "web:example.com") return resolvedBundle(environmentId, "testing");
      return [];
    });
    const manager = newManager(repositoryService);
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerCandidateEnvironment({
      id: "web:example.com",
      metadata: { displayName: "Example" },
    });
    manager.enterEnvironment("s1", "web:example.com");

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith({
      environmentId: "web:example.com",
      displayName: "Example",
      bundleId: "testing",
      bundleHash: "hash-web:example.com-testing",
      skills: [],
      mcpServers: [],
      apps: [],
    });
  });
});
