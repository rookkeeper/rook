// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import type { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import type { EnvironmentEventListener } from "./types.js";

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

  it("forgets recent environments after the recent retention window", async () => {
    const manager = newManager(1_000, 2_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);

    nowMs += 2_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);
    expect(manager.diagnosticSnapshot()).toEqual([]);
  });

  it("promotes a recent environment back to active when registered again", async () => {
    const manager = newManager(1_000, 10_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    nowMs += 1_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    expect(manager.isAvailable("web:example.com")).toBe(true);
  });

  it("keeps registeredAt stable when an already-active environment is re-registered", async () => {
    const manager = newManager(10_000, 20_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    const first = manager.diagnosticSnapshot()[0];

    nowMs += 2_000;
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    const second = manager.diagnosticSnapshot()[0];

    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.record.metadata.registeredAt).toBe(first.record.metadata.registeredAt);
    expect(second.lastTouchedAt).not.toBe(first.lastTouchedAt);
    expect(second.activeUntil).not.toBe(first.activeUntil);
  });

  it("resets registeredAt when a recent environment becomes active again", async () => {
    const manager = newManager(1_000, 10_000);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    const first = manager.diagnosticSnapshot()[0];

    nowMs += 1_001;
    expect(manager.isAvailable("web:example.com")).toBe(false);

    nowMs += 2_000;
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    const second = manager.diagnosticSnapshot()[0];

    expect(second.registeredAt).not.toBe(first.registeredAt);
    expect(second.record.metadata.registeredAt).not.toBe(first.record.metadata.registeredAt);
    expect(second.lastTouchedAt).toBe(second.registeredAt);
  });

  it("retains persistent decisions and ephemeral visit decisions", () => {
    const manager = newManager();

    manager.decideEnvironment("web:example.com", "approve");
    expect(manager.effectiveDecision("web:example.com")).toBe("approve");

    manager.decideEnvironment("web:example.com", "ignore");
    expect(manager.effectiveDecision("web:example.com")).toBe("ignore");
  });

  it("stores environment_id and bundle_id when approving a bundle by hash", async () => {
    const manager = newManager();

    // Simulate an environment with bundles in memory so decideEnvironment can
    // look up the bundle metadata.
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#my-bundle",
          bundleId: "my-bundle",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/my-bundle",
          skills: [],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-abc",
      },
    ] as any);
    const bundleManager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });

    // Register to get the bundle into remembered state.
    await bundleManager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    // Approve the bundle by hash.
    bundleManager.decideEnvironment("web:example.com", "approve", "hash-abc");

    // effectiveDecision by hash should return approve.
    expect(bundleManager.effectiveDecision("hash-abc")).toBe("approve");
    // The DB entry should be findable.
    expect(decisions.getDecision("hash-abc")).toBe("approve");
  });

  it("shows per-bundle effectiveDecision in diagnostic snapshot", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#my-bundle",
          bundleId: "my-bundle",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/my-bundle",
          skills: [{ id: "talk", files: {} }],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-abc",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });
    manager.decideEnvironment("web:example.com", "accept", "hash-abc");

    const snapshot = manager.diagnosticSnapshot();
    expect(snapshot).toHaveLength(1);
    // Per-bundle decision should be "accept".
    expect(snapshot[0].bundles[0].effectiveDecision).toBe("accept");
    // The top-level (environment-keyed) decision won't match the bundle hash.
  });

  it("ephemeral accept is forgotten when the environment expires", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#my-bundle",
          bundleId: "my-bundle",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/my-bundle",
          skills: [],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-abc",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 1_000,
      recentEnvironmentRetentionMs: 30_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "accept", "hash-abc");
    expect(manager.effectiveDecision("hash-abc")).toBe("accept");

    // Advance past the active window — environment moves to recent, accept is forgotten.
    nowMs += 1_001;
    expect(manager.effectiveDecision("hash-abc")).toBe("undecided");
  });

  it("approve persists across environment expiry", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#my-bundle",
          bundleId: "my-bundle",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/my-bundle",
          skills: [],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-abc",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 1_000,
      recentEnvironmentRetentionMs: 30_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "approve", "hash-abc");
    expect(manager.effectiveDecision("hash-abc")).toBe("approve");

    // Advance past the active window — environment expires, but approve is in DB.
    nowMs += 1_001;
    expect(manager.effectiveDecision("hash-abc")).toBe("approve");
  });

  it("tracks subscriptions without entering environments", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#testing",
          bundleId: "testing",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/testing",
          skills: [{ id: "consult", files: {} }],
          mcpServers: [{ id: "crm", files: {} }],
          apps: [{ id: "slack", files: {} }],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-1",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith({
      environmentId: "web:example.com",
      bundleId: "testing",
      bundleHash: "hash-1",
      sourceName: "Example",
      canonicalSourceUrl: undefined,
      skills: ["consult"],
      mcpServers: ["crm"],
      apps: ["slack"],
    });
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
    expect(manager.enteredEnvironments("s1")).toEqual([]);
  });

  it("remembers discovered bundle paths with the environment", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
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
        bundleHash: "hash-1",
      },
    ] as any);
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
        bundles: [expect.objectContaining({ bundleId: "testing", bundleHash: "hash-1" })],
      }),
    ]);
  });

  it("enters an environment and calls onEnvironmentEntered with skill paths", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#testing",
          bundleId: "testing",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/testing",
          skills: [{ id: "consult", files: {} }],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-1",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    // Approve the bundle so skills are included.
    manager.decideEnvironment("web:example.com", "approve", "hash-1");

    const entered = manager.enterEnvironment("s1", "web:example.com");

    expect(entered).toEqual(["web:example.com"]);
    expect(manager.enteredEnvironments("s1")).toEqual(["web:example.com"]);
    expect(listener.onEnvironmentEntered).toHaveBeenCalledWith(
      "web:example.com",
      ["/repo/web/example.com/.bundles/testing/skills/consult"],
      undefined,
    );
  });

  it("exits an environment and calls onEnvironmentExited", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
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
        bundleHash: "hash-1",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.enterEnvironment("s1", "web:example.com");

    const remaining = manager.exitEnvironment("s1", "web:example.com");

    expect(remaining).toEqual([]);
    expect(manager.enteredEnvironments("s1")).toEqual([]);
    expect(listener.onEnvironmentExited).toHaveBeenCalledWith("web:example.com");
  });

  it("environmentList sorts entered first, then active by recency", async () => {
    const manager = newManager();

    // Register two environments at different times.
    await manager.registerAvailableEnvironment({ id: "web:a.com", metadata: {} }, { sourceName: "A" });
    nowMs += 1_000;
    await manager.registerAvailableEnvironment({ id: "web:b.com", metadata: {} }, { sourceName: "B" });

    // Subscribe and enter the older one.
    const listener = mockListener();
    manager.subscribe("s1", listener);
    manager.enterEnvironment("s1", "web:a.com");

    const list = manager.environmentList("s1");

    // Entered first (web:a.com), then active by recency (web:b.com more recent).
    expect(list[0].environmentId).toBe("web:a.com");
    expect(list[0].entered).toBe(true);
    expect(list[1].environmentId).toBe("web:b.com");
    expect(list[1].entered).toBe(false);
  });

  it("enterEnvironment does nothing for an unsubscribed session", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    const entered = manager.enterEnvironment("nonexistent", "web:example.com");
    expect(entered).toEqual([]);
  });

  it("enterEnvironment skips bundles that are not approved or accepted", async () => {
    const repositoryService = mockRepositoryService();
    vi.mocked(repositoryService.getResolvedBundles).mockResolvedValue([
      {
        bundle: {
          id: "web:example.com#testing",
          bundleId: "testing",
          environmentId: "web:example.com",
          repository: "/repo",
          bundlePath: "/repo/web/example.com/.bundles/testing",
          skills: [{ id: "consult", files: {} }],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
        bundleHash: "hash-1",
      },
    ] as any);
    const manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
    });
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    // Do NOT decide on the bundle — it's undecided.

    manager.enterEnvironment("s1", "web:example.com");

    // Entered should still be called, but with empty skill paths.
    expect(listener.onEnvironmentEntered).toHaveBeenCalledWith(
      "web:example.com",
      [],
      undefined,
    );
  });
});
