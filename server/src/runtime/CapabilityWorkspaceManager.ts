import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EnvironmentBundle, BundleArtifact } from "../shared/environmentRepository.js";

/** A bundle resolved for an agent workspace. */
export interface CapabilityWorkspaceBundle {
  environmentName: string;
  bundleName: string;
  editable: boolean;
  bundle: EnvironmentBundle;
  writeBackSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackNewSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackInstructions?: (content: string) => Promise<boolean>;
}

export interface CapabilityWorkspaceResult {
  root: string;
  agentsPath: string;
  skillsRoot: string;
  editableSkillsRoot: string;
  instructionSourcesRoot: string;
  mcpRoot: string;
  skillPaths: string[];
}

type SourceKind = "skill" | "instructions" | "authoring-slot";

const DEFAULT_EMPTY_INSTRUCTIONS = "No user-authored instructions have been added for this environment yet. You may edit this file upon the user's request to save simple instructions or reminders. Complex instructions and processes belong in the skill files for this environment.";

type AggregateSource = { nickname: string; sourcePath: string; writable: boolean };
type AggregateFact = { nickname: string; environmentName: string; bundleName: string; name: string; content: string };

interface SessionAggregateData {
  root: string;
  sources: AggregateSource[];
  facts: AggregateFact[];
  skillNamesByEnvironment: Map<string, Set<string>>;
}

interface WorkspaceSource {
  key: string;
  kind: SourceKind;
  repository: string;
  environmentId: string;
  bundleId: string;
  artifactId?: string;
  mutable: boolean;
  path: string;
  lastFingerprint: string;
  knownSkillIds?: Set<string>;
  writeBackSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackNewSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackInstructions?: (content: string) => Promise<boolean>;
}

/**
 * Owns the process-wide materialization of writable SQLite content and the
 * disposable agent workspaces that link to it. The global workspace is cleared
 * at startup and retained at shutdown for inspection; SQLite and project
 * directories remain the durable sources of truth.
 */
export class CapabilityWorkspaceManager {
  private readonly sources = new Map<string, WorkspaceSource>();
  private readonly workspaceRoot: string;
  private readonly projectStagingRoot: string;
  private readonly sessionRoot: string;
  private readonly sessionBundles = new Map<string, CapabilityWorkspaceBundle[]>();
  private readonly sessionAggregateData = new Map<string, SessionAggregateData>();
  private readonly projectWatchers = new Map<string, FSWatcher>();
  private globalWatcher: FSWatcher | undefined;
  private projectStagingWatcher: FSWatcher | undefined;
  private globalDebounce: ReturnType<typeof setTimeout> | undefined;
  private projectDebounce: ReturnType<typeof setTimeout> | undefined;
  private watcherError: Error | undefined;

  private constructor(workspaceRoot: string, projectStagingRoot: string, sessionRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.projectStagingRoot = projectStagingRoot;
    this.sessionRoot = sessionRoot;
  }

  static async create(options: { workspaceRoot?: string; sessionRoot?: string } = {}): Promise<CapabilityWorkspaceManager> {
    const workspaceRoot = options.workspaceRoot ?? path.join(os.homedir(), ".rook", "global-workspace");
    const sessionRoot = options.sessionRoot ?? path.join(os.homedir(), ".rook", "agent-workspaces");
    const projectStagingRoot = await mkdtemp(path.join(os.tmpdir(), "rook-project-authoring-"));
    await clearDirectory(workspaceRoot);
    await mkdir(sessionRoot, { recursive: true });
    const manager = new CapabilityWorkspaceManager(workspaceRoot, projectStagingRoot, sessionRoot);
    await manager.writeManifest();
    manager.startGlobalWatcher();
    return manager;
  }

  globalRoot(): string {
    return this.workspaceRoot;
  }

  agentWorkspaceRoot(sessionId: string): string {
    return safeChild(this.sessionRoot, sessionId);
  }

  /** Rebuilds one disposable session projection without replacing shared sources. */
  async materialize(sessionId: string, bundles: CapabilityWorkspaceBundle[]): Promise<CapabilityWorkspaceResult> {
    const root = this.agentWorkspaceRoot(sessionId);
    const skillsRoot = path.join(root, ".agents", "skills");
    const editableSkillsRoot = path.join(root, ".agents", "editable-skills");
    const instructionSourcesRoot = path.join(root, ".agents", "AGENTS_FILES");
    const mcpRoot = path.join(root, ".agents", "mcp-servers");
    const agentsPath = path.join(root, "AGENTS.md");
    await mkdir(root, { recursive: true });
    await Promise.all([
      removeTree(skillsRoot),
      removeTree(editableSkillsRoot),
      removeTree(instructionSourcesRoot),
      removeTree(mcpRoot),
      removeTree(agentsPath),
    ]);
    await Promise.all([
      mkdir(skillsRoot, { recursive: true }),
      mkdir(editableSkillsRoot, { recursive: true }),
      mkdir(instructionSourcesRoot, { recursive: true }),
      mkdir(mcpRoot, { recursive: true }),
    ]);

    this.sessionBundles.set(sessionId, bundles);
    const nicknames = environmentNicknames(bundles);
    const usedSkillNames = new Set<string>();
    const skillPaths: string[] = [];
    const inlineFacts: AggregateFact[] = [];
    const agentInstructionSources: AggregateSource[] = [];
    const skillNamesByEnvironment = new Map<string, Set<string>>();

    for (const entry of bundles) {
      if (entry.bundle.repository === "project-directory") this.watchProject(projectDirectory(entry.bundle.environmentId));
      const environmentId = entry.bundle.environmentId;
      const nickname = nicknames.get(environmentId)!;
      const skillNames = skillNamesByEnvironment.get(nickname) ?? new Set<string>();
      skillNamesByEnvironment.set(nickname, skillNames);
      const authoringRoot = await this.ensureAuthoringRoot(entry);
      await replaceWithSymlink(path.join(editableSkillsRoot, nickname), authoringRoot);

      for (const skill of entry.bundle.skills) {
        const visibleName = uniqueSkillName(skill.id, usedSkillNames);
        const workspacePath = path.join(skillsRoot, visibleName);
        if (!entry.editable && entry.bundle.repository !== "project-directory") {
          await writeArtifact(workspacePath, skill);
          await makeReadOnly(workspacePath);
        } else {
          const target = await this.skillSource(entry, skill);
          await replaceWithSymlink(workspacePath, target);
        }
        skillNames.add(skill.id);
        skillPaths.push(workspacePath);
      }

      for (const fact of entry.bundle.facts ?? []) {
        const content = artifactText(fact);
        if (content.length <= 4000) {
          inlineFacts.push({ nickname, environmentName: entry.environmentName, bundleName: entry.bundleName, name: fact.id, content });
        } else {
          const derived = generatedReferenceSkill(`fact-${safeName(fact.id)}`, fact.id, content);
          skillNames.add(derived.id);
          await materializeDerivedSkill(skillsRoot, derived, usedSkillNames, skillPaths);
        }
      }
      if (entry.bundle.llmsTxt !== undefined) {
        const derived = generatedReferenceSkill(`llms-${safeName(entry.bundleName)}`, "llms.txt", entry.bundle.llmsTxt);
        skillNames.add(derived.id);
        await materializeDerivedSkill(skillsRoot, derived, usedSkillNames, skillPaths);
      }
      for (const server of entry.bundle.mcpServers) {
        const target = path.join(mcpRoot, safeName(server.id));
        await writeArtifact(target, server);
        await makeReadOnly(target);
      }

      const agentsSourcePath = path.join(instructionSourcesRoot, nickname, "AGENTS.md");
      await mkdir(path.dirname(agentsSourcePath), { recursive: true });
      if (!entry.editable && entry.bundle.repository !== "project-directory") {
        await materializeReadOnlyFile(agentsSourcePath, entry.bundle.agentsMd ?? "");
        agentInstructionSources.push({ nickname, sourcePath: path.relative(root, agentsSourcePath), writable: false });
      } else {
        const instructionSource = await this.instructionSource(entry);
        await replaceWithSymlink(agentsSourcePath, instructionSource.path);
        agentInstructionSources.push({ nickname, sourcePath: path.relative(root, agentsSourcePath), writable: true });
      }
    }

    this.sessionAggregateData.set(sessionId, {
      root,
      sources: agentInstructionSources,
      facts: inlineFacts,
      skillNamesByEnvironment,
    });
    await writeFile(agentsPath, await renderAggregateAgents(root, agentInstructionSources, inlineFacts, skillNamesByEnvironment), "utf8");
    await chmod(agentsPath, 0o444);
    await this.writeManifest();
    return { root, agentsPath, skillsRoot, editableSkillsRoot, instructionSourcesRoot, mcpRoot, skillPaths };
  }

  /** Removes only a session projection. Shared global sources remain live. */
  async removeSession(sessionId: string): Promise<void> {
    this.sessionBundles.delete(sessionId);
    this.sessionAggregateData.delete(sessionId);
    await removeTree(this.agentWorkspaceRoot(sessionId));
  }

  /**
   * Persist settled changes from shared writable sources. This is deliberately
   * source-based: no session workspace is read or copied back into storage.
   */
  async assessAndFlush(): Promise<void> {
    const failures: Error[] = [];
    for (const source of this.sources.values()) {
      const fingerprint = await sourceFingerprint(source);
      if (fingerprint === source.lastFingerprint) continue;
      try {
        await this.persistSource(source);
        source.lastFingerprint = fingerprint;
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    await this.writeManifest();
    if (failures.length > 0) throw new AggregateError(failures, "Unable to persist one or more capability workspace changes.");
  }

  async close(): Promise<void> {
    if (this.globalDebounce) clearTimeout(this.globalDebounce);
    if (this.projectDebounce) clearTimeout(this.projectDebounce);
    this.globalWatcher?.close();
    this.projectStagingWatcher?.close();
    for (const watcher of this.projectWatchers.values()) watcher.close();
    this.projectWatchers.clear();
    await this.assessAndFlush();
    await Promise.all([...this.sessionBundles.keys()].map((sessionId) => this.removeSession(sessionId)));
    // Keep the global workspace available for inspection. It is cleared before
    // the next server startup, before any source is materialized.
    await removeTree(this.projectStagingRoot);
  }

  private startGlobalWatcher(): void {
    try {
      this.globalWatcher = watch(this.workspaceRoot, { recursive: true }, (_event, filename) => {
        if (filename?.toString() === "manifest.json") return;
        this.scheduleGlobalAssessment();
      });
      this.globalWatcher.on("error", (error) => { this.watcherError = error; });
      this.globalWatcher.unref();
      this.projectStagingWatcher = watch(this.projectStagingRoot, { recursive: true }, () => this.scheduleGlobalAssessment());
      this.projectStagingWatcher.on("error", (error) => { this.watcherError = error; });
      this.projectStagingWatcher.unref();
    } catch (error) {
      this.watcherError = error instanceof Error ? error : new Error(String(error));
    }
  }

  private watchProject(directory: string | undefined): void {
    if (!directory || this.projectWatchers.has(directory)) return;
    try {
      const watcher = watch(directory, { recursive: true }, () => this.scheduleProjectReconciliation());
      watcher.on("error", (error) => { this.watcherError = error; });
      watcher.unref();
      this.projectWatchers.set(directory, watcher);
    } catch (error) {
      this.watcherError = error instanceof Error ? error : new Error(String(error));
    }
  }

  private scheduleGlobalAssessment(): void {
    if (this.globalDebounce) clearTimeout(this.globalDebounce);
    this.globalDebounce = setTimeout(() => {
      this.globalDebounce = undefined;
      void this.assessAndFlush().catch((error) => { this.watcherError = error instanceof Error ? error : new Error(String(error)); });
    }, 75);
    this.globalDebounce.unref?.();
  }

  private scheduleProjectReconciliation(): void {
    if (this.projectDebounce) clearTimeout(this.projectDebounce);
    this.projectDebounce = setTimeout(() => {
      this.projectDebounce = undefined;
      void this.reconcileProjectSessions().catch((error) => { this.watcherError = error instanceof Error ? error : new Error(String(error)); });
    }, 75);
    this.projectDebounce.unref?.();
  }

  private async reconcileProjectSessions(): Promise<void> {
    for (const [sessionId, bundles] of this.sessionBundles) {
      if (!bundles.some((entry) => entry.bundle.repository === "project-directory")) continue;
      await this.materialize(sessionId, bundles);
    }
  }

  private async skillSource(entry: CapabilityWorkspaceBundle, skill: BundleArtifact): Promise<string> {
    if (entry.bundle.repository === "project-directory") {
      if (!skill.sourcePath) throw new Error(`Project skill ${skill.id} is missing its direct source path.`);
      return skill.sourcePath;
    }
    if (!entry.editable) throw new Error(`Immutable skill ${skill.id} must be materialized directly into its agent workspace.`);

    const source = await this.ensureWritableSource(entry, "skill", skill.id, async (target) => writeArtifact(target, skill));
    const authoringRoot = await this.ensureAuthoringRoot(entry);
    await replaceWithSymlink(path.join(authoringRoot, skill.id), source.path);
    const authoringSource = this.sources.get(sourceDigest(sourceDescriptor(entry, "authoring-slot")));
    authoringSource?.knownSkillIds?.add(skill.id);
    return source.path;
  }

  private async instructionSource(entry: CapabilityWorkspaceBundle): Promise<{ path: string; writable: boolean }> {
    if (entry.bundle.repository === "project-directory") {
      const directory = projectDirectory(entry.bundle.environmentId);
      if (!directory) throw new Error(`Project environment ${entry.bundle.environmentId} has no project directory.`);
      const agentsPath = path.join(directory, "AGENTS.md");
      const claudePath = path.join(directory, "CLAUDE.md");
      if (await pathExists(agentsPath)) return { path: agentsPath, writable: true };
      if (await pathExists(claudePath)) return { path: claudePath, writable: true };
      // A project AGENTS.md is created only when its empty temporary source is
      // first promoted by the project watcher. Until then this is disposable.
      const temporary = await this.ensureProjectStagingSource(entry, "instructions", async (target) => writeFile(target, DEFAULT_EMPTY_INSTRUCTIONS, "utf8"));
      return { path: temporary.path, writable: true };
    }

    if (entry.editable) {
      const source = await this.ensureWritableSource(entry, "instructions", undefined, async (target) => writeFile(target, writableInstructionsContent(entry.bundle.agentsMd), "utf8"));
      return { path: source.path, writable: true };
    }

    throw new Error("Immutable instructions must be materialized directly into the agent workspace.");
  }

  private async ensureAuthoringRoot(entry: CapabilityWorkspaceBundle): Promise<string> {
    if (entry.bundle.repository === "project-directory") {
      const directory = projectDirectory(entry.bundle.environmentId);
      if (!directory) throw new Error(`Project environment ${entry.bundle.environmentId} has no project directory.`);
      const skillsPath = path.join(directory, ".agents", "skills");
      if (await pathExists(skillsPath)) return skillsPath;
      // Do not create project-owned directories merely by entering an environment.
      // The project watcher will promote this separate temporary slot on first SKILL.md.
      const staging = await this.ensureProjectStagingSource(entry, "authoring-slot", async (target) => mkdir(target, { recursive: true }));
      return staging.path;
    }
    const source = await this.ensureWritableSource(entry, "authoring-slot", undefined, async (target) => mkdir(target, { recursive: true }));
    return source.path;
  }

  private async ensureProjectStagingSource(
    entry: CapabilityWorkspaceBundle,
    kind: "instructions" | "authoring-slot",
    initialize: (target: string) => Promise<void>,
  ): Promise<WorkspaceSource> {
    const key = sourceDigest(sourceDescriptor(entry, kind));
    const existing = this.sources.get(key);
    if (existing) return existing;
    const leaf = kind === "instructions" ? "AGENTS.md" : "skills";
    const target = safeChild(this.projectStagingRoot, key, leaf);
    await mkdir(path.dirname(target), { recursive: true });
    await initialize(target);
    const source: WorkspaceSource = {
      key,
      kind,
      repository: entry.bundle.repository,
      environmentId: entry.bundle.environmentId,
      bundleId: entry.bundle.bundleId,
      mutable: true,
      path: target,
      lastFingerprint: "",
      ...(kind === "authoring-slot" ? { knownSkillIds: new Set<string>() } : {}),
      ...(entry.writeBackNewSkill ? { writeBackNewSkill: entry.writeBackNewSkill } : {}),
      ...(entry.writeBackInstructions ? { writeBackInstructions: entry.writeBackInstructions } : {}),
    };
    source.lastFingerprint = await sourceFingerprint(source);
    this.sources.set(key, source);
    return source;
  }

  private async ensureWritableSource(
    entry: CapabilityWorkspaceBundle,
    kind: SourceKind,
    artifactId: string | undefined,
    initialize: (target: string) => Promise<void>,
  ): Promise<WorkspaceSource> {
    const descriptor = sourceDescriptor(entry, kind, artifactId);
    const key = sourceDigest(descriptor);
    const existing = this.sources.get(key);
    if (existing) return existing;
    const leaf = kind === "skill" ? "skill" : kind === "instructions" ? "AGENTS.md" : "skills";
    const target = safeChild(this.workspaceRoot, "writable", key, leaf);
    await mkdir(path.dirname(target), { recursive: true });
    await initialize(target);
    const source: WorkspaceSource = {
      key,
      kind,
      repository: entry.bundle.repository,
      environmentId: entry.bundle.environmentId,
      bundleId: entry.bundle.bundleId,
      ...(artifactId ? { artifactId } : {}),
      mutable: true,
      path: target,
      lastFingerprint: "",
      ...(kind === "authoring-slot" ? { knownSkillIds: new Set<string>() } : {}),
      ...(entry.writeBackSkill ? { writeBackSkill: entry.writeBackSkill } : {}),
      ...(entry.writeBackNewSkill ? { writeBackNewSkill: entry.writeBackNewSkill } : {}),
      ...(entry.writeBackInstructions ? { writeBackInstructions: entry.writeBackInstructions } : {}),
    };
    source.lastFingerprint = await sourceFingerprint(source);
    this.sources.set(key, source);
    return source;
  }

  private async persistSource(source: WorkspaceSource): Promise<void> {
    if (source.kind === "skill") {
      if (!source.artifactId || !source.writeBackSkill) throw new Error(`No skill write-back is configured for ${source.key}.`);
      const handled = await source.writeBackSkill(source.artifactId, await readSkillFiles(source.path, source.artifactId));
      if (!handled) throw new Error(`Skill write-back declined for ${source.key}.`);
      return;
    }
    if (source.kind === "instructions") {
      if (!source.writeBackInstructions) throw new Error(`No instruction write-back is configured for ${source.key}.`);
      const handled = await source.writeBackInstructions(await readFile(source.path, "utf8"));
      if (!handled) throw new Error(`Instruction write-back declined for ${source.key}.`);
      await this.refreshInstructionSessions(source);
      return;
    }
    if (!source.writeBackNewSkill) return;
    for (const skillId of await skillDirectories(source.path)) {
      if (source.knownSkillIds?.has(skillId)) continue;
      const files = await readSkillFiles(path.join(source.path, skillId), skillId);
      if (!(`${skillId}/SKILL.md` in files)) continue;
      const handled = await source.writeBackNewSkill(skillId, files);
      if (!handled) throw new Error(`New-skill write-back declined for ${source.key}/${skillId}.`);
      source.knownSkillIds?.add(skillId);
      await this.linkPromotedSkill(source, skillId);
    }
  }

  private async refreshInstructionSessions(source: WorkspaceSource): Promise<void> {
    for (const [sessionId, bundles] of this.sessionBundles) {
      if (!bundles.some((entry) => sameSource(entry, source))) continue;
      await this.materialize(sessionId, bundles);
    }
  }

  private async linkPromotedSkill(source: WorkspaceSource, skillId: string): Promise<void> {
    const sourcePath = source.repository === "project-directory"
      ? path.join(projectDirectory(source.environmentId)!, ".agents", "skills", skillId)
      : path.join(source.path, skillId);
    for (const [sessionId, bundles] of this.sessionBundles) {
      const matchingBundle = bundles.find((entry) => sameSource(entry, source));
      if (!matchingBundle) continue;
      const root = this.agentWorkspaceRoot(sessionId);
      const nickname = environmentNicknames(bundles).get(source.environmentId)!;
      if (source.repository === "project-directory") {
        await replaceWithSymlink(path.join(root, ".agents", "editable-skills", nickname), path.dirname(sourcePath));
      }
      const skillsRoot = path.join(root, ".agents", "skills");
      const visibleName = await nextVisibleSkillName(skillsRoot, skillId);
      await replaceWithSymlink(path.join(skillsRoot, visibleName), sourcePath);
      const aggregate = this.sessionAggregateData.get(sessionId);
      if (aggregate) {
        const skillNames = aggregate.skillNamesByEnvironment.get(nickname) ?? new Set<string>();
        skillNames.add(skillId);
        aggregate.skillNamesByEnvironment.set(nickname, skillNames);
        const aggregatePath = path.join(root, "AGENTS.md");
        await chmod(aggregatePath, 0o644);
        await writeFile(
          aggregatePath,
          await renderAggregateAgents(aggregate.root, aggregate.sources, aggregate.facts, aggregate.skillNamesByEnvironment),
          "utf8",
        );
        await chmod(aggregatePath, 0o444);
      }
    }
  }

  private async writeManifest(): Promise<void> {
    const manifest = [...this.sources.values()]
      .filter((source) => source.path === this.workspaceRoot || source.path.startsWith(`${this.workspaceRoot}${path.sep}`))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ key, kind, repository, environmentId, bundleId, artifactId, mutable, path: sourcePath }) => ({
        key,
        kind,
        repository,
        environmentId,
        bundleId,
        ...(artifactId ? { artifactId } : {}),
        mutable,
        path: path.relative(this.workspaceRoot, sourcePath),
      }));
    await writeFile(path.join(this.workspaceRoot, "manifest.json"), `${JSON.stringify({ version: 1, sources: manifest }, null, 2)}\n`, "utf8");
  }
}

function sameSource(entry: CapabilityWorkspaceBundle, source: WorkspaceSource): boolean {
  return entry.bundle.repository === source.repository
    && entry.bundle.environmentId === source.environmentId
    && entry.bundle.bundleId === source.bundleId;
}

async function nextVisibleSkillName(skillsRoot: string, skillId: string): Promise<string> {
  const existing = new Set((await readdir(skillsRoot, { withFileTypes: true })).map((entry) => entry.name));
  let name = skillId;
  for (let number = 2; existing.has(name); number += 1) name = `${skillId}_${number}`;
  return name;
}

function sourceDescriptor(entry: CapabilityWorkspaceBundle, kind: SourceKind, artifactId?: string): Record<string, string | undefined> {
  return {
    repository: entry.bundle.repository,
    environmentId: entry.bundle.environmentId,
    bundleId: entry.bundle.bundleId,
    kind,
    artifactId,
  };
}

function sourceDigest(descriptor: Record<string, string | undefined>): string {
  return createHash("sha256").update(JSON.stringify(descriptor)).digest("base64url");
}

function environmentNicknames(bundles: CapabilityWorkspaceBundle[]): Map<string, string> {
  const byId = new Map<string, string>();
  const names = [...new Map(bundles.map((entry) => [entry.bundle.environmentId, entry.environmentName])).entries()]
    .sort(([idA], [idB]) => idA.localeCompare(idB));
  const used = new Set<string>();
  for (const [environmentId, environmentName] of names) {
    const base = pathSafeName(environmentName);
    let nickname = base;
    for (let number = 2; used.has(nickname); number += 1) nickname = `${base}_${number}`;
    used.add(nickname);
    byId.set(environmentId, nickname);
  }
  return byId;
}

function uniqueSkillName(skillId: string, used: Set<string>): string {
  let visibleName = skillId;
  for (let number = 2; used.has(visibleName); number += 1) visibleName = `${skillId}_${number}`;
  used.add(visibleName);
  return visibleName;
}

async function renderAggregateAgents(
  root: string,
  sources: AggregateSource[],
  inlineFacts: AggregateFact[],
  skillNamesByEnvironment: Map<string, Set<string>>,
): Promise<string> {
  const blocks = await Promise.all(sources.map(async (source) => {
    const absoluteSource = path.join(root, source.sourcePath);
    const content = await readFile(absoluteSource, "utf8");
    const editable = source.writable ? "true" : "false";
    const pathAttribute = source.writable ? ` path="${escapeAttribute(source.sourcePath)}"` : "";
    return `<environment_instruction environment="${escapeAttribute(source.nickname)}" editable="${editable}"${pathAttribute}>\n${content.trim()}\n</environment_instruction>`;
  }));
  const factBlocks = inlineFacts.map((fact) => `<environment_instruction environment="${escapeAttribute(fact.nickname)}" editable="false">\n${fact.name}: ${fact.content.trim()}\n</environment_instruction>`);
  const environmentNames = [...new Set([
    ...sources.map((source) => source.nickname),
    ...skillNamesByEnvironment.keys(),
  ])].sort((a, b) => a.localeCompare(b));
  const locations = environmentNames.length > 0
    ? environmentNames.map((nickname) => `- For the \`${nickname}\` environment, create new skills in \`.agents/editable-skills/${nickname}/<skill-name>/SKILL.md\``).join("\n")
    : "No environments are currently entered, so there are no environment-specific skill authoring locations.";
  const exampleNickname = environmentNames.includes("example-com") ? "example-com" : environmentNames[0];
  const example = exampleNickname ? `\nUse the normal Agent Skills format. For example, to create a very simple skill for ${exampleNickname}:\n\n\`\`\`sh\nmkdir -p .agents/editable-skills/${exampleNickname}/say-hello\ncat > .agents/editable-skills/${exampleNickname}/say-hello/SKILL.md <<'EOF'\n---\nname: say-hello\ndescription: Say hello when the user asks for a greeting.\n---\n\nWhen asked for a greeting, say hello.\nEOF\n\`\`\`\n\nThe presence of \`SKILL.md\` makes the new skill eligible for preservation. Rook will associate it with ${exampleNickname} and make it available through \`.agents/skills/\`.` : "";
  const skillInventory = environmentNames.map((nickname) => {
    const names = [...(skillNamesByEnvironment.get(nickname) ?? [])].sort((a, b) => a.localeCompare(b));
    return `- \`${nickname}\`: ${names.length > 0 ? names.map((name) => `\`${formatInlineCode(name)}\``).join(", ") : "none"}`;
  }).join("\n");
  return `# Rook environment instructions

This file is generated by Rook and is read-only. Do not edit it directly.

This file contains two kinds of guidance:

- instructions associated with the environments currently entered in this session;
- guidance for editing existing skills and creating new environment-associated skills.

## Environment instructions

Each environment's instructions appear inside an \`<environment_instruction>\` tag. Use the instruction text as context.

The tag attributes mean:

- \`environment\` is the path-safe environment nickname.
- \`editable=\"false\"\` marks instructions that come from a read-only source.
- \`editable=\"true\"\` marks instructions that the user may edit.
- \`path\` identifies the source file to edit for writable instructions. Paths are relative.

When an editable block has a \`path\`, edit that source file rather than this generated aggregate. If an editable block contains only the default message, no user-authored instructions exist for that environment yet.

${[...blocks, ...factBlocks].join("\n\n")}

## Skill editing

Skills are discovered from \`.agents/skills/\`. Some discovered skills may be writable and some may come from external or read-only sources.

If a skill's files are writable, you may edit them and those changes can be preserved. If a skill's files are not writable, do not edit them: changes will not be persisted. Do not change file permissions, replace links, copy over the files, or otherwise modify file access in an attempt to make a non-writable skill editable.

Do not create new skills directly under \`.agents/skills/\`. When using Rook, every new skill must be associated with a particular environment and created in that environment's authoring directory:

${locations}${example}

## Environment skills

The following list shows the skills currently known for each environment.

${skillInventory || "- none"}
`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatInlineCode(value: string): string {
  return value.replaceAll("`", "\\`");
}

async function materializeDerivedSkill(skillsRoot: string, artifact: BundleArtifact, usedSkillNames: Set<string>, skillPaths: string[]): Promise<void> {
  const visibleName = uniqueSkillName(artifact.id, usedSkillNames);
  const target = path.join(skillsRoot, visibleName);
  await writeArtifact(target, artifact);
  await makeReadOnly(target);
  skillPaths.push(target);
}

function writableInstructionsContent(content: string | undefined): string {
  return content?.trim() ? content : DEFAULT_EMPTY_INSTRUCTIONS;
}

function artifactText(artifact: BundleArtifact): string {
  return Object.values(artifact.files).join("\n\n");
}

function generatedReferenceSkill(id: string, sourceName: string, content: string): BundleArtifact {
  return {
    id,
    files: {
      [`${id}/SKILL.md`]: `---\nname: ${id}\ndescription: Reference material from ${sourceName}.\n---\n\n# ${sourceName}\n\n${content}`,
    },
  };
}

async function sourceFingerprint(source: WorkspaceSource): Promise<string> {
  if (source.kind === "instructions") return fingerprint(await readFile(source.path, "utf8"));
  if (source.kind === "skill") return fingerprint(await readSkillFiles(source.path, source.artifactId ?? "skill"));
  const files: Record<string, string> = {};
  for (const skillId of await skillDirectories(source.path)) {
    Object.assign(files, await readSkillFiles(path.join(source.path, skillId), skillId));
  }
  return fingerprint(files);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function skillDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

async function readSkillFiles(root: string, artifactId: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(child, relative);
      else if (entry.isFile()) files[`${artifactId}/${relative}`] = await readFile(child, "utf8");
    }
  }
  await walk(root, "");
  return files;
}

async function writeArtifact(targetRoot: string, artifact: BundleArtifact): Promise<void> {
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  for (const [rawPath, content] of Object.entries(artifact.files)) {
    const target = safeChild(targetRoot, artifactRelativePath(rawPath, artifact.id));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

function artifactRelativePath(rawPath: string, artifactId: string): string {
  const normalized = rawPath.replaceAll("\\", "/");
  return normalized.startsWith(`${artifactId}/`) ? normalized.slice(artifactId.length + 1) : normalized;
}

async function clearDirectory(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    await removeTree(path.join(root, entry.name));
  }
}

async function removeTree(root: string): Promise<void> {
  if (!(await pathExists(root))) return;
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || stat.isFile()) {
    await chmod(root, 0o644).catch(() => undefined);
    await rm(root, { force: true });
    return;
  }
  await chmod(root, 0o755).catch(() => undefined);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      await rm(child, { force: true });
    } else if (entry.isDirectory()) {
      await removeTree(child);
    } else {
      await chmod(child, 0o644).catch(() => undefined);
      await rm(child, { force: true });
    }
  }
  await chmod(root, 0o755).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

async function materializeReadOnlyFile(target: string, content: string): Promise<void> {
  await rm(target, { force: true });
  await writeFile(target, content, "utf8");
  await chmod(target, 0o444);
}

async function replaceWithSymlink(linkPath: string, target: string): Promise<void> {
  await rm(linkPath, { recursive: true, force: true });
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath, "dir");
}

async function makeReadOnly(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeReadOnly(child);
    else if (entry.isFile()) await chmod(child, 0o444);
  }
  await chmod(root, 0o555);
}

function pathSafeName(value: string): string {
  return safeName(value) || "environment";
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
}

function safeChild(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Workspace path escapes its root: ${parts.join("/")}`);
  return target;
}

function projectDirectory(environmentId: string): string | undefined {
  return environmentId.startsWith("dir:/") ? path.posix.normalize(environmentId.slice("dir:".length)) : undefined;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
