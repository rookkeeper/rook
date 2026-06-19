// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalEnvironmentRepository } from "./LocalEnvironmentRepository.js";

describe("LocalEnvironmentRepository", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("ignores broken or unreadable skill symlinks without surfacing them to clients", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-env-repo-"));
    tempDirs.push(root);

    const envDir = path.join(root, "app", "md.obsidian", "Peeps", "skills");
    await mkdir(envDir, { recursive: true });

    const validTarget = path.join(root, "targets", "valid-skill");
    await mkdir(validTarget, { recursive: true });
    await writeFile(path.join(validTarget, "SKILL.md"), "---\nname: valid\ndescription: ok\n---\n");

    const brokenTarget = path.join(root, "targets", "missing-skill");

    await symlink(validTarget, path.join(envDir, "valid-skill"));
    await symlink(brokenTarget, path.join(envDir, "broken-skill"));

    const repo = new LocalEnvironmentRepository(root);
    const skillPaths = await repo.getSkillPaths("app:md.obsidian/Peeps");
    const previews = await repo.getSkillPreviews("app:md.obsidian/Peeps");

    expect(skillPaths).toEqual([path.join(envDir, "valid-skill")]);
    expect(previews.map((preview) => preview.id)).toEqual(["valid-skill"]);
  });
});
