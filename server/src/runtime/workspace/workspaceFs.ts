import path from "node:path";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import type { BundleArtifact } from "../../shared/environmentRepository.js";

export async function skillDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

export async function readSkillFiles(root: string, artifactId: string): Promise<Record<string, string>> {
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

export async function writeArtifact(targetRoot: string, artifact: BundleArtifact): Promise<void> {
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  for (const [rawPath, content] of Object.entries(artifact.files)) {
    const target = safeChild(targetRoot, artifactRelativePath(rawPath, artifact.id));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

export async function clearDirectory(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    await removeTree(path.join(root, entry.name));
  }
}

export async function removeTree(root: string): Promise<void> {
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

export async function materializeReadOnlyFile(target: string, content: string): Promise<void> {
  await rm(target, { force: true });
  await writeFile(target, content, "utf8");
  await chmod(target, 0o444);
}

export async function replaceWithSymlink(linkPath: string, target: string): Promise<void> {
  await rm(linkPath, { recursive: true, force: true });
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath, "dir");
}

export async function makeReadOnly(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeReadOnly(child);
    else if (entry.isFile()) await chmod(child, 0o444);
  }
  await chmod(root, 0o555);
}

export function safeChild(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Workspace path escapes its root: ${parts.join("/")}`);
  return target;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

function artifactRelativePath(rawPath: string, artifactId: string): string {
  const normalized = rawPath.replaceAll("\\", "/");
  return normalized.startsWith(`${artifactId}/`) ? normalized.slice(artifactId.length + 1) : normalized;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
