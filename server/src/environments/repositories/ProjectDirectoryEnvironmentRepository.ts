import { readdir, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { BundleArtifact, EnvironmentBundleResult, EnvironmentRecord, RepositoryReadError } from "../../shared/environmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

/** Reads capabilities already owned by a coding project, without copying ownership into Rook. */
export class ProjectDirectoryEnvironmentRepository extends EnvironmentRepository {
  constructor(readonly repositoryId = "project-directory") {
    super();
  }

  async replaceBundleInstructions(environmentId: string, _bundleId: string, content: string): Promise<boolean> {
    const directory = projectPath(environmentId);
    if (!directory) return false;
    const projectMarker = "# Project instructions";
    const claudeMarker = "# Claude project instructions";
    const claudeIndex = content.indexOf(claudeMarker);
    const projectContent = content.slice(projectMarker.length, claudeIndex === -1 ? content.length : claudeIndex).trim();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(directory, "AGENTS.md"), projectContent ? `${projectContent}\n` : "", "utf8");
    if (claudeIndex !== -1) await writeFile(path.join(directory, "CLAUDE.md"), `${content.slice(claudeIndex + claudeMarker.length).trim()}\n`, "utf8");
    return true;
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const directory = projectPath(environmentId);
    if (!directory || !existsSync(directory) || !statSync(directory).isDirectory()) return { environment: null, bundles: [], errors: [] };

    const errors: RepositoryReadError[] = [];
    const skills = await this.readSkills(directory, errors, environmentId);
    const agents = await readOptionalText(path.join(directory, "AGENTS.md"));
    const claude = await readOptionalText(path.join(directory, "CLAUDE.md"));
    const mcp = await readOptionalText(path.join(directory, ".mcp.json"));
    // AGENTS.md is the project source when present. CLAUDE.md is a fallback
    // source only, never a second instruction layer to concatenate.
    const agentsMd = agents ?? claude;
    const hasContent = skills.length > 0 || Boolean(agentsMd) || Boolean(mcp);
    if (!hasContent) return { environment: environmentRecord(environmentId, directory), bundles: [], errors };

    return {
      environment: environmentRecord(environmentId, directory),
      bundles: [{
        id: `${environmentId}#directory`,
        bundleId: "directory",
        environmentId,
        repository: this.repositoryId,
        bundlePath: directory,
        skills,
        mcpServers: mcp ? [{ id: "project-mcp", files: { ".mcp.json": mcp }, sourcePath: path.join(directory, ".mcp.json") }] : [],
        apps: [],
        agentsMd,
        valid: errors.length === 0,
        errors,
      }],
      errors,
    };
  }

  private async readSkills(directory: string, errors: RepositoryReadError[], environmentId: string): Promise<BundleArtifact[]> {
    const roots = [".agents/skills", ".agent/skills", ".claude/skills", ".codex/skills", ".cursor/skills", ".github/skills"]
      .map((relative) => path.join(directory, relative))
      .filter((candidate) => existsSync(candidate));
    const artifacts: BundleArtifact[] = [];
    for (const root of roots) {
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        errors.push({ code: "unreadable_path", message: String(error), repository: this.repositoryId, environmentId, path: root });
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillPath = path.join(root, entry.name);
        const files: Record<string, string> = {};
        await collectFiles(skillPath, entry.name, files);
        if (!(`${entry.name}/SKILL.md` in files)) {
          errors.push({ code: "invalid_bundle_contents", message: `Skill ${entry.name} is missing SKILL.md`, repository: this.repositoryId, environmentId, path: skillPath });
          continue;
        }
        artifacts.push({ id: entry.name, files, sourcePath: skillPath });
      }
      if (artifacts.length > 0) break;
    }
    return artifacts.sort((a, b) => a.id.localeCompare(b.id));
  }
}

function projectPath(environmentId: string): string | null {
  if (!environmentId.startsWith("dir:/")) return null;
  return path.posix.normalize(environmentId.slice("dir:".length));
}

function environmentRecord(environmentId: string, directory: string): EnvironmentRecord {
  return { id: environmentId, displayName: path.basename(directory) || directory, description: `Project directory ${directory}` };
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  if (!existsSync(filePath)) return undefined;
  return readFile(filePath, "utf8");
}

async function collectFiles(directory: string, prefix: string, files: Record<string, string>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(child, relative, files);
    else if (entry.isFile()) files[relative] = await readFile(child, "utf8");
  }
}
