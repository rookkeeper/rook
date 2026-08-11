import { watch, type FSWatcher } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readlink, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EnvironmentBundle, BundleArtifact } from "../shared/environmentRepository.js";
import { ProjectDirectoryEnvironmentRepository } from "../environments/repositories/ProjectDirectoryEnvironmentRepository.js";
import { DEFAULT_EMPTY_INSTRUCTIONS, renderAggregateAgents, type AggregateFact, type AggregateSource, writableInstructionsContent } from "./workspace/renderAggregateAgents.js";
import { clearDirectory, makeReadOnly, materializeReadOnlyFile, pathExists, readSkillFiles, removeTree, replaceWithSymlink, safeChild, skillDirectories, writeArtifact } from "./workspace/workspaceFs.js";
import { environmentNicknames, nextVisibleSkillName, personalEnvironmentPath, personalEnvironmentPathForSource, personalSourcePath, projectDirectory, safeName, sameSource, sourceDescriptor, sourceDigest, sourceFingerprint, type SourceKind, type WorkspaceSource, uniqueSkillName } from "./workspace/workspaceSources.js";

/** A bundle resolved for an agent workspace. */
export interface CapabilityWorkspaceBundle {
  environmentName: string;
  bundleName: string;
  editable: boolean;
  bundle: EnvironmentBundle;
  writeBackSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackNewSkill?: (skillId: string, files: Record<string, string>) => Promise<boolean>;
  writeBackDeleteSkill?: (skillId: string) => Promise<boolean>;
  writeBackInstructions?: (content: string) => Promise<boolean>;
  writeBackDeleteInstructions?: () => Promise<boolean>;
}

export interface CapabilityWorkspaceResult {
  root: string;
  agentsPath: string;
  skillsRoot: string;
  editablePerEnvironmentRoot: string;
  mcpRoot: string;
  skillPaths: string[];
}

interface SessionAggregateData {
  root: string;
  sources: AggregateSource[];
  facts: AggregateFact[];
  skillNamesByEnvironment: Map<string, Set<string>>;
  skillAuthoringPaths: Map<string, string>;
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
    const editablePerEnvironmentRoot = path.join(root, ".agents", "editable-per-environment");
    const internalInstructionsRoot = path.join(root, ".agents", ".rook", "instructions");
    const mcpRoot = path.join(root, ".agents", "mcp-servers");
    const agentsPath = path.join(root, "AGENTS.md");
    await mkdir(root, { recursive: true });
    await Promise.all([
      removeTree(skillsRoot),
      removeTree(editablePerEnvironmentRoot),
      removeTree(internalInstructionsRoot),
      removeTree(mcpRoot),
      removeTree(agentsPath),
      removeTree(path.join(root, ".claude")),
      removeTree(path.join(root, "CLAUDE.md")),
    ]);
    await Promise.all([
      mkdir(skillsRoot, { recursive: true }),
      mkdir(editablePerEnvironmentRoot, { recursive: true }),
      mkdir(internalInstructionsRoot, { recursive: true }),
      mkdir(mcpRoot, { recursive: true }),
    ]);

    this.sessionBundles.set(sessionId, bundles);
    const nicknames = environmentNicknames(bundles);
    const usedSkillNames = new Set<string>();
    const skillPaths: string[] = [];
    const inlineFacts: AggregateFact[] = [];
    const agentInstructionSources: AggregateSource[] = [];
    const skillNamesByEnvironment = new Map<string, Set<string>>();
    const skillAuthoringPaths = new Map<string, string>();

    for (const entry of bundles) {
      if (entry.bundle.repository === "project-directory") this.watchProject(projectDirectory(entry.bundle.environmentId));
      const environmentId = entry.bundle.environmentId;
      const nickname = nicknames.get(environmentId)!;
      const skillNames = skillNamesByEnvironment.get(nickname) ?? new Set<string>();
      skillNamesByEnvironment.set(nickname, skillNames);
      if (entry.bundle.repository === "personal" || entry.bundle.repository === "project-directory") {
        await this.ensureAuthoringRoot(entry);
      }
      if (entry.bundle.repository === "personal") {
        const personalRoot = personalEnvironmentPath(this.workspaceRoot, entry);
        await mkdir(path.join(personalRoot, ".agents", "skills"), { recursive: true });
        await replaceWithSymlink(
          path.join(editablePerEnvironmentRoot, nickname),
          personalRoot,
        );
        skillAuthoringPaths.set(nickname, path.relative(root, path.join(editablePerEnvironmentRoot, nickname, ".agents", "skills")));
      } else if (entry.bundle.repository === "project-directory") {
        const directory = projectDirectory(environmentId);
        if (directory) skillAuthoringPaths.set(nickname, path.join(directory, ".agents", "skills"));
      }

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

      if (!entry.editable && entry.bundle.repository !== "project-directory") {
        const agentsSourcePath = path.join(internalInstructionsRoot, nickname, "AGENTS.md");
        await mkdir(path.dirname(agentsSourcePath), { recursive: true });
        await materializeReadOnlyFile(agentsSourcePath, entry.bundle.agentsMd ?? "");
        agentInstructionSources.push({
          nickname,
          sourcePath: path.relative(root, agentsSourcePath),
          displayPath: path.relative(root, agentsSourcePath),
          writable: false,
        });
      } else if (entry.bundle.repository === "personal") {
        await this.instructionSource(entry);
        const agentsSourcePath = path.join(editablePerEnvironmentRoot, nickname, "AGENTS.md");
        agentInstructionSources.push({
          nickname,
          sourcePath: agentsSourcePath,
          displayPath: path.relative(root, agentsSourcePath),
          writable: true,
        });
      } else {
        const instructionSource = await this.instructionSource(entry);
        const directory = projectDirectory(environmentId);
        const projectAgentsPath = directory ? path.join(directory, "AGENTS.md") : instructionSource.path;
        agentInstructionSources.push({
          nickname,
          sourcePath: instructionSource.path,
          displayPath: projectAgentsPath,
          writable: true,
        });
      }
    }

    this.sessionAggregateData.set(sessionId, {
      root,
      sources: agentInstructionSources,
      facts: inlineFacts,
      skillNamesByEnvironment,
      skillAuthoringPaths,
    });
    await writeFile(agentsPath, await renderAggregateAgents(root, agentInstructionSources, inlineFacts, skillNamesByEnvironment, skillAuthoringPaths), "utf8");
    await chmod(agentsPath, 0o444);
    // Claude Code discovers project skills only under .claude/skills and
    // auto-loads CLAUDE.md rather than AGENTS.md, so alias the projection
    // under those names for Claude runtimes. Relative targets keep the links
    // valid if the workspace root moves.
    await replaceWithSymlink(path.join(root, ".claude", "skills"), path.join("..", ".agents", "skills"));
    await replaceWithSymlink(path.join(root, "CLAUDE.md"), "AGENTS.md");
    await this.writeManifest();
    return { root, agentsPath, skillsRoot, editablePerEnvironmentRoot, mcpRoot, skillPaths };
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
    const repository = new ProjectDirectoryEnvironmentRepository();
    for (const [sessionId, bundles] of this.sessionBundles) {
      if (!bundles.some((entry) => entry.bundle.repository === "project-directory")) continue;
      const refreshedBundles = [];
      for (const entry of bundles) {
        if (entry.bundle.repository !== "project-directory") {
          refreshedBundles.push(entry);
          continue;
        }
        const resolved = await repository.getBundles(entry.bundle.environmentId);
        const bundle = resolved.bundles[0];
        refreshedBundles.push(bundle ? { ...entry, bundle } : { ...entry, bundle: { ...entry.bundle, skills: [], mcpServers: [], apps: [], agentsMd: undefined } });
      }
      await this.materialize(sessionId, refreshedBundles);
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
    if (entry.bundle.repository !== "personal") {
      await replaceWithSymlink(path.join(authoringRoot, skill.id), source.path);
    }
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
      const temporary = await this.ensureProjectStagingSource(entry, "instructions", async (target) => {
        await writeFile(target, DEFAULT_EMPTY_INSTRUCTIONS, "utf8");
      });
      return { path: temporary.path, writable: true };
    }

    if (entry.editable) {
      const source = await this.ensureWritableSource(entry, "instructions", undefined, async (target) => {
        await writeFile(target, writableInstructionsContent(entry.bundle.agentsMd), "utf8");
      });
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
      const staging = await this.ensureProjectStagingSource(entry, "authoring-slot", async (target) => {
        await mkdir(target, { recursive: true });
      });
      return staging.path;
    }
    const source = await this.ensureWritableSource(entry, "authoring-slot", undefined, async (target) => {
      await mkdir(target, { recursive: true });
    });
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
    const target = entry.bundle.repository === "personal"
      ? personalSourcePath(this.workspaceRoot, entry, kind, artifactId)
      : safeChild(this.workspaceRoot, "writable", key, kind === "skill" ? "skill" : kind === "instructions" ? "AGENTS.md" : "skills");
    await mkdir(path.dirname(target), { recursive: true });
    if (!(await pathExists(target))) await initialize(target);
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
      ...(entry.writeBackDeleteSkill ? { writeBackDeleteSkill: entry.writeBackDeleteSkill } : {}),
      ...(entry.writeBackInstructions ? { writeBackInstructions: entry.writeBackInstructions } : {}),
      ...(entry.writeBackDeleteInstructions ? { writeBackDeleteInstructions: entry.writeBackDeleteInstructions } : {}),
    };
    source.lastFingerprint = await sourceFingerprint(source);
    this.sources.set(key, source);
    return source;
  }

  private async persistSource(source: WorkspaceSource): Promise<void> {
    if (source.kind === "skill") {
      if (!source.artifactId) throw new Error(`No skill id is configured for ${source.key}.`);
      if (!(await pathExists(source.path))) {
        if (!source.writeBackDeleteSkill) throw new Error(`No skill delete write-back is configured for ${source.key}.`);
        const handled = await source.writeBackDeleteSkill(source.artifactId);
        if (!handled) throw new Error(`Skill deletion write-back declined for ${source.key}.`);
        source.lastFingerprint = "missing";
        await this.removeDeletedSkillSessions(source, source.artifactId);
        return;
      }
      if (!source.writeBackSkill) throw new Error(`No skill write-back is configured for ${source.key}.`);
      const handled = await source.writeBackSkill(source.artifactId, await readSkillFiles(source.path, source.artifactId));
      if (!handled) throw new Error(`Skill write-back declined for ${source.key}.`);
      return;
    }
    if (source.kind === "instructions") {
      if (!(await pathExists(source.path))) {
        if (!source.writeBackDeleteInstructions) throw new Error(`No instruction delete write-back is configured for ${source.key}.`);
        const handled = await source.writeBackDeleteInstructions();
        if (!handled) throw new Error(`Instruction deletion write-back declined for ${source.key}.`);
        source.lastFingerprint = "missing";
        await this.removeDeletedInstructionSessions(source);
        return;
      }
      if (!source.writeBackInstructions) throw new Error(`No instruction write-back is configured for ${source.key}.`);
      const handled = await source.writeBackInstructions(await readFile(source.path, "utf8"));
      if (!handled) throw new Error(`Instruction write-back declined for ${source.key}.`);
      await this.refreshInstructionSessions(source);
      return;
    }
    if (!source.writeBackNewSkill || !(await pathExists(source.path))) return;
    const currentSkillIds = new Set(await skillDirectories(source.path));
    for (const skillId of source.knownSkillIds ?? []) {
      if (currentSkillIds.has(skillId)) continue;
      if (!source.writeBackDeleteSkill) continue;
      const handled = await source.writeBackDeleteSkill(skillId);
      if (!handled) throw new Error(`Skill deletion write-back declined for ${source.key}/${skillId}.`);
      source.knownSkillIds?.delete(skillId);
      await this.removeDeletedSkillSessions(source, skillId);
    }
    for (const skillId of currentSkillIds) {
      if (source.knownSkillIds?.has(skillId)) continue;
      const files = await readSkillFiles(path.join(source.path, skillId), skillId);
      if (!(`${skillId}/SKILL.md` in files)) continue;
      const handled = await source.writeBackNewSkill(skillId, files);
      if (!handled) throw new Error(`New-skill write-back declined for ${source.key}/${skillId}.`);
      source.knownSkillIds?.add(skillId);
      await this.linkPromotedSkill(source, skillId);
    }
  }

  private async removeDeletedSkillSessions(source: WorkspaceSource, skillId: string): Promise<void> {
    for (const authoringSource of this.sources.values()) {
      if (
        authoringSource.kind === "authoring-slot"
        && authoringSource.repository === source.repository
        && authoringSource.environmentId === source.environmentId
        && authoringSource.bundleId === source.bundleId
      ) {
        authoringSource.knownSkillIds?.delete(skillId);
      }
    }
    for (const [sessionId, bundles] of this.sessionBundles) {
      if (!bundles.some((entry) => sameSource(entry, source))) continue;
      const root = this.agentWorkspaceRoot(sessionId);
      const skillsRoot = path.join(root, ".agents", "skills");
      for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) continue;
        const linkPath = path.join(skillsRoot, entry.name);
        const rawTarget = await readlink(linkPath, "utf8").catch(() => undefined);
        if (!rawTarget) continue;
        const target = path.resolve(path.dirname(linkPath), rawTarget);
        if (target === source.path && (entry.name === skillId || entry.name.startsWith(`${skillId}_`))) {
          await removeTree(linkPath);
        }
      }
      const aggregate = this.sessionAggregateData.get(sessionId);
      if (!aggregate) continue;
      const nickname = environmentNicknames(bundles).get(source.environmentId);
      if (nickname) aggregate.skillNamesByEnvironment.get(nickname)?.delete(skillId);
      await this.writeSessionAggregate(aggregate, sessionId);
    }
  }

  private async removeDeletedInstructionSessions(source: WorkspaceSource): Promise<void> {
    for (const [sessionId, bundles] of this.sessionBundles) {
      if (!bundles.some((entry) => sameSource(entry, source))) continue;
      const aggregate = this.sessionAggregateData.get(sessionId);
      if (!aggregate) continue;
      const nickname = environmentNicknames(bundles).get(source.environmentId);
      if (nickname) aggregate.sources = aggregate.sources.filter((entry) => entry.nickname !== nickname);
      await this.writeSessionAggregate(aggregate, sessionId);
    }
  }

  private async writeSessionAggregate(aggregate: SessionAggregateData, sessionId: string): Promise<void> {
    const aggregatePath = path.join(this.agentWorkspaceRoot(sessionId), "AGENTS.md");
    await chmod(aggregatePath, 0o644).catch(() => undefined);
    await writeFile(aggregatePath, await renderAggregateAgents(aggregate.root, aggregate.sources, aggregate.facts, aggregate.skillNamesByEnvironment, aggregate.skillAuthoringPaths), "utf8");
    await chmod(aggregatePath, 0o444);
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
          await renderAggregateAgents(aggregate.root, aggregate.sources, aggregate.facts, aggregate.skillNamesByEnvironment, aggregate.skillAuthoringPaths),
          "utf8",
        );
        await chmod(aggregatePath, 0o444);
      }
    }
  }

  private async writeManifest(): Promise<void> {
    const environments = new Map<string, { repository: string; environmentId: string; bundleId: string; mutable: boolean; path: string }>();
    for (const source of this.sources.values()) {
      if (source.repository !== "personal") continue;
      const identity = `${source.repository}:${source.environmentId}:${source.bundleId}`;
      environments.set(identity, {
        repository: source.repository,
        environmentId: source.environmentId,
        bundleId: source.bundleId,
        mutable: source.mutable,
        path: path.relative(this.workspaceRoot, personalEnvironmentPathForSource(this.workspaceRoot, source)),
      });
    }
    const manifest = [...environments.values()].sort((a, b) => a.path.localeCompare(b.path));
    await writeFile(path.join(this.workspaceRoot, "manifest.json"), `${JSON.stringify({ version: 2, environments: manifest }, null, 2)}\n`, "utf8");
  }
}

async function materializeDerivedSkill(skillsRoot: string, artifact: BundleArtifact, usedSkillNames: Set<string>, skillPaths: string[]): Promise<void> {
  const visibleName = uniqueSkillName(artifact.id, usedSkillNames);
  const target = path.join(skillsRoot, visibleName);
  await writeArtifact(target, artifact);
  await makeReadOnly(target);
  skillPaths.push(target);
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
