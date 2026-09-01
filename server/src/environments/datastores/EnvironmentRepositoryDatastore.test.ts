// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentRepositoryDatastore } from "./EnvironmentRepositoryDatastore.js";

describe("EnvironmentRepositoryDatastore", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function scopedShapeDatabase(): string {
    const root = mkdtempSync(path.join(tmpdir(), "env-repo-datastore-"));
    roots.push(root);
    const location = path.join(root, "environment-repository.db");
    const db = new DatabaseSync(location);
    db.exec(`
      CREATE TABLE environments (
        environment_id TEXT NOT NULL,
        repository TEXT NOT NULL DEFAULT 'personal',
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (repository, environment_id)
      );
      CREATE TABLE capabilities (
        capability_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        files_json TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE bundles (
        bundle_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        repository TEXT NOT NULL DEFAULT 'personal',
        capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
        publisher TEXT NOT NULL DEFAULT 'default',
        deleted_at TEXT,
        PRIMARY KEY (repository, bundle_id, capability_id)
      );
    `);
    db.prepare("INSERT INTO environments VALUES (?, ?, ?, ?, ?)").run("web:example.com", "personal", "My Example", "mine", '{"note":1}');
    db.prepare("INSERT INTO environments VALUES (?, ?, ?, ?, ?)").run("web:example.com", "web", "example.com", "scouted", '{"scout":{"status":"content"}}');
    db.prepare("INSERT INTO capabilities VALUES (?, ?, ?, ?, ?)").run("cap-user", "skill", "joke", "{}", "h1");
    db.prepare("INSERT INTO capabilities VALUES (?, ?, ?, ?, ?)").run("cap-site", "skill", "site-skill", "{}", "h2");
    db.prepare("INSERT INTO bundles VALUES (?, ?, ?, ?, ?, ?)").run("user-bundle", "web:example.com", "personal", "cap-user", "default", null);
    db.prepare("INSERT INTO bundles VALUES (?, ?, ?, ?, ?, ?)").run("site", "web:example.com", "web", "cap-site", "default", null);
    db.close();
    return location;
  }

  it("collapses the interim repository-scoped shape to one row per environment", () => {
    const location = scopedShapeDatabase();
    const datastore = new EnvironmentRepositoryDatastore(location);

    const environments = datastore.db.prepare("SELECT environment_id, display_name, metadata_json FROM environments").all() as Array<Record<string, unknown>>;
    expect(environments).toHaveLength(1);
    // Personal identity wins; scout metadata survives the merge.
    expect(environments[0]?.display_name).toBe("My Example");
    expect(JSON.parse(String(environments[0]?.metadata_json))).toMatchObject({ note: 1, scout: { status: "content" } });

    const bundles = datastore.db.prepare("SELECT bundle_id, publisher FROM bundles ORDER BY bundle_id").all() as Array<Record<string, unknown>>;
    expect(bundles).toEqual([
      { bundle_id: "site", publisher: "example.com" },
      { bundle_id: "user-bundle", publisher: "personal" },
    ]);

    const primaryKey = (datastore.db.prepare("PRAGMA table_info(environments)").all() as Array<Record<string, unknown>>)
      .filter((column) => Number(column.pk) > 0)
      .map((column) => String(column.name));
    expect(primaryKey).toEqual(["environment_id"]);
    datastore.close();

    // Reopening finds nothing left to migrate.
    const reopened = new EnvironmentRepositoryDatastore(location);
    expect(reopened.db.prepare("SELECT COUNT(*) AS count FROM environments").get()).toMatchObject({ count: 1 });
    reopened.close();
  });

  it("leaves a repository-neutral database untouched", () => {
    const root = mkdtempSync(path.join(tmpdir(), "env-repo-datastore-"));
    roots.push(root);
    const location = path.join(root, "environment-repository.db");
    const first = new EnvironmentRepositoryDatastore(location);
    first.db.prepare("INSERT INTO environments (environment_id, display_name, description) VALUES (?, ?, ?)").run("web:example.com", "Example", "d");
    first.close();

    const second = new EnvironmentRepositoryDatastore(location);
    expect(second.db.prepare("SELECT display_name FROM environments").get()).toMatchObject({ display_name: "Example" });
    second.close();
  });
});
