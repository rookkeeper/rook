import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
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
    try {
      await access(dir);
      return [dir];
    } catch {
      return [];
    }
  }

  async getSkillPreviews(environmentId: string): Promise<SkillPreview[]> {
    const previews: SkillPreview[] = [];
    for (const bundlePath of await this.getSkillPaths(environmentId)) {
      previews.push(...await this.readSkillPreviewsFromBundle(bundlePath));
    }
    return previews;
  }

  private resolveEnvironmentDir(environmentId: string): string | null {
    const colonIndex = environmentId.indexOf(":");
    if (colonIndex === -1) return null;
    const kind = environmentId.slice(0, colonIndex);
    const envPath = environmentId.slice(colonIndex + 1);
    if (!kind || !envPath) return null;
    return path.join(this.root, kind, envPath);
  }

  private async readSkillPreviewsFromBundle(bundlePath: string): Promise<SkillPreview[]> {
    let entries;
    try {
      entries = await readdir(bundlePath, { withFileTypes: true });
    } catch {
      return [];
    }

    const previews: SkillPreview[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(bundlePath, entry.name);
      try {
        await access(path.join(skillDir, "SKILL.md"));
      } catch {
        continue;
      }
      const files = await this.readFilesUnder(skillDir, entry.name);
      previews.push({ id: entry.name, name: entry.name, files });
    }
    return previews.sort((a, b) => a.name.localeCompare(b.name));
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
