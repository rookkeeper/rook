import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EnvironmentBundle, BundleArtifact } from "../shared/environmentRepository.js";

/** A bundle resolved for one session's runtime workspace. */
export interface AgentWorkspaceBundle {
  environmentName: string;
  bundleName: string;
  editable: boolean;
  bundle: EnvironmentBundle;
}

export interface AgentWorkspaceSkillMapping {
  workspacePath: string;
  sourcePath?: string;
  writable: boolean;
}

export interface AgentWorkspaceResult {
  root: string;
  agentsPath: string;
  agentsContent: string;
  skillsRoot: string;
  skillPaths: string[];
  skillMappings: AgentWorkspaceSkillMapping[];
}

/**
 * Materializes resolved bundle content into the ordinary files expected by an
 * agent runtime. The workspace is deliberately supplied by the caller so the
 * service can later choose a per-session directory without coupling repository
 * storage to runtime paths.
 */
export class AgentWorkspaceMaterializer {
  async materialize(root: string, bundles: AgentWorkspaceBundle[]): Promise<AgentWorkspaceResult> {
    const skillsRoot = path.join(root, ".agent", "skills");
    await rm(skillsRoot, { recursive: true, force: true });
    await mkdir(skillsRoot, { recursive: true });

    const skillPaths: string[] = [];
    const skillMappings: AgentWorkspaceSkillMapping[] = [];
    const seenSkillNames = new Set<string>();
    for (const entry of bundles) {
      for (const skill of entry.bundle.skills) {
        if (seenSkillNames.has(skill.id)) {
          throw new Error(`Multiple entered bundles provide the skill ${skill.id}; skill names must be unique in a runtime workspace.`);
        }
        seenSkillNames.add(skill.id);
        const skillPath = path.join(skillsRoot, skill.id);
        await writeArtifact(skillPath, skill, true);
        if (!entry.editable) await makeReadOnly(skillPath);
        skillPaths.push(skillPath);
        skillMappings.push({ workspacePath: skillPath, sourcePath: skill.sourcePath, writable: entry.editable });
      }
    }

    const agentsPath = path.join(root, "AGENTS.md");
    const agentsContent = renderAgentsFile(bundles);
    await writeFile(agentsPath, agentsContent, "utf8");
    return { root, agentsPath, agentsContent, skillsRoot, skillPaths, skillMappings };
  }

  /** Copies edits from writable, file-backed skill sources back to their source directories. */
  async syncWritableChanges(result: AgentWorkspaceResult): Promise<void> {
    for (const mapping of result.skillMappings) {
      if (!mapping.writable || !mapping.sourcePath) continue;
      await copyDirectory(mapping.workspacePath, mapping.sourcePath);
    }
  }
}

async function copyDirectory(sourceRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) await copyDirectory(source, target);
    else if (entry.isFile()) await writeFile(target, await readFile(source));
  }
}

async function writeArtifact(targetRoot: string, artifact: BundleArtifact, isSkill: boolean): Promise<void> {
  await mkdir(targetRoot, { recursive: true });
  for (const [rawPath, content] of Object.entries(artifact.files)) {
    const relativePath = artifactRelativePath(rawPath, artifact.id, isSkill);
    const target = safeJoin(targetRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

function artifactRelativePath(rawPath: string, artifactId: string, isSkill: boolean): string {
  const normalized = rawPath.replaceAll("\\", "/");
  const prefix = `${artifactId}/`;
  if (isSkill && normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  return normalized;
}

function safeJoin(root: string, relativePath: string): string {
  if (!relativePath || path.posix.isAbsolute(relativePath)) throw new Error(`Invalid materialized artifact path: ${relativePath}`);
  const normalized = path.posix.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new Error(`Materialized artifact path escapes its skill directory: ${relativePath}`);
  }
  return path.join(root, ...normalized.split("/"));
}

async function makeReadOnly(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeReadOnly(child);
    else if (entry.isFile()) await chmod(child, 0o444);
  }
  await chmod(root, 0o555);
  // This is a filesystem policy boundary for now, not a strong sandbox against
  // an agent that can execute arbitrary commands as the same OS user.
}

function renderAgentsFile(bundles: AgentWorkspaceBundle[]): string {
  const blocks = bundles.flatMap((entry) => {
    const content = entry.bundle.agentsMd?.trim();
    if (!content) return [];
    const environmentName = escapeMarkup(entry.environmentName);
    const bundleName = escapeMarkup(entry.bundleName);
    const editable = entry.editable ? ' editable="true"' : "";
    const indented = content.split("\n").map((line) => `      ${line}`).join("\n");
    return [`  <environment name="${environmentName}">

    <bundle name="${bundleName}"${editable}>

      <instructions>
${indented}
      </instructions>

    </bundle>

  </environment>`];
  });

  return `# Rook environment context\n\n${blocks.join("\n\n")}\n`;
}

function escapeMarkup(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
