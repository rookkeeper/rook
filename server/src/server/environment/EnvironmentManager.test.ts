// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import type { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import type { EnvironmentEventListener } from "./types.js";

function mockRepositoryService(skillPaths: string[] | Record<string, string[]>): EnvironmentRepositoryService {
  return {
    getSkillRuntimePaths: vi.fn(async (environmentId: string) => Array.isArray(skillPaths) ? skillPaths : (skillPaths[environmentId] ?? [])),
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

  beforeEach(() => {
    decisions = new EnvironmentDecisionStore(":memory:");
  });

  afterEach(() => {
    decisions.close();
  });

  function newManager(skillPaths: string[] | Record<string, string[]> = ["/repo/web/example.com"]): EnvironmentManager {
    return new EnvironmentManager(mockRepositoryService(skillPaths), decisions);
  }

  it("offers an undecided environment to subscribed sessions when it becomes available", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith("web:example.com", { sourceName: "Example" });
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
  });

  it("offers an environment that was already available when a session subscribes later", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    const listener = mockListener();
    manager.subscribe("s2", listener);

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith("web:example.com", {});
  });

  it("does not offer an environment with no skill paths", async () => {
    const manager = newManager([]);
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} }, { sourceName: "Example" });

    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
  });

  it("does NOT re-offer a previously-known environment once it has been unregistered", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.unregister("web:example.com");

    const listener = mockListener();
    manager.subscribe("s-new", listener);

    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
  });

  it("accept enters the environment in all open sessions and resolves the offer", async () => {
    const manager = newManager();
    const a = mockListener();
    const b = mockListener();
    manager.subscribe("s1", a);
    manager.subscribe("s2", b);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    manager.decideEnvironment("web:example.com", "accept");

    expect(a.onEnvironmentEntered).toHaveBeenCalledWith("web:example.com", ["/repo/web/example.com"]);
    expect(b.onEnvironmentEntered).toHaveBeenCalledWith("web:example.com", ["/repo/web/example.com"]);
    expect(a.onEnvironmentResolved).toHaveBeenCalledWith("web:example.com", "approved");
    expect(b.onEnvironmentResolved).toHaveBeenCalledWith("web:example.com", "approved");
  });

  it("approve persists, so a new session auto-enters silently (no offer)", async () => {
    const manager = newManager();
    manager.subscribe("s1", mockListener());
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "approve");

    const fresh = mockListener();
    manager.subscribe("s2", fresh);

    expect(fresh.onEnvironmentEntered).toHaveBeenCalledWith("web:example.com", ["/repo/web/example.com"]);
    expect(fresh.onEnvironmentOffered).not.toHaveBeenCalled();
  });

  it("approve survives an availability episode (re-enters next time without asking)", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "approve");
    manager.unregister("web:example.com");

    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    expect(listener.onEnvironmentEntered).toHaveBeenCalledWith("web:example.com", ["/repo/web/example.com"]);
    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
  });

  it("ignore is scoped to the visit: not entered now, but re-offered after it returns", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });

    manager.decideEnvironment("web:example.com", "ignore");
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();

    manager.unregister("web:example.com");
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    expect(listener.onEnvironmentOffered).toHaveBeenLastCalledWith("web:example.com", {});
  });

  it("reject persists: a new session is never offered the environment", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "reject");

    const listener = mockListener();
    manager.subscribe("s1", listener);

    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
  });

  it("an ephemeral ignore overrides a persistent approve for the current visit", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "approve");
    expect(listener.onEnvironmentEntered).toHaveBeenCalledTimes(1);

    manager.decideEnvironment("web:example.com", "ignore");

    expect(listener.onEnvironmentExited).toHaveBeenCalledWith("web:example.com");
  });

  it("marks entered environments as exited when unregistered", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:example.com", metadata: {} });
    manager.decideEnvironment("web:example.com", "accept");
    expect(manager.enteredEnvironments("s1")).toEqual(["web:example.com"]);

    manager.unregister("web:example.com");

    expect(listener.onEnvironmentExited).toHaveBeenCalledWith("web:example.com");
    expect(listener.onEnvironmentResolved).toHaveBeenCalledWith("web:example.com", "unavailable");
    expect(manager.enteredEnvironments("s1")).toEqual([]);
  });

  it("expands a deep registration into all implied parent environments", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "app:md.obsidian/Peeps", metadata: {} }, { sourceName: "Obsidian · Peeps" });

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith("app:md.obsidian", { sourceName: "Obsidian · Peeps" });
    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith("app:md.obsidian/Peeps", { sourceName: "Obsidian · Peeps" });
    expect(manager.isAvailable("app:md.obsidian")).toBe(true);
    expect(manager.isAvailable("app:md.obsidian/Peeps")).toBe(true);
  });

  it("keeps implied parent environments available while another deep child still implies them", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:en.wikipedia.org/wiki/Main_Page", metadata: {} });
    await manager.registerAvailableEnvironment({ id: "web:en.wikipedia.org/wiki/Other_Page", metadata: {} });

    manager.unregister("web:en.wikipedia.org/wiki/Main_Page");

    expect(manager.isAvailable("web:en.wikipedia.org")).toBe(true);
    expect(manager.isAvailable("web:en.wikipedia.org/wiki")).toBe(true);
    expect(manager.isAvailable("web:en.wikipedia.org/wiki/Main_Page")).toBe(false);
    expect(manager.isAvailable("web:en.wikipedia.org/wiki/Other_Page")).toBe(true);
    expect(listener.onEnvironmentResolved).toHaveBeenCalledWith("web:en.wikipedia.org/wiki/Main_Page", "unavailable");
    expect(listener.onEnvironmentResolved).not.toHaveBeenCalledWith("web:en.wikipedia.org/wiki", "unavailable");
    expect(listener.onEnvironmentResolved).not.toHaveBeenCalledWith("web:en.wikipedia.org", "unavailable");
  });

  it("loads ancestor skills when entering a deep environment, but not child skills when entering a parent", async () => {
    const manager = newManager({
      "web:en.wikipedia.org": ["/repo/web/en.wikipedia.org"],
      "web:en.wikipedia.org/wiki": ["/repo/web/en.wikipedia.org/wiki"],
      "web:en.wikipedia.org/wiki/Main_Page": ["/repo/web/en.wikipedia.org/wiki/Main_Page"],
    });
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:en.wikipedia.org/wiki/Main_Page", metadata: {} });
    manager.decideEnvironment("web:en.wikipedia.org/wiki/Main_Page", "accept");

    expect(listener.onEnvironmentEntered).toHaveBeenCalledWith(
      "web:en.wikipedia.org/wiki/Main_Page",
      [
        "/repo/web/en.wikipedia.org",
        "/repo/web/en.wikipedia.org/wiki",
        "/repo/web/en.wikipedia.org/wiki/Main_Page",
      ],
    );

    const parentOnly = mockListener();
    manager.subscribe("s2", parentOnly);
    manager.decideEnvironment("web:en.wikipedia.org", "accept");

    expect(parentOnly.onEnvironmentEntered).toHaveBeenCalledWith(
      "web:en.wikipedia.org",
      ["/repo/web/en.wikipedia.org"],
    );
  });
});
