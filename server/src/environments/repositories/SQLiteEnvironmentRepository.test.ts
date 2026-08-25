// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { CompositeEnvironmentRepository } from "./CompositeEnvironmentRepository.js";
import { SQLiteEnvironmentRepository } from "./SQLiteEnvironmentRepository.js";
import { CapabilityWorkspaceManager } from "../../runtime/CapabilityWorkspaceManager.js";

const BUNDLE_ID = "11111111-1111-4111-8111-111111111111";

function result(repository = "canonical") {
  return {
    environment: { id: "web:example.com", displayName: "Example", description: "Example website", metadata: { source: "fixture" } },
    bundles: [{
      id: `web:example.com#${BUNDLE_ID}`,
      bundleId: BUNDLE_ID,
      environmentId: "web:example.com",
      repository,
      valid: true,
      errors: [],
      agentsMd: "Confirm before sending.",
      skills: [{ id: "mail-search", files: { "mail-search/SKILL.md": "Search mail." } }],
      mcpServers: [],
      apps: [],
    }],
    errors: [],
  };
}

describe("SQLiteEnvironmentRepository", () => {
  const datastores: EnvironmentRepositoryDatastore[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const datastore of datastores) datastore.close();
    datastores.length = 0;
    await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("round-trips all capability kinds through one file-map representation", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    repository.saveResult({
      ...result(),
      bundles: [{
        ...result().bundles[0]!,
        agentsMd: "Confirm before sending.",
        llmsTxt: "Reference material.",
        facts: [{ id: "facts", files: { "facts.json": "{}" } }],
        mcpServers: [{ id: "config", files: { "config.json": "{}" } }],
        apps: [{ id: "instructions", files: { "instructions.md": "Install it." } }],
      }],
    });

    expect(datastore.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => (row as { name: string }).name)).toEqual(["bundles", "capabilities", "environments"]);
    const loaded = await repository.getBundles("web:example.com");
    expect(loaded.environment).toMatchObject({ id: "web:example.com", metadata: { source: "fixture" } });
    expect(loaded.bundles[0]).toMatchObject({ bundleId: BUNDLE_ID, repository: "canonical", agentsMd: "Confirm before sending.", llmsTxt: "Reference material." });
    expect(loaded.bundles[0]?.skills[0]?.files["mail-search/SKILL.md"]).toBe("Search mail.");
    expect(loaded.bundles[0]?.facts?.[0]?.files["facts.json"]).toBe("{}");
  });

  it("does not create an empty personal bundle", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");

    expect((await repository.getBundles("web:empty.example")).bundles).toEqual([]);
    expect(datastore.db.prepare("SELECT count(*) AS count FROM bundles").get()).toMatchObject({ count: 0 });
  });

  it("updates current capability content without creating revisions", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult(result("personal"));
    expect(datastore.db.prepare("SELECT DISTINCT publisher FROM bundles").all()).toEqual([{ publisher: "personal" }]);
    await repository.replaceCapabilityFiles("web:example.com", BUNDLE_ID, "skill", "mail-search", { "mail-search/SKILL.md": "Changed search." });

    const loaded = (await repository.getBundles("web:example.com")).bundles[0]!;
    expect(loaded.skills[0]?.files["mail-search/SKILL.md"]).toBe("Changed search.");
    expect(datastore.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%revision%'").all()).toEqual([]);
  });

  it("reactivates a deleted membership when the same capability is recreated", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult(result("personal"));

    expect(await repository.deleteCapability("web:example.com", BUNDLE_ID, "skill", "mail-search")).toBe(true);
    expect(await repository.createCapabilityFiles("web:example.com", BUNDLE_ID, "skill", "mail-search", { "mail-search/SKILL.md": "Recreated search." })).toBe(true);

    const loaded = (await repository.getBundles("web:example.com")).bundles[0]!;
    expect(loaded.skills[0]?.files["mail-search/SKILL.md"]).toBe("Recreated search.");
    expect(datastore.db.prepare("SELECT deleted_at FROM bundles WHERE bundle_id = ?").get(BUNDLE_ID)).toMatchObject({ deleted_at: null });
  });

  it("soft-deletes and restores one bundle membership while retaining capability content", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult(result("personal"));

    expect(await repository.deleteCapability("web:example.com", BUNDLE_ID, "skill", "mail-search")).toBe(true);
    expect((await repository.getBundles("web:example.com")).bundles[0]?.skills).toEqual([]);
    expect(datastore.db.prepare("SELECT files_json FROM capabilities WHERE name = 'mail-search'").get()).toBeTruthy();

    expect(await repository.restoreCapability("web:example.com", BUNDLE_ID, "skill", "mail-search")).toBe(true);
    expect((await repository.getBundles("web:example.com")).bundles[0]?.skills[0]?.id).toBe("mail-search");
  });

  it("writes database-backed personal skill edits through the workspace", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult(result("personal"));
    const globalRoot = await mkdtemp(path.join(os.tmpdir(), "rook-db-global-"));
    const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "rook-db-sessions-"));
    tempDirs.push(globalRoot, sessionRoot);
    const loaded = (await repository.getBundles("web:example.com")).bundles[0]!;
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: globalRoot, sessionRoot });
    const materialized = await manager.materialize("session", [{
      environmentName: "Example",
      bundleName: "Personal capabilities",
      editable: true,
      bundle: loaded,
      writeBackSkill: (skillId, files) => repository.replaceCapabilityFiles("web:example.com", BUNDLE_ID, "skill", skillId, files),
    }]);
    await writeFile(path.join(materialized.skillsRoot, "mail-search", "SKILL.md"), "Edited in the agent workspace.", "utf8");
    await manager.assessAndFlush();
    await manager.close();
    const updated = (await repository.getBundles("web:example.com")).bundles[0]!;
    expect(updated.skills[0]?.files["mail-search/SKILL.md"]).toBe("Edited in the agent workspace.");
  });

  it("soft-deletes personal AGENTS.md and skills removed from shared authoring links", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult({
      ...result("personal"),
      bundles: [{
        ...result("personal").bundles[0]!,
        skills: [{ id: "mail-search", files: { "mail-search/SKILL.md": "Search mail." } }],
        agentsMd: "Personal instructions.",
      }],
    });
    const globalRoot = await mkdtemp(path.join(os.tmpdir(), "rook-db-delete-global-"));
    const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "rook-db-delete-sessions-"));
    tempDirs.push(globalRoot, sessionRoot);
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: globalRoot, sessionRoot });
    const loaded = (await repository.getBundles("web:example.com")).bundles[0]!;
    const workspace = await manager.materialize("session", [{
      environmentName: "Example",
      bundleName: "Personal capabilities",
      editable: true,
      bundle: loaded,
      writeBackSkill: (skillId, files) => repository.replaceCapabilityFiles("web:example.com", BUNDLE_ID, "skill", skillId, files),
      writeBackDeleteSkill: (skillId) => repository.deleteCapability("web:example.com", BUNDLE_ID, "skill", skillId),
      writeBackInstructions: (content) => repository.replaceCapabilityFiles("web:example.com", BUNDLE_ID, "instructions", "AGENTS.md", { "AGENTS.md": content }),
      writeBackDeleteInstructions: () => repository.deleteCapability("web:example.com", BUNDLE_ID, "instructions", "AGENTS.md"),
    }]);

    await rm(path.join(workspace.editablePerEnvironmentRoot, "example", ".agents", "skills", "mail-search"), { recursive: true, force: true });
    await rm(path.join(workspace.editablePerEnvironmentRoot, "example", "AGENTS.md"), { recursive: true, force: true });
    await manager.assessAndFlush();

    expect((await repository.getBundles("web:example.com")).bundles).toEqual([]);
    expect(datastore.db.prepare("SELECT count(*) AS count FROM bundles WHERE deleted_at IS NOT NULL").get()).toMatchObject({ count: 2 });
    expect(datastore.db.prepare("SELECT count(*) AS count FROM capabilities").get()).toMatchObject({ count: 2 });
    await manager.close();
  });

  it("creates the first personal capability without an empty bundle", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");

    expect(await repository.createCapabilityFiles("web:xkcd.com", BUNDLE_ID, "skill", "navigating-xkcd", {
      "navigating-xkcd/SKILL.md": "---\nname: navigating-xkcd\ndescription: Navigate XKCD.\n---\n",
    })).toBe(true);

    const loaded = (await repository.getBundles("web:xkcd.com")).bundles[0]!;
    expect(loaded.valid).toBe(true);
    expect(loaded.skills.map((skill) => skill.id)).toEqual(["navigating-xkcd"]);
  });

  it("scopes soft deletion to one bundle membership for shared capabilities", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    const capabilityId = "55555555-5555-4555-8555-555555555555";
    const bundleOne = "66666666-6666-4666-8666-666666666666";
    const bundleTwo = "77777777-7777-4777-8777-777777777777";
    const files = { "shared/SKILL.md": "shared" };
    datastore.db.exec(`
      INSERT INTO environments (environment_id, display_name, description) VALUES ('web:one.example', 'One', 'One'), ('web:two.example', 'Two', 'Two');
      INSERT INTO capabilities (capability_id, type, name, files_json, content_hash) VALUES ('${capabilityId}', 'skill', 'shared', '${JSON.stringify(files)}', 'hash');
      INSERT INTO bundles (bundle_id, environment_id, capability_id) VALUES ('${bundleOne}', 'web:one.example', '${capabilityId}'), ('${bundleTwo}', 'web:two.example', '${capabilityId}');
    `);

    expect(await repository.deleteCapability("web:one.example", bundleOne, "skill", "shared")).toBe(true);
    expect((await repository.getBundles("web:one.example")).bundles).toEqual([]);
    expect((await repository.getBundles("web:two.example")).bundles[0]?.skills[0]?.id).toBe("shared");
  });

  it("lists environments and searches bundle content", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    repository.saveResult(result());

    expect((await repository.listEnvironments()).map((environment) => environment.id)).toEqual(["web:example.com"]);
    expect((await repository.searchBundles("mail-search")).map((bundle) => bundle.bundleId)).toEqual([BUNDLE_ID]);
    expect((await repository.searchBundles("mail-search", "personal")).map((bundle) => bundle.bundleId)).toEqual([]);
  });

  it("combines canonical and personal database repositories", async () => {
    const canonicalDatastore = new EnvironmentRepositoryDatastore(":memory:");
    const personalDatastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(canonicalDatastore, personalDatastore);
    const canonical = new SQLiteEnvironmentRepository(canonicalDatastore, "canonical");
    const personal = new SQLiteEnvironmentRepository(personalDatastore, "personal");
    canonical.saveResult(result());
    personal.saveResult(result("personal"));
    const combined = new CompositeEnvironmentRepository([canonical, personal]);
    const loaded = await combined.getBundles("web:example.com");
    expect(loaded.bundles.map((bundle) => bundle.repository)).toEqual(["canonical", "personal"]);
  });

  it("collapses the unshipped repository-scoped schema into publisher-tagged rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rook-environment-scope-migration-"));
    tempDirs.push(directory);
    const location = path.join(directory, "environment-repository.db");
    const legacy = new DatabaseSync(location);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
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
        capability_id TEXT NOT NULL REFERENCES capabilities(capability_id),
        publisher TEXT NOT NULL DEFAULT 'default',
        deleted_at TEXT,
        PRIMARY KEY (repository, bundle_id, capability_id),
        FOREIGN KEY (repository, environment_id) REFERENCES environments(repository, environment_id)
      );
      INSERT INTO environments VALUES
        ('web:merged.example', 'personal', 'Personal name', 'Personal description', '{"source":"personal"}'),
        ('web:merged.example', 'web', 'merged.example', 'Website merged.example', '{"scout":{"status":"content"}}');
      INSERT INTO capabilities VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'skill', 'personal-skill', '{"personal-skill/SKILL.md":"Personal"}', 'personal-hash'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'skill', 'web-skill', '{"web-skill/SKILL.md":"Web"}', 'web-hash');
      INSERT INTO bundles VALUES
        ('personal-bundle', 'web:merged.example', 'personal', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'default', NULL),
        ('site', 'web:merged.example', 'web', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'merged.example', NULL);
    `);
    legacy.close();

    const datastore = new EnvironmentRepositoryDatastore(location);
    datastores.push(datastore);
    const personal = new SQLiteEnvironmentRepository(datastore, "personal");
    const web = new SQLiteEnvironmentRepository(datastore, "web");

    expect(datastore.db.prepare("SELECT count(*) AS count FROM environments").get()).toEqual({ count: 1 });
    expect(datastore.db.prepare("SELECT count(*) AS count FROM bundles").get()).toEqual({ count: 2 });
    expect(JSON.parse((datastore.db.prepare("SELECT metadata_json FROM environments WHERE environment_id = ?").get("web:merged.example") as { metadata_json: string }).metadata_json))
      .toMatchObject({ source: "personal", scout: { status: "content" } });
    expect((await personal.getBundles("web:merged.example")).bundles[0]?.publisher).toBe("personal");
    expect((await web.getBundles("web:merged.example")).bundles[0]?.publisher).toBe("merged.example");
  });

  it("treats legacy main-branch rows as personal content", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rook-environment-migration-"));
    tempDirs.push(directory);
    const location = path.join(directory, "environment-repository.db");
    const legacy = new DatabaseSync(location);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE environments (
        environment_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
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
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE CASCADE,
        capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
        publisher TEXT NOT NULL DEFAULT 'default',
        deleted_at TEXT,
        PRIMARY KEY (bundle_id, capability_id)
      );
      INSERT INTO environments (environment_id, display_name, description)
      VALUES ('web:legacy.example', 'Legacy', 'Existing personal environment');
      INSERT INTO capabilities (capability_id, type, name, files_json, content_hash)
      VALUES ('88888888-8888-4888-8888-888888888888', 'skill', 'legacy-skill', '{"legacy-skill/SKILL.md":"Legacy"}', 'hash');
      INSERT INTO bundles (bundle_id, environment_id, capability_id)
      VALUES ('99999999-9999-4999-8999-999999999999', 'web:legacy.example', '88888888-8888-4888-8888-888888888888');
    `);
    legacy.close();

    const datastore = new EnvironmentRepositoryDatastore(location);
    datastores.push(datastore);
    const personal = new SQLiteEnvironmentRepository(datastore, "personal");
    const web = new SQLiteEnvironmentRepository(datastore, "web");

    expect(datastore.db.prepare("PRAGMA table_info(environments)").all().some((row) => (row as { name: string }).name === "repository")).toBe(false);
    expect(datastore.db.prepare("SELECT publisher FROM bundles WHERE environment_id = 'web:legacy.example'").get())
      .toEqual({ publisher: "default" });
    expect((await personal.getBundles("web:legacy.example")).bundles[0]?.skills[0]?.id).toBe("legacy-skill");
    expect((await web.getBundles("web:legacy.example")).bundles).toEqual([]);
    expect(datastore.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
