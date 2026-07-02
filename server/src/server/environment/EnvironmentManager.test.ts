// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import type { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import type { EnvironmentEventListener } from "./types.js";

function mockRepositoryService(): EnvironmentRepositoryService {
  return {
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

describe("EnvironmentManager", () => {
  let decisions: EnvironmentDecisionStore;
  let nowMs: number;

  beforeEach(() => {
    decisions = new EnvironmentDecisionStore(":memory:");
    nowMs = Date.parse("2026-07-02T12:00:00.000Z");
  });

  afterEach(() => {
    decisions.close();
  });

  function newManager(activeWindowMs = 6 * 60_000, recentRetentionMs = 30 * 60_000): EnvironmentManager {
    return new EnvironmentManager(mockRepositoryService(), decisions, {
      activeEnvironmentWindowMs: activeWindowMs,
      recentEnvironmentRetentionMs: recentRetentionMs,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });
  }

  it("keeps a registered environment active in memory", async () => {
    const manager = newManager();

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    expect(manager.isAvailable("web:example.com")).toBe(true);
  });

  it("moves an active environment to recent after the active window", async () => {
    const manager = newManager(1_000, 10_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;

    expect(manager.isAvailable("web:example.com")).toBe(false);
  });

  it("marks an environment recent immediately when unregistered", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    expect(manager.unregister("web:example.com")).toBe(true);
    expect(manager.isAvailable("web:example.com")).toBe(false);
  });

  it("forgets recent environments after the recent retention window", async () => {
    const manager = newManager(1_000, 2_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);

    nowMs += 2_001;
    expect(manager.unregister("web:example.com")).toBe(false);
  });

  it("promotes a recent environment back to active when registered again", async () => {
    const manager = newManager(1_000, 10_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    expect(manager.isAvailable("web:example.com")).toBe(true);
  });

  it("retains persistent decisions and ephemeral visit decisions", () => {
    const manager = newManager();

    manager.decideEnvironment("web:example.com", "approve");
    expect(manager.effectiveDecision("web:example.com")).toBe("approve");

    manager.decideEnvironment("web:example.com", "ignore");
    expect(manager.effectiveDecision("web:example.com")).toBe("ignore");
  });

  it("tracks subscriptions without emitting environment lifecycle events", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
    expect(manager.enteredEnvironments("s1")).toEqual([]);
  });

  it("remembers discovered bundle paths with the environment", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getValidBundles).mockResolvedValue([
      {
        id: "web:example.com#testing",
        bundleId: "testing",
        environmentId: "web:example.com",
        repository: "/repo",
        bundlePath: "/repo/web/example.com/.bundles/testing",
        skills: [],
        mcpServers: [],
        apps: [],
        valid: true,
        errors: [],
      },
    ] as any);
    vi.mocked(repositoryService.getBundleCollectionPaths).mockResolvedValue([
      "/repo/web/example.com/.bundles",
    ]);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    expect(manager.diagnosticSnapshot()).toEqual([
      expect.objectContaining({
        environmentId: "web:example.com",
        bundleIds: ["testing"],
        bundleCollectionPaths: ["/repo/web/example.com/.bundles"],
      }),
    ]);
  });
});
