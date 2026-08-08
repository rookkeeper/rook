import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { pathExists, readSkillFiles, safeChild, skillDirectories } from "./workspaceFs.js";

export type SourceKind = "skill" | "instructions" | "authoring-slot";

export interface WorkspaceSource {
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
  writeBackDeleteSkill?: (skillId: string) => Promise<boolean>;
  writeBackInstructions?: (content: string) => Promise<boolean>;
  writeBackDeleteInstructions?: () => Promise<boolean>;
}

type BundleIdentity = {
  environmentName?: string;
  bundle: {
    repository: string;
    environmentId: string;
    bundleId: string;
  };
};

export function sameSource(entry: BundleIdentity, source: WorkspaceSource): boolean {
  return entry.bundle.repository === source.repository
    && entry.bundle.environmentId === source.environmentId
    && entry.bundle.bundleId === source.bundleId;
}

export async function nextVisibleSkillName(skillsRoot: string, skillId: string): Promise<string> {
  const existing = new Set((await readdir(skillsRoot, { withFileTypes: true })).map((entry) => entry.name));
  let name = skillId;
  for (let number = 2; existing.has(name); number += 1) name = `${skillId}_${number}`;
  return name;
}

export function sourceDescriptor(entry: BundleIdentity, kind: SourceKind, artifactId?: string): Record<string, string | undefined> {
  return {
    repository: entry.bundle.repository,
    environmentId: entry.bundle.environmentId,
    bundleId: entry.bundle.bundleId,
    kind,
    artifactId,
  };
}

export function sourceDigest(descriptor: Record<string, string | undefined>): string {
  return createHash("sha256").update(JSON.stringify(descriptor)).digest("base64url");
}

export function personalEnvironmentPath(workspaceRoot: string, entry: BundleIdentity): string {
  return safeChild(workspaceRoot, "writable", environmentKey(entry.bundle.environmentId));
}

export function personalEnvironmentPathForSource(workspaceRoot: string, source: WorkspaceSource): string {
  return safeChild(workspaceRoot, "writable", environmentKey(source.environmentId));
}

export function personalSourcePath(workspaceRoot: string, entry: BundleIdentity, kind: SourceKind, artifactId?: string): string {
  const root = personalEnvironmentPath(workspaceRoot, entry);
  if (kind === "instructions") return path.join(root, "AGENTS.md");
  if (kind === "authoring-slot") return path.join(root, ".agents", "skills");
  if (!artifactId) throw new Error("Personal skill source requires an artifact id.");
  return path.join(root, ".agents", "skills", artifactId);
}

export function environmentKey(environmentId: string): string {
  return pathSafeName(environmentId);
}

export function environmentNicknames(bundles: BundleIdentity[]): Map<string, string> {
  const byId = new Map<string, string>();
  const names = [...new Map(bundles.map((entry) => [entry.bundle.environmentId, entry.environmentName ?? entry.bundle.environmentId])).entries()]
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

export function uniqueSkillName(skillId: string, used: Set<string>): string {
  let visibleName = skillId;
  for (let number = 2; used.has(visibleName); number += 1) visibleName = `${skillId}_${number}`;
  used.add(visibleName);
  return visibleName;
}

export async function sourceFingerprint(source: WorkspaceSource): Promise<string> {
  if (!(await pathExists(source.path))) return "missing";
  if (source.kind === "instructions") return fingerprint(await readFile(source.path, "utf8"));
  if (source.kind === "skill") return fingerprint(await readSkillFiles(source.path, source.artifactId ?? "skill"));
  const files: Record<string, string> = {};
  for (const skillId of await skillDirectories(source.path)) {
    Object.assign(files, await readSkillFiles(path.join(source.path, skillId), skillId));
  }
  return fingerprint(files);
}

export function pathSafeName(value: string): string {
  return safeName(value) || "environment";
}

export function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
}

export function projectDirectory(environmentId: string): string | undefined {
  return environmentId.startsWith("dir:/") ? path.posix.normalize(environmentId.slice("dir:".length)) : undefined;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
