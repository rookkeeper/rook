// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DirectoryEnvironmentRepository } from "./DirectoryEnvironmentRepository.js";

describe("DirectoryEnvironmentRepository", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("reads bundle-structured environments from disk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-env-repo-"));
    tempDirs.push(root);

    const skillDir = path.join(root, "web", "example.com", ".bundles", "testing", "skills", "testing-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: testing-skill\ndescription: ok\n---\n");

    const repo = new DirectoryEnvironmentRepository(root);
    const result = await repo.getBundles("web:example.com");

    expect(result.environment?.id).toBe("web:example.com");
    expect(result.errors).toEqual([]);
    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.bundleId).toBe("testing");
    expect(result.bundles[0]?.skills.map((skill) => skill.id)).toEqual(["testing-skill"]);
  });

  it("reads nested environment paths independently", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-env-repo-"));
    tempDirs.push(root);

    const parentSkillDir = path.join(root, "web", "example.com", ".bundles", "parent", "skills", "parent-skill");
    const childSkillDir = path.join(root, "web", "example.com", "stuff", ".bundles", "child", "skills", "child-skill");
    await mkdir(parentSkillDir, { recursive: true });
    await mkdir(childSkillDir, { recursive: true });
    await writeFile(path.join(parentSkillDir, "SKILL.md"), "---\nname: parent-skill\ndescription: ok\n---\n");
    await writeFile(path.join(childSkillDir, "SKILL.md"), "---\nname: child-skill\ndescription: ok\n---\n");

    const repo = new DirectoryEnvironmentRepository(root);
    const parent = await repo.getBundles("web:example.com");
    const child = await repo.getBundles("web:example.com/stuff");

    expect(parent.bundles.map((bundle) => bundle.bundleId)).toEqual(["parent"]);
    expect(child.bundles.map((bundle) => bundle.bundleId)).toEqual(["child"]);
  });

  it("returns no bundles for environments with no .bundles directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-env-repo-"));
    tempDirs.push(root);
    await mkdir(path.join(root, "web", "example.com"), { recursive: true });

    const repo = new DirectoryEnvironmentRepository(root);
    const result = await repo.getBundles("web:example.com");

    expect(result.environment?.id).toBe("web:example.com");
    expect(result.bundles).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("captures invalid skill bundle structure as structured errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-env-repo-"));
    tempDirs.push(root);

    const brokenSkillDir = path.join(root, "web", "example.com", ".bundles", "broken", "skills", "broken-skill");
    await mkdir(brokenSkillDir, { recursive: true });
    await writeFile(path.join(brokenSkillDir, "NOT_SKILL.md"), "oops");

    const repo = new DirectoryEnvironmentRepository(root);
    const result = await repo.getBundles("web:example.com");

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "invalid_bundle_contents")).toBe(true);
  });

  it("supports symlinked skill directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-env-repo-"));
    tempDirs.push(root);

    const envSkillsDir = path.join(root, "web", "example.com", ".bundles", "linked", "skills");
    await mkdir(envSkillsDir, { recursive: true });

    const target = path.join(root, "targets", "linked-skill");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "SKILL.md"), "---\nname: linked\ndescription: ok\n---\n");
    await symlink(target, path.join(envSkillsDir, "linked-skill"));

    const repo = new DirectoryEnvironmentRepository(root);
    const result = await repo.getBundles("web:example.com");

    expect(result.bundles[0]?.skills.map((skill) => skill.id)).toEqual(["linked-skill"]);
  });
});
