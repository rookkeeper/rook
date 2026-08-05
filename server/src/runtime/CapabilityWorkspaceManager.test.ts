// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CapabilityWorkspaceManager, type CapabilityWorkspaceBundle } from "./CapabilityWorkspaceManager.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("CapabilityWorkspaceManager", () => {
  it("clears the global workspace at startup and retains it after shutdown", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "stale.txt"), "stale", "utf8");

    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: root, sessionRoot: await temporaryDirectory() });

    await expect(access(path.join(root, "stale.txt"))).rejects.toThrow();
    await manager.close();
    await expect(access(path.join(root, "manifest.json"))).resolves.toBeUndefined();
  });

  it("links one SQLite-backed writable skill into every session and authoring slot", async () => {
    const root = await temporaryDirectory();
    const sessionRoot = await temporaryDirectory();
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: root, sessionRoot });
    const bundles = [personalBundle({ skills: [skill("remember")], agentsMd: "Remember this." })];

    const first = await manager.materialize("session-one", bundles);
    const second = await manager.materialize("session-two", bundles);
    const firstSkill = path.join(first.skillsRoot, "remember", "SKILL.md");
    const secondSkill = path.join(second.skillsRoot, "remember", "SKILL.md");
    const authoringSkill = path.join(first.editableSkillsRoot, "mail", "remember", "SKILL.md");
    const aggregate = await readFile(first.agentsPath, "utf8");

    expect(aggregate).toContain("# Rook environment instructions");
    expect(aggregate).toContain("## Environment instructions");
    expect(aggregate).toContain("<environment_instruction environment=\"mail\" editable=\"true\" path=\".agent/AGENTS_FILES/mail/AGENTS.md\">");
    expect(aggregate).toContain("## Skill editing");
    expect(aggregate).toContain("- For the `mail` environment, create new skills in `.agent/editable-skills/mail/<skill-name>/SKILL.md`");
    expect(aggregate).toContain("## Environment skills");
    expect(aggregate).toContain("- `mail`: `remember`");

    expect((await lstat(path.join(first.skillsRoot, "remember"))).isSymbolicLink()).toBe(true);
    expect(await realpath(firstSkill)).toBe(await realpath(secondSkill));
    expect(await realpath(firstSkill)).toBe(await realpath(authoringSkill));

    await writeFile(firstSkill, "updated", "utf8");
    expect(await readFile(secondSkill, "utf8")).toBe("updated");
    expect(JSON.parse(await readFile(path.join(manager.globalRoot(), "manifest.json"), "utf8")).sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: "personal", environmentId: "web:mail.example", bundleId: "personal", artifactId: "remember" }),
    ]));

    await manager.close();
  });

  it("uses default writable instructions without persisting them automatically", async () => {
    const persisted: string[] = [];
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const bundle = personalBundle();
    bundle.writeBackInstructions = async (content) => {
      persisted.push(content);
      return true;
    };

    const workspace = await manager.materialize("session", [bundle]);
    expect(await readFile(path.join(workspace.instructionSourcesRoot, "mail", "AGENTS.md"), "utf8")).toContain("No user-authored instructions have been added for this environment yet.");
    await manager.assessAndFlush();

    expect(persisted).toEqual([]);
    await manager.close();
  });

  it("persists changed existing skills and promotes a new skill once SKILL.md exists", async () => {
    const persisted: Array<{ id: string; files: Record<string, string> }> = [];
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const bundle = personalBundle({ skills: [skill("existing", "before")] });
    bundle.writeBackSkill = async (id, files) => {
      persisted.push({ id, files });
      return true;
    };
    bundle.writeBackNewSkill = async (id, files) => {
      persisted.push({ id, files });
      return true;
    };
    const workspace = await manager.materialize("session", [bundle]);

    await writeFile(path.join(workspace.skillsRoot, "existing", "SKILL.md"), "after", "utf8");
    await mkdir(path.join(workspace.editableSkillsRoot, "mail", "new-skill"), { recursive: true });
    await writeFile(path.join(workspace.editableSkillsRoot, "mail", "new-skill", "SKILL.md"), "new", "utf8");
    await manager.assessAndFlush();

    expect(persisted).toEqual(expect.arrayContaining([
      { id: "existing", files: { "existing/SKILL.md": "after" } },
      { id: "new-skill", files: { "new-skill/SKILL.md": "new" } },
    ]));
    expect(await realpath(path.join(workspace.skillsRoot, "new-skill", "SKILL.md"))).toBe(
      await realpath(path.join(workspace.editableSkillsRoot, "mail", "new-skill", "SKILL.md")),
    );
    expect(await readFile(workspace.agentsPath, "utf8")).toContain("- `mail`: `existing`, `new-skill`");
    await manager.close();
  });

  it("watches shared SQLite sources without waiting for a prompt or restart", async () => {
    const persisted: string[] = [];
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const bundle = personalBundle({ skills: [skill("watched", "before")] });
    bundle.writeBackSkill = async (_id, files) => {
      persisted.push(files["watched/SKILL.md"]!);
      return true;
    };
    const workspace = await manager.materialize("session", [bundle]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(path.join(workspace.skillsRoot, "watched", "SKILL.md"), "after", "utf8");

    await waitFor(() => persisted.includes("after"));
    expect(persisted).toContain("after");
    await manager.close();
  });

  it("suffixes only colliding visible skill folders", async () => {
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const first = personalBundle({ environmentId: "web:first.example", environmentName: "First", skills: [skill("search", "first")] });
    const second = personalBundle({ environmentId: "web:second.example", environmentName: "Second", skills: [skill("search", "second")] });

    const workspace = await manager.materialize("session", [first, second]);

    expect(await readFile(path.join(workspace.skillsRoot, "search", "SKILL.md"), "utf8")).toBe("first");
    expect(await readFile(path.join(workspace.skillsRoot, "search_2", "SKILL.md"), "utf8")).toBe("second");
    await manager.close();
  });

  it("links existing project skills and instructions directly to project files", async () => {
    const project = await temporaryDirectory();
    const skillRoot = path.join(project, ".agents", "skills", "deploy");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, "SKILL.md"), "deploy safely", "utf8");
    await writeFile(path.join(project, "AGENTS.md"), "project instructions", "utf8");
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const workspace = await manager.materialize("session", [projectBundle(project, skillRoot)]);
    const workspaceSkill = path.join(workspace.skillsRoot, "deploy", "SKILL.md");
    const workspaceInstructions = path.join(workspace.instructionSourcesRoot, path.basename(project).toLowerCase(), "AGENTS.md");

    expect(await realpath(workspaceSkill)).toBe(await realpath(path.join(skillRoot, "SKILL.md")));
    expect(await realpath(workspaceInstructions)).toBe(await realpath(path.join(project, "AGENTS.md")));
    await writeFile(workspaceSkill, "changed in project", "utf8");
    expect(await readFile(path.join(skillRoot, "SKILL.md"), "utf8")).toBe("changed in project");
    expect(await readFile(workspace.agentsPath, "utf8")).toContain("project instructions");
    await manager.close();
  });

  it("preserves facts, llms.txt, and read-only MCP projections", async () => {
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const bundle = personalBundle();
    bundle.bundle.facts = [
      { id: "short-fact", files: { "fact.md": "short fact" } },
      { id: "long-fact", files: { "fact.md": "x".repeat(4_001) } },
    ];
    bundle.bundle.llmsTxt = "# Reference";
    bundle.bundle.mcpServers = [{ id: "service", files: { ".mcp.json": "{}" } }];

    const workspace = await manager.materialize("session", [bundle]);

    expect(await readFile(workspace.agentsPath, "utf8")).toContain("short fact");
    expect(await readFile(path.join(workspace.skillsRoot, "fact-long-fact", "SKILL.md"), "utf8")).toContain("x".repeat(4_001));
    expect(await readFile(path.join(workspace.skillsRoot, "llms-personal-capabilities", "SKILL.md"), "utf8")).toContain("# Reference");
    expect(await readFile(path.join(workspace.mcpRoot, "service", ".mcp.json"), "utf8")).toBe("{}");
    await manager.close();
  });

  it("watches project sources directly and regenerates the aggregate", async () => {
    const project = await temporaryDirectory();
    const skillRoot = path.join(project, ".agents", "skills", "deploy");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, "SKILL.md"), "deploy safely", "utf8");
    await writeFile(path.join(project, "AGENTS.md"), "before", "utf8");
    const manager = await CapabilityWorkspaceManager.create({ workspaceRoot: await temporaryDirectory(), sessionRoot: await temporaryDirectory() });
    const workspace = await manager.materialize("session", [projectBundle(project, skillRoot)]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(path.join(project, "AGENTS.md"), "after", "utf8");
    await waitFor(async () => {
      try {
        return (await readFile(workspace.agentsPath, "utf8")).includes("after");
      } catch {
        return false;
      }
    });
    expect(await readFile(workspace.agentsPath, "utf8")).toContain("after");
    await manager.close();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rook-capability-workspace-test-"));
  tempDirs.push(directory);
  return directory;
}

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for workspace watcher.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function skill(id: string, content = id): { id: string; files: Record<string, string> } {
  return { id, files: { [`${id}/SKILL.md`]: content } };
}

function personalBundle(options: { environmentId?: string; environmentName?: string; skills?: Array<{ id: string; files: Record<string, string> }>; agentsMd?: string } = {}): CapabilityWorkspaceBundle {
  const environmentId = options.environmentId ?? "web:mail.example";
  return {
    environmentName: options.environmentName ?? "Mail",
    bundleName: "Personal capabilities",
    editable: true,
    writeBackSkill: async () => true,
    writeBackNewSkill: async () => true,
    writeBackInstructions: async () => true,
    bundle: {
      id: `${environmentId}#personal`,
      repository: "personal",
      environmentId,
      bundleId: "personal",
      skills: options.skills ?? [],
      mcpServers: [],
      apps: [],
      ...(options.agentsMd ? { agentsMd: options.agentsMd } : {}),
      valid: true,
      errors: [],
    },
  };
}

function projectBundle(project: string, sourcePath: string): CapabilityWorkspaceBundle {
  return {
    environmentName: path.basename(project),
    bundleName: "Personal capabilities",
    editable: true,
    bundle: {
      id: `dir:${project}#directory`,
      repository: "project-directory",
      environmentId: `dir:${project}`,
      bundleId: "directory",
      skills: [{ id: "deploy", sourcePath, files: { "deploy/SKILL.md": "deploy safely" } }],
      mcpServers: [],
      apps: [],
      agentsMd: "project instructions",
      valid: true,
      errors: [],
    },
  };
}
