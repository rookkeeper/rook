// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectDirectoryEnvironmentRepository } from "./ProjectDirectoryEnvironmentRepository.js";

describe("ProjectDirectoryEnvironmentRepository", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("reads project-owned skills, instructions, and MCP configuration in place", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "rook-project-env-"));
    tempDirs.push(project);
    const skill = path.join(project, ".agents", "skills", "deploy");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "Deploy carefully.");
    await writeFile(path.join(project, "AGENTS.md"), "Never deploy on Fridays.");
    await writeFile(path.join(project, ".mcp.json"), '{"mcpServers":{}}');

    const repository = new ProjectDirectoryEnvironmentRepository();
    const result = await repository.getBundles(`dir:${project}`);

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.bundleId).toBe("directory");
    expect(result.bundles[0]?.skills[0]?.sourcePath).toBe(skill);
    expect(result.bundles[0]?.agentsMd).toContain("Never deploy on Fridays.");
    expect(result.bundles[0]?.mcpServers[0]?.sourcePath).toBe(path.join(project, ".mcp.json"));
  });

  it("ignores dangling skill symlinks while reading valid project skills", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "rook-project-env-"));
    tempDirs.push(project);
    const skillsRoot = path.join(project, ".agents", "skills");
    const skill = path.join(skillsRoot, "deploy");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "Deploy carefully.");
    await symlink(path.join(project, "missing-skill"), path.join(skillsRoot, "stale"));

    const repository = new ProjectDirectoryEnvironmentRepository();
    const result = await repository.getBundles(`dir:${project}`);

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.valid).toBe(true);
    expect(result.bundles[0]?.skills.map((artifact) => artifact.id)).toEqual(["deploy"]);
  });

  it("reads skills only from the standard project skills directory", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "rook-project-env-"));
    tempDirs.push(project);
    const skill = path.join(project, ".agents", "skills", "deploy");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "Deploy carefully.");
    const ignored = path.join(project, ".claude", "skills", "ignored");
    await mkdir(ignored, { recursive: true });
    await writeFile(path.join(ignored, "SKILL.md"), "Not discovered.");

    const repository = new ProjectDirectoryEnvironmentRepository();
    const result = await repository.getBundles(`dir:${project}`);

    expect(result.bundles[0]?.skills.map((artifact) => artifact.id)).toEqual(["deploy"]);
  });

  it("reads project instructions from AGENTS.md", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "rook-project-env-"));
    tempDirs.push(project);
    await writeFile(path.join(project, "AGENTS.md"), "Project instructions.");

    const repository = new ProjectDirectoryEnvironmentRepository();
    expect((await repository.getBundles(`dir:${project}`)).bundles[0]?.agentsMd).toBe("Project instructions.");
  });
});
