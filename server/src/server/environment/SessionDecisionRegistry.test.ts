// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SessionDecisionRegistry } from "./SessionDecisionRegistry.js";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";

describe("SessionDecisionRegistry", () => {
  function makeStore() {
    return new EnvironmentDecisionStore(":memory:");
  }

  it("returns undecided when nothing is stored", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    expect(registry.effective("hash-1", "session-1")).toBe("undecided");
    store.close();
  });

  it("respects permanent approve decision", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setPermanent("hash-1", "env-1", "bundle-1", "approve");
    expect(registry.effective("hash-1", "session-1")).toBe("approve");
    store.close();
  });

  it("respects permanent reject decision", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setPermanent("hash-1", "env-1", "bundle-1", "reject");
    expect(registry.effective("hash-1", "session-1")).toBe("reject");
    store.close();
  });

  it("session accept overrides permanent reject for that session", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setPermanent("hash-1", "env-1", "bundle-1", "reject");
    registry.setSession("session-1", "hash-1", "accept");
    expect(registry.effective("hash-1", "session-1")).toBe("accept");
    store.close();
  });

  it("session ignore overrides permanent approve for that session", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setPermanent("hash-1", "env-1", "bundle-1", "approve");
    registry.setSession("session-1", "hash-1", "ignore");
    expect(registry.effective("hash-1", "session-1")).toBe("ignore");
    store.close();
  });

  it("session decision does not affect other sessions", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setPermanent("hash-1", "env-1", "bundle-1", "approve");
    registry.setSession("session-1", "hash-1", "ignore");
    expect(registry.effective("hash-1", "session-2")).toBe("approve");
    store.close();
  });

  it("clearing a session removes its overrides", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession("session-1", "hash-1", "accept");
    registry.clearSession("session-1");
    expect(registry.effective("hash-1", "session-1")).toBe("undecided");
    store.close();
  });

  it("clearing session for specific bundles only removes those", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession("session-1", "hash-1", "accept");
    registry.setSession("session-1", "hash-2", "ignore");
    registry.clearSessionForBundles("session-1", ["hash-1"]);
    expect(registry.effective("hash-1", "session-1")).toBe("undecided");
    expect(registry.effective("hash-2", "session-1")).toBe("ignore");
    store.close();
  });

  it("clearing a bundle for all sessions removes it everywhere", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession("session-1", "hash-1", "accept");
    registry.setSession("session-2", "hash-1", "ignore");
    registry.clearAllForBundle("hash-1");
    expect(registry.effective("hash-1", "session-1")).toBe("undecided");
    expect(registry.effective("hash-1", "session-2")).toBe("undecided");
    store.close();
  });

  it("clearing multiple bundles for all sessions works", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession("session-1", "hash-1", "accept");
    registry.setSession("session-1", "hash-2", "ignore");
    registry.setSession("session-1", "hash-3", "accept");
    registry.clearAllForBundles(["hash-1", "hash-2"]);
    expect(registry.effective("hash-1", "session-1")).toBe("undecided");
    expect(registry.effective("hash-2", "session-1")).toBe("undecided");
    expect(registry.effective("hash-3", "session-1")).toBe("accept");
    store.close();
  });

  it("isEmpty returns true for fresh registry", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    expect(registry.isEmpty).toBe(true);
    store.close();
  });

  it("isEmpty returns false after setting a session decision", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession("session-1", "hash-1", "accept");
    expect(registry.isEmpty).toBe(false);
    store.close();
  });

  it('setSession with undefined sessionId is a no-op', () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession(undefined, "hash-1", "accept");
    expect(registry.effective("hash-1", "session-1")).toBe("undecided");
    expect(registry.isEmpty).toBe(true);
    store.close();
  });

  it("setPermanent clears session overrides for that hash", () => {
    const store = makeStore();
    const registry = new SessionDecisionRegistry(store);
    registry.setSession("session-1", "hash-1", "ignore");
    registry.setPermanent("hash-1", "env-1", "bundle-1", "approve");
    // The session override should be cleared, so the permanent decision shines through
    expect(registry.effective("hash-1", "session-1")).toBe("approve");
    store.close();
  });
});
