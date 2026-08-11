import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { BundleArtifact, CapabilityType, EnvironmentBundleResult, EnvironmentRecord, RepositoryReadError } from "../../shared/environmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

/** Reads capabilities already owned by a coding project, without copying ownership into Rook. */
export class ProjectDirectoryEnvironmentRepository extends EnvironmentRepository {
  constructor(readonly repositoryId = "project-directory") {
    super();
  }

  async replaceCapabilityFiles(environmentId: string, _bundleId: string, type: CapabilityType, _capabilityName: string, files: Record<string, string>): Promise<boolean> {
    const directory = projectPath(environmentId);
    if (!directory) return false;
    if (type === "instructions") {
      await writeFile(path.join(directory, "AGENTS.md"), files["AGENTS.md"] ?? Object.values(files)[0] ?? "", "utf8");
      return true;
    }
    // Existing project skills are already direct links to project files. The
    // workspace watcher observes those edits; no repository write-back is needed.
    return false;
  }

  async createCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>): Promise<boolean> {
    const directory = projectPath(environmentId);
    if (!directory || bundleId !== "directory") return false;
    if (type === "instructions") {
      await writeFile(path.join(directory, "AGENTS.md"), files["AGENTS.md"] ?? Object.values(files)[0] ?? "", "utf8");
      return true;
    }
    if (type !== "skill" || !( `${capabilityName}/SKILL.md` in files)) return false;
    const targetRoot = path.join(directory, ".agents", "skills", capabilityName);
    if (existsSync(targetRoot)) return false;
    for (const [rawPath, content] of Object.entries(files)) {
      const relative = projectArtifactPath(rawPath, capabilityName);
      if (!relative) return false;
      const target = path.join(targetRoot, ...relative.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    return true;
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const directory = projectPath(environmentId);
    if (!directory || !existsSync(directory) || !statSync(directory).isDirectory()) return { environment: null, bundles: [], errors: [] };

    const errors: RepositoryReadError[] = [];
    const skills = await this.readSkills(directory, errors, environmentId);
    const agents = await readOptionalText(path.join(directory, "AGENTS.md"));
    // THIS IS FOR BACKWARDS COMPATIBILITY
    // Preserve project instructions authored under the established CLAUDE.md
    // convention when a project has not adopted AGENTS.md yet.
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
    // THIS IS FOR BACKWARDS COMPATIBILITY
    // Preserve skill discovery from the established tool-specific project
    // directories while the standard .agents/skills layout is adopted.
    // All roots are merged; on a name collision the earlier root wins.
    const roots = [".agents/skills", ".claude/skills", ".codex/skills", ".cursor/skills", ".github/skills"]
      .map((relative) => path.join(directory, relative))
      .filter((candidate) => existsSync(candidate));
    const artifactsById = new Map<string, BundleArtifact>();
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
        if (artifactsById.has(entry.name)) continue;
        const skillPath = path.join(root, entry.name);
        if (entry.isSymbolicLink()) {
          // Skill directories are commonly linked from tool-specific roots.
          // A stale link must not make discovery of the whole project fail.
          try {
            if (!(await stat(skillPath)).isDirectory()) continue;
          } catch {
            continue;
          }
        }
        const files: Record<string, string> = {};
        try {
          await collectFiles(skillPath, entry.name, files);
        } catch (error) {
          errors.push({ code: "unreadable_path", message: String(error), repository: this.repositoryId, environmentId, path: skillPath });
          continue;
        }
        if (!(`${entry.name}/SKILL.md` in files)) {
          errors.push({ code: "invalid_bundle_contents", message: `Skill ${entry.name} is missing SKILL.md`, repository: this.repositoryId, environmentId, path: skillPath });
          continue;
        }
        artifactsById.set(entry.name, { id: entry.name, files, sourcePath: skillPath });
      }
    }
    return [...artifactsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

function projectPath(environmentId: string): string | null {
  if (!environmentId.startsWith("dir:/")) return null;
  return path.posix.normalize(environmentId.slice("dir:".length));
}

function environmentRecord(environmentId: string, directory: string): EnvironmentRecord {
  return { id: environmentId, displayName: path.basename(directory) || directory, description: `Project directory ${directory}`, metadata: {} };
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  if (!existsSync(filePath)) return undefined;
  return readFile(filePath, "utf8");
}

function projectArtifactPath(rawPath: string, artifactId: string): string | undefined {
  const normalized = rawPath.replaceAll("\\", "/");
  const relative = normalized.startsWith(`${artifactId}/`) ? normalized.slice(artifactId.length + 1) : normalized;
  if (!relative || path.posix.isAbsolute(relative)) return undefined;
  const safe = path.posix.normalize(relative);
  return safe === ".." || safe.startsWith("../") || safe.includes("\0") ? undefined : safe;
}

async function collectFiles(directory: string, prefix: string, files: Record<string, string>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(child, relative, files);
    else if (entry.isFile()) files[relative] = await readFile(child, "utf8");
  }
}
