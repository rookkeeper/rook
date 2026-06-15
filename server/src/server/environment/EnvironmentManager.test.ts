// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import type { LocalEnvironmentRepository } from "./LocalEnvironmentRepository.js";
import type { EnvironmentEventListener } from "./types.js";

function mockRepository(skillPaths: string[]): LocalEnvironmentRepository {
  return {
    getSkillPaths: vi.fn().mockResolvedValue(skillPaths),
    getSkillPreviews: vi.fn().mockResolvedValue([]),
  } as unknown as LocalEnvironmentRepository;
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

  function newManager(skillPaths = ["/repo/web/wikipedia"]): EnvironmentManager {
    return new EnvironmentManager(mockRepository(skillPaths), decisions);
  }

  it("offers an undecided environment to subscribed sessions when it becomes available", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);

    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} }, { sourceName: "Wikipedia" });

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith("web:wikipedia", { sourceName: "Wikipedia" });
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
  });

  it("offers an environment that was already available when a session subscribes later", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });

    const listener = mockListener();
    manager.subscribe("s2", listener);

    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith("web:wikipedia", {});
  });

  it("does NOT re-offer a previously-known environment once it has gone unavailable", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    manager.markUnavailable("web:wikipedia");

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
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });

    manager.decideEnvironment("web:wikipedia", "accept");

    expect(a.onEnvironmentEntered).toHaveBeenCalledWith("web:wikipedia", ["/repo/web/wikipedia"]);
    expect(b.onEnvironmentEntered).toHaveBeenCalledWith("web:wikipedia", ["/repo/web/wikipedia"]);
    expect(a.onEnvironmentResolved).toHaveBeenCalledWith("web:wikipedia", "approved");
    expect(b.onEnvironmentResolved).toHaveBeenCalledWith("web:wikipedia", "approved");
  });

  it("approve persists, so a new session auto-enters silently (no offer)", async () => {
    const manager = newManager();
    manager.subscribe("s1", mockListener());
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    manager.decideEnvironment("web:wikipedia", "approve");

    const fresh = mockListener();
    manager.subscribe("s2", fresh);

    expect(fresh.onEnvironmentEntered).toHaveBeenCalledWith("web:wikipedia", ["/repo/web/wikipedia"]);
    expect(fresh.onEnvironmentOffered).not.toHaveBeenCalled();
  });

  it("approve survives an availability episode (re-enters next time without asking)", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    manager.decideEnvironment("web:wikipedia", "approve");
    manager.markUnavailable("web:wikipedia");

    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });

    expect(listener.onEnvironmentEntered).toHaveBeenCalledWith("web:wikipedia", ["/repo/web/wikipedia"]);
    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
  });

  it("ignore is scoped to the visit: not entered now, but re-offered after it returns", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });

    manager.decideEnvironment("web:wikipedia", "ignore");
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();

    manager.markUnavailable("web:wikipedia");
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    expect(listener.onEnvironmentOffered).toHaveBeenLastCalledWith("web:wikipedia", {});
  });

  it("reject persists: a new session is never offered the environment", async () => {
    const manager = newManager();
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    manager.decideEnvironment("web:wikipedia", "reject");

    const listener = mockListener();
    manager.subscribe("s1", listener);

    expect(listener.onEnvironmentOffered).not.toHaveBeenCalled();
    expect(listener.onEnvironmentEntered).not.toHaveBeenCalled();
  });

  it("an ephemeral ignore overrides a persistent approve for the current visit", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    manager.decideEnvironment("web:wikipedia", "approve");
    expect(listener.onEnvironmentEntered).toHaveBeenCalledTimes(1);

    manager.decideEnvironment("web:wikipedia", "ignore");

    expect(listener.onEnvironmentExited).toHaveBeenCalledWith("web:wikipedia");
  });

  it("marks entered environments as exited when they go unavailable", async () => {
    const manager = newManager();
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.registerAvailableEnvironment({ id: "web:wikipedia", metadata: {} });
    manager.decideEnvironment("web:wikipedia", "accept");
    expect(manager.enteredEnvironments("s1")).toEqual(["web:wikipedia"]);

    manager.markUnavailable("web:wikipedia");

    expect(listener.onEnvironmentExited).toHaveBeenCalledWith("web:wikipedia");
    expect(listener.onEnvironmentResolved).toHaveBeenCalledWith("web:wikipedia", "unavailable");
    expect(manager.enteredEnvironments("s1")).toEqual([]);
  });
});
