import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EnvironmentBundle, BundleArtifact } from "../shared/environmentRepository.js";

/** A bundle resolved for one session's runtime workspace. */
export interface AgentWorkspaceBundle {
  environmentName: string;
  bundleName: string;
  editable: boolean;
  bundle: EnvironmentBundle;
  writeBackSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackInstructions?: (content: string) => Promise<boolean>;
}

export interface AgentWorkspaceSkillMapping {
  workspacePath: string;
  artifactId: string;
  sourcePath?: string;
  writable: boolean;
  writeBack?: (files: Record<string, string>) => Promise<boolean>;
}

export interface AgentWorkspaceResult {
  root: string;
  agentsPath: string;
  agentsContent: string;
  skillsRoot: string;
  skillPaths: string[];
  skillMappings: AgentWorkspaceSkillMapping[];
  instructionMappings: AgentWorkspaceInstructionMapping[];
  mcpPaths: string[];
}

export interface AgentWorkspaceInstructionMapping {
  startMarker: string;
  endMarker: string;
  writable: boolean;
  writeBack?: (content: string) => Promise<boolean>;
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
    const mcpPaths: string[] = [];
    const inlineFacts: InlineFact[] = [];
    const seenSkillNames = new Set<string>();
    const addSkill = async (entry: AgentWorkspaceBundle, skill: BundleArtifact): Promise<void> => {
      if (seenSkillNames.has(skill.id)) {
        throw new Error(`Multiple entered bundles provide the skill ${skill.id}; skill names must be unique in a runtime workspace.`);
      }
      seenSkillNames.add(skill.id);
      const skillPath = path.join(skillsRoot, skill.id);
      await writeArtifact(skillPath, skill, true);
      if (!entry.editable) await makeReadOnly(skillPath);
      skillPaths.push(skillPath);
      skillMappings.push({
        workspacePath: skillPath,
        artifactId: skill.id,
        sourcePath: skill.sourcePath,
        writable: entry.editable,
        ...(entry.writeBackSkill ? { writeBack: (files) => entry.writeBackSkill!(skill.id, files) } : {}),
      });
    };

    for (const entry of bundles) {
      for (const skill of entry.bundle.skills) await addSkill(entry, skill);
      for (const fact of entry.bundle.facts ?? []) {
        const content = artifactText(fact);
        if (content.length <= 4000) inlineFacts.push({ environmentName: entry.environmentName, bundleName: entry.bundleName, name: fact.id, content });
        else await addSkill(entry, generatedReferenceSkill(`fact-${safeName(fact.id)}`, fact.id, content));
      }
      if (entry.bundle.llmsTxt !== undefined) {
        await addSkill(entry, generatedReferenceSkill(`llms-${safeName(entry.bundleName)}`, "llms.txt", entry.bundle.llmsTxt));
      }
      for (const server of entry.bundle.mcpServers) {
        const mcpPath = path.join(root, ".agent", "mcp-servers", safeName(server.id));
        await writeArtifact(mcpPath, server, false);
        if (!entry.editable) await makeReadOnly(mcpPath);
        mcpPaths.push(mcpPath);
      }
    }

    const agentsPath = path.join(root, "AGENTS.md");
    const renderedInstructions = renderAgentsFile(bundles, inlineFacts);
    await writeFile(agentsPath, renderedInstructions.content, "utf8");
    return { root, agentsPath, agentsContent: renderedInstructions.content, skillsRoot, skillPaths, skillMappings, instructionMappings: renderedInstructions.mappings, mcpPaths };
  }

  /** Copies edits from writable, file-backed skill sources back to their source directories. */
  async syncWritableChanges(result: AgentWorkspaceResult): Promise<void> {
    for (const mapping of result.skillMappings) {
      if (!mapping.writable) continue;
      let files: Record<string, string>;
      try {
        files = await readWorkspaceFiles(mapping.workspacePath, mapping.artifactId);
      } catch (error) {
        if (isMissingPath(error)) continue;
        throw error;
      }
      const handled = mapping.writeBack ? await mapping.writeBack(files) : false;
      if (!handled && mapping.sourcePath) await copyDirectory(mapping.workspacePath, mapping.sourcePath);
    }

    if (result.instructionMappings.length === 0) return;
    let instructions: string;
    try {
      instructions = await readFile(result.agentsPath, "utf8");
    } catch (error) {
      if (isMissingPath(error)) return;
      throw error;
    }
    for (const mapping of result.instructionMappings) {
      if (!mapping.writable || !mapping.writeBack) continue;
      const start = instructions.indexOf(mapping.startMarker);
      const end = instructions.indexOf(mapping.endMarker, start + mapping.startMarker.length);
      const content = start !== -1 && end !== -1
        ? instructions.slice(start + mapping.startMarker.length, end).trim()
        : result.instructionMappings.length === 1 ? instructions.trim() : undefined;
      if (content === undefined) continue;
      await mapping.writeBack(content);
    }
  }
}

async function readWorkspaceFiles(root: string, artifactId: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child, relative);
      else if (entry.isFile()) files[`${artifactId}/${relative}`] = await readFile(child, "utf8");
    }
  }
  await walk(root, "");
  return files;
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

interface InlineFact {
  environmentName: string;
  bundleName: string;
  name: string;
  content: string;
}

function artifactText(artifact: BundleArtifact): string {
  return Object.values(artifact.files).join("\n\n");
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
}

function generatedReferenceSkill(id: string, sourceName: string, content: string): BundleArtifact {
  return {
    id,
    files: {
      [`${id}/SKILL.md`]: `---\nname: ${id}\ndescription: Reference material from ${sourceName}.\n---\n\n# ${sourceName}\n\n${content}`,
    },
  };
}

function renderAgentsFile(bundles: AgentWorkspaceBundle[], inlineFacts: InlineFact[]): { content: string; mappings: AgentWorkspaceInstructionMapping[] } {
  const mappings: AgentWorkspaceInstructionMapping[] = [];
  const blocks = bundles.flatMap((entry) => {
    const content = entry.bundle.agentsMd?.trim();
    if (!content) return [];
    const environmentName = escapeMarkup(entry.environmentName);
    const bundleName = escapeMarkup(entry.bundleName);
    const editable = entry.editable ? ' editable="true"' : "";
    const indented = content.split("\n").map((line) => `      ${line}`).join("\n");
    const block = `  <environment name="${environmentName}">

    <bundle name="${bundleName}"${editable}>

      <instructions>
${indented}
      </instructions>

    </bundle>

  </environment>`;
    if (entry.editable && entry.writeBackInstructions) {
      const markerNumber = mappings.length + 1;
      const startMarker = `<!-- BEGIN ROOK PERSONAL INSTRUCTIONS ${markerNumber} -->`;
      const endMarker = `<!-- END ROOK PERSONAL INSTRUCTIONS ${markerNumber} -->`;
      mappings.push({ startMarker, endMarker, writable: true, writeBack: entry.writeBackInstructions });
      return [`${startMarker}\n${block}\n${endMarker}`];
    }
    return [block];
  });
  const factBlocks = inlineFacts.map((fact) => `  <environment name="${escapeMarkup(fact.environmentName)}">

    <bundle name="${escapeMarkup(fact.bundleName)}">

      <facts name="${escapeMarkup(fact.name)}">
${fact.content.split("\n").map((line) => `        ${line}`).join("\n")}
      </facts>

    </bundle>

  </environment>`);

  return { content: `# Rook environment context\n\n${[...blocks, ...factBlocks].join("\n\n")}\n`, mappings };
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function escapeMarkup(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
