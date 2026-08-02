// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentWorkspaceMaterializer } from "./AgentWorkspaceMaterializer.js";
import type { EnvironmentBundle } from "../shared/environmentRepository.js";

function bundle(overrides: Partial<EnvironmentBundle> = {}): EnvironmentBundle {
  return {
    id: "web:example.com#gmail",
    bundleId: "gmail",
    environmentId: "web:example.com",
    repository: "test",
    valid: true,
    errors: [],
    skills: [{ id: "gmail-search", files: {
      "gmail-search/SKILL.md": "---\nname: gmail-search\ndescription: Search Gmail.\n---\n\nUse Gmail search.",
      "gmail-search/references/query.md": "from:example@example.com",
    } }],
    mcpServers: [],
    apps: [],
    agentsMd: "Confirm before sending email.",
    ...overrides,
  };
}

describe("AgentWorkspaceMaterializer", () => {
  it("materializes skills and attributed instructions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-agent-workspace-"));
    try {
      const result = await new AgentWorkspaceMaterializer().materialize(root, [{
        environmentName: "Gmail",
        bundleName: "Gmail workflows",
        editable: false,
        bundle: bundle(),
      }]);

      expect(result.skillPaths).toEqual([path.join(root, ".agent", "skills", "gmail-search")]);
      expect(await readFile(path.join(root, ".agent", "skills", "gmail-search", "SKILL.md"), "utf8")).toContain("Use Gmail search.");
      expect(await readFile(path.join(root, ".agent", "skills", "gmail-search", "references", "query.md"), "utf8")).toBe("from:example@example.com");
      const agents = await readFile(result.agentsPath, "utf8");
      expect(agents).toContain('<environment name="Gmail">');
      expect(agents).toContain('<bundle name="Gmail workflows">');
      expect(agents).toContain("Confirm before sending email.");
      expect(agents).not.toContain("web:example.com");
    } finally {
      await cleanup(root);
    }
  });

  it("writes edits from writable file-backed skills back to their source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-agent-workspace-"));
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "rook-agent-source-"));
    const sourceSkill = path.join(sourceRoot, "personal-skill");
    await mkdir(sourceSkill, { recursive: true });
    await writeFile(path.join(sourceSkill, "SKILL.md"), "old source", "utf8");
    try {
      const sourceBundle = bundle({ skills: [{ id: "personal-skill", sourcePath: sourceSkill, files: { "personal-skill/SKILL.md": "old source" } }] });
      const materializer = new AgentWorkspaceMaterializer();
      const result = await materializer.materialize(root, [{ environmentName: "Gmail", bundleName: "Personal", editable: true, bundle: sourceBundle }]);
      await writeFile(path.join(root, ".agent", "skills", "personal-skill", "SKILL.md"), "new source", "utf8");
      await materializer.syncWritableChanges(result);
      expect(await readFile(path.join(sourceSkill, "SKILL.md"), "utf8")).toBe("new source");
    } finally {
      await cleanup(root);
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("writes a newly created personal skill back to its bundle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-agent-workspace-"));
    const writes: Array<{ id: string; files: Record<string, string> }> = [];
    try {
      const result = await new AgentWorkspaceMaterializer().materialize(root, [{
        environmentName: "XKCD",
        bundleName: "Personal",
        editable: true,
        bundle: bundle({ skills: [], agentsMd: undefined }),
        writeBackNewSkill: async (id, files) => {
          writes.push({ id, files });
          return true;
        },
        writeBackInstructions: async () => true,
      }]);
      const skillRoot = path.join(root, ".agent", "skills", "navigating-xkcd");
      await mkdir(skillRoot, { recursive: true });
      await writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: navigating-xkcd\ndescription: Navigate XKCD.\n---\n", "utf8");
      await new AgentWorkspaceMaterializer().syncWritableChanges(result);

      expect(writes).toEqual([{
        id: "navigating-xkcd",
        files: { "navigating-xkcd/SKILL.md": "---\nname: navigating-xkcd\ndescription: Navigate XKCD.\n---\n" },
      }]);
      expect(result.agentsContent).toContain("BEGIN ROOK PERSONAL INSTRUCTIONS");
    } finally {
      await cleanup(root);
    }
  });

  it("materializes facts, llms.txt, and MCP content by type", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-agent-workspace-"));
    try {
      const result = await new AgentWorkspaceMaterializer().materialize(root, [{
        environmentName: "Gmail",
        bundleName: "Environment capabilities",
        editable: false,
        bundle: bundle({
          facts: [{ id: "timezone", files: { "timezone.txt": "The user is in Eastern Time." } }],
          llmsTxt: "# Gmail docs\n\nUse Gmail search.",
          mcpServers: [{ id: "gmail-tools", files: { "config.json": '{"server":"gmail"}' } }],
        }),
      }]);
      const agents = await readFile(result.agentsPath, "utf8");
      expect(agents).toContain("The user is in Eastern Time.");
      expect(await readFile(path.join(root, ".agent", "skills", "llms-environment-capabilities", "SKILL.md"), "utf8")).toContain("Use Gmail search.");
      expect(await readFile(path.join(root, ".agent", "mcp-servers", "gmail-tools", "config.json"), "utf8")).toContain("gmail");
      expect(result.mcpPaths).toHaveLength(1);
    } finally {
      await cleanup(root);
    }
  });

  it("marks externally sourced skill files read-only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-agent-workspace-"));
    try {
      await new AgentWorkspaceMaterializer().materialize(root, [{
        environmentName: "Gmail",
        bundleName: "Gmail workflows",
        editable: false,
        bundle: bundle(),
      }]);
      const file = await stat(path.join(root, ".agent", "skills", "gmail-search", "SKILL.md"));
      expect(file.mode & 0o222).toBe(0);
    } finally {
      await cleanup(root);
    }
  });

  it("rejects duplicate skill names across bundles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rook-agent-workspace-"));
    try {
      const materializer = new AgentWorkspaceMaterializer();
      await expect(materializer.materialize(root, [
        { environmentName: "A", bundleName: "one", editable: false, bundle: bundle() },
        { environmentName: "B", bundleName: "two", editable: false, bundle: bundle({ id: "web:b#two", environmentId: "web:b" }) },
      ])).rejects.toThrow("skill gmail-search");
    } finally {
      await cleanup(root);
    }
  });
});

async function cleanup(root: string): Promise<void> {
  await makeWritable(root);
  await rm(root, { recursive: true, force: true });
}

async function makeWritable(directory: string): Promise<void> {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await chmod(child, 0o755).catch(() => undefined);
      await makeWritable(child);
    } else {
      await chmod(child, 0o644).catch(() => undefined);
    }
  }
  await chmod(directory, 0o755).catch(() => undefined);
}
