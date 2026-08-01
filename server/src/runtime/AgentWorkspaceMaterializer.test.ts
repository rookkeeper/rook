// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, stat, rm } from "node:fs/promises";
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
  const skillsRoot = path.join(root, ".agent", "skills");
  const skillDir = path.join(skillsRoot, "gmail-search");
  await chmod(path.join(skillDir, "references"), 0o755).catch(() => undefined);
  await chmod(skillDir, 0o755).catch(() => undefined);
  await chmod(skillsRoot, 0o755).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
