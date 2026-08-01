// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { SQLiteEnvironmentRepository } from "./SQLiteEnvironmentRepository.js";

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
    expect(loaded.bundles[0]).toMatchObject({ bundleId: "mail", repository: "canonical", agentsMd: "Confirm before sending." });
    expect(loaded.bundles[0]?.skills[0]?.files["mail-search/SKILL.md"]).toBe("Search mail.");
  });

  it("imports the existing directory repository shape", async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), "rook-directory-repo-"));
    tempDirs.push(source);
    const skillDir = path.join(source, "web", "example.com", ".bundles", "mail", "skills", "mail-search");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "Search mail.");
    await writeFile(path.join(source, "web", "example.com", ".bundles", "mail", "AGENTS.md"), "Confirm before sending.");

    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    expect(await repository.importDirectory(source)).toBe(1);

    const loaded = await repository.getBundles("web:example.com");
    expect(loaded.bundles.map((bundle) => bundle.bundleId)).toEqual(["mail"]);
    expect(loaded.bundles[0]?.skills[0]?.files["mail-search/SKILL.md"]).toBe("Search mail.");
    expect(loaded.bundles[0]?.agentsMd).toBe("Confirm before sending.");
  });

  it("lists environments and searches bundle content", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    repository.saveResult(result());

    expect((await repository.listEnvironments()).map((environment) => environment.id)).toEqual(["web:example.com"]);
    expect((await repository.searchBundles("mail-search")).map((bundle) => bundle.bundleId)).toEqual(["mail"]);
  });

  it("keeps bundle paths optional for database-backed content", async () => {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "canonical");
    repository.saveResult(result());
    const loaded = await repository.getBundles("web:example.com");
    expect(loaded.bundles[0]?.bundlePath).toBeUndefined();
  });
});
