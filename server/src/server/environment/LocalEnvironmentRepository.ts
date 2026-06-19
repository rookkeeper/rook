import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { SkillPreview } from "../../shared/environment.js";
import { REPO_ROOT } from "../paths.js";

/**
 * Repository layer for reading environment skill content from disk.
 */
export class LocalEnvironmentRepository {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.join(REPO_ROOT, "environment-repository");
  }

  async getSkillPaths(environmentId: string): Promise<string[]> {
    const dir = this.resolveEnvironmentDir(environmentId);
    if (!dir) return [];
    const skillsDir = path.join(dir, "skills");
    let entries;
    try {
      entries = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const skillPaths: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillDir = path.join(skillsDir, entry.name);
      if (await this.isReadableSkillBundle(skillDir)) {
        skillPaths.push(skillDir);
      }
    }
    return skillPaths.sort((a, b) => a.localeCompare(b));
  }

  async getSkillPreviews(environmentId: string): Promise<SkillPreview[]> {
    const previews: SkillPreview[] = [];
    for (const skillPath of await this.getSkillPaths(environmentId)) {
      try {
        previews.push(await this.readSkillPreviewFromBundle(skillPath));
      } catch (error) {
        this.logRepositoryIssue(`skipping unreadable skill preview at ${skillPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return previews.sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveEnvironmentDir(environmentId: string): string | null {
    const colonIndex = environmentId.indexOf(":");
    if (colonIndex === -1) return null;
    const kind = environmentId.slice(0, colonIndex);
    const envPath = environmentId.slice(colonIndex + 1);
    if (!kind || !envPath) return null;
    return path.join(this.root, kind, envPath);
  }

  private async readSkillPreviewFromBundle(skillDir: string): Promise<SkillPreview> {
    const skillName = path.basename(skillDir);
    const files = await this.readFilesUnder(skillDir, skillName);
    return { id: skillName, name: skillName, files };
  }

  private async isReadableSkillBundle(skillDir: string): Promise<boolean> {
    try {
      await readFile(path.join(skillDir, "SKILL.md"), "utf8");
      return true;
    } catch (error) {
      this.logRepositoryIssue(`skipping invalid skill bundle at ${skillDir}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private logRepositoryIssue(message: string): void {
    console.warn(`[environment-repository] ${message}`);
  }

  private async readFilesUnder(rootDir: string, prefix: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    await this.collectFiles(rootDir, prefix, files);
    return files;
  }

  private async collectFiles(dir: string, relativePrefix: string, files: Record<string, string>): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativePrefix}/${entry.name}`;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collectFiles(absolutePath, relativePath, files);
      } else if (entry.isFile()) {
        files[relativePath] = await readFile(absolutePath, "utf8");
      }
    }
  }
}
