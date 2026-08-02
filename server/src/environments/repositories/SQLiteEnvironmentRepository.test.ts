// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { hashEnvironmentBundle } from "../../shared/environmentBundleHash.js";
import { CompositeEnvironmentRepository } from "./CompositeEnvironmentRepository.js";
import { SQLiteEnvironmentRepository } from "./SQLiteEnvironmentRepository.js";
import { AgentWorkspaceMaterializer } from "../../runtime/AgentWorkspaceMaterializer.js";

function result() {
  return {
    environment: { id: "web:example.com", displayName: "Example", description: "Example website" },
    bundles: [{
      id: "web:example.com#mail",
      bundleId: "mail",
      environmentId: "web:example.com",
      repository: "canonical",
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

  it("round-trips bundle content and metadata", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    repository.saveResult(result());

    const loaded = await repository.getBundles("web:example.com");
    expect(loaded.environment).toEqual({ id: "web:example.com", displayName: "Example", description: "Example website" });
    expect(loaded.bundles[0]).toMatchObject({ bundleId: "mail", repository: "canonical", agentsMd: "Confirm before sending.", revision: { contentHash: hashEnvironmentBundle(loaded.bundles[0]!) } });
    expect(loaded.bundles[0]?.skills[0]?.files["mail-search/SKILL.md"]).toBe("Search mail.");
  });

  it("writes a changed artifact as a new bundle revision", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult(result());
    const before = (await repository.getBundles("web:example.com")).bundles[0]?.revision?.contentHash;
    await repository.replaceArtifactFiles("web:example.com", "mail", "skills", "mail-search", { "mail-search/SKILL.md": "Changed search." });
    const loaded = (await repository.getBundles("web:example.com")).bundles[0]!;
    expect(loaded.skills[0]?.files["mail-search/SKILL.md"]).toBe("Changed search.");
    expect(loaded.revision?.contentHash).not.toBe(before);
  });

  it("writes database-backed personal skill edits through the workspace", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    repository.saveResult(result());
    const workspace = await mkdtemp(path.join(os.tmpdir(), "rook-db-workspace-"));
    tempDirs.push(workspace);
    const loaded = (await repository.getBundles("web:example.com")).bundles[0]!;
    const materializer = new AgentWorkspaceMaterializer();
    const materialized = await materializer.materialize(workspace, [{
      environmentName: "Example",
      bundleName: "Personal capabilities",
      editable: true,
      bundle: loaded,
      writeBackSkill: (skillId, files) => repository.replaceArtifactFiles("web:example.com", "mail", "skills", skillId, files),
    }]);
    await writeFile(path.join(workspace, ".agent", "skills", "mail-search", "SKILL.md"), "Edited in the agent workspace.", "utf8");
    await materializer.syncWritableChanges(materialized);
    const updated = (await repository.getBundles("web:example.com")).bundles[0]!;
    expect(updated.skills[0]?.files["mail-search/SKILL.md"]).toBe("Edited in the agent workspace.");
  });

  it("lists environments and searches bundle content", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    repository.saveResult(result());

    expect((await repository.listEnvironments()).map((environment) => environment.id)).toEqual(["web:example.com"]);
    expect((await repository.searchBundles("mail-search")).map((bundle) => bundle.bundleId)).toEqual(["mail"]);
    expect((await repository.searchBundles("mail-search", "personal")).map((bundle) => bundle.bundleId)).toEqual([]);
    expect((await repository.searchBundles("mail-search", "canonical")).map((bundle) => bundle.bundleId)).toEqual(["mail"]);
  });

  it("combines canonical and personal database repositories", async () => {
    const canonicalDatastore = new EnvironmentRepositoryDatastore(":memory:");
    const personalDatastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(canonicalDatastore, personalDatastore);
    const canonical = new SQLiteEnvironmentRepository(canonicalDatastore, "canonical");
    const personal = new SQLiteEnvironmentRepository(personalDatastore, "personal");
    const personalResult = result();
    personalResult.bundles[0]!.bundleId = "personal";
    personalResult.bundles[0]!.id = "web:example.com#personal";
    canonical.saveResult(result());
    personal.saveResult(personalResult);
    const combined = new CompositeEnvironmentRepository([canonical, personal]);
    const loaded = await combined.getBundles("web:example.com");
    expect(loaded.bundles.map((bundle) => `${bundle.repository}:${bundle.bundleId}`)).toEqual(["canonical:mail", "personal:personal"]);
  });

});
