// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";

describe("EnvironmentDecisionStore", () => {
  it("stores and retrieves a persistent decision with all columns", () => {
    const store = new EnvironmentDecisionStore(":memory:");

    store.setDecision(
      "abc123hash",
      "web:example.com",
      "my-bundle",
      "approve",
    );

    expect(store.getDecision("abc123hash")).toBe("approve");
    store.close();
  });

  it("returns null for an unknown bundle hash", () => {
    const store = new EnvironmentDecisionStore(":memory:");
    expect(store.getDecision("nonexistent")).toBeNull();
    store.close();
  });

  it("upserts an existing decision", () => {
    const store = new EnvironmentDecisionStore(":memory:");

    store.setDecision("hash-1", "web:a.com", "bundle-a", "approve");
    store.setDecision("hash-1", "web:a.com", "bundle-a", "reject");

    expect(store.getDecision("hash-1")).toBe("reject");
    store.close();
  });

  it("allows null bundle_id for legacy environment-level decisions", () => {
    const store = new EnvironmentDecisionStore(":memory:");

    store.setDecision("hash-legacy", "web:example.com", null, "reject");

    expect(store.getDecision("hash-legacy")).toBe("reject");
    store.close();
  });

  it("clears a decision by bundle hash", () => {
    const store = new EnvironmentDecisionStore(":memory:");

    store.setDecision("hash-1", "web:a.com", "bundle-a", "approve");
    store.clearDecision("hash-1");

    expect(store.getDecision("hash-1")).toBeNull();
    store.close();
  });
});
