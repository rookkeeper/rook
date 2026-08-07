// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnvironmentDecisionStore } from "./EnvironmentDecisionStore.js";
import { RookDatastore } from "../../infrastructure/datastores/RookDatastore.js";

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

  it("migrates legacy nullable bundle IDs out of the active schema", () => {
    const datastore = new RookDatastore(":memory:");
    datastore.db.exec(`
      CREATE TABLE environment_decisions (
        bundle_hash TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        bundle_id TEXT,
        decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
        updated_at TEXT NOT NULL
      );
      INSERT INTO environment_decisions VALUES ('legacy', 'web:example.com', NULL, 'reject', '2026-01-01T00:00:00.000Z');
      INSERT INTO environment_decisions VALUES ('current', 'web:example.com', 'bundle', 'approve', '2026-01-01T00:00:00.000Z');
    `);

    const store = new EnvironmentDecisionStore(datastore);
    const columns = datastore.db.prepare("PRAGMA table_info(environment_decisions)").all() as Array<{ name: string; notnull: number }>;
    expect(columns.find((column) => column.name === "bundle_id")?.notnull).toBe(1);
    expect(store.getDecision("legacy")).toBeNull();
    expect(store.getDecision("current")).toBe("approve");
    store.close();
    datastore.close();
  });

  it("clears a decision by bundle hash", () => {
    const store = new EnvironmentDecisionStore(":memory:");

    store.setDecision("hash-1", "web:a.com", "bundle-a", "approve");
    store.clearDecision("hash-1");

    expect(store.getDecision("hash-1")).toBeNull();
    store.close();
  });
});
