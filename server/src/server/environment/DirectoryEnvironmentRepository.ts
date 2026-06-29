import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type {
  BundleArtifact,
  EnvironmentBundle,
  EnvironmentBundleResult,
  EnvironmentRecord,
  RepositoryReadError,
} from "../../shared/environmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

const RECOGNIZED_CONTENT_DIRS = ["skills", "mcp-servers", "apps"] as const;
type RecognizedContentDir = typeof RECOGNIZED_CONTENT_DIRS[number];

export class DirectoryEnvironmentRepository extends EnvironmentRepository {
  constructor(
    readonly root: string,
    readonly repositoryId: string = root,
  ) {
    super();
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const envDir = this.resolveEnvironmentDir(environmentId);
    if (!envDir) {
      return {
        environment: null,
        bundles: [],
        errors: [{
          code: "invalid_environment_id",
          message: `Invalid environment id: ${environmentId}`,
          repository: this.repositoryId,
          environmentId,
        }],
      };
    }

    const bundlesDir = path.join(envDir, ".bundles");
    let entries;
    try {
      entries = await readdir(bundlesDir, { withFileTypes: true });
    } catch {
      return {
        environment: this.defaultEnvironmentRecord(environmentId),
        bundles: [],
        errors: [],
      };
    }

    const bundles: EnvironmentBundle[] = [];
    const errors: RepositoryReadError[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const bundleDir = path.join(bundlesDir, entry.name);
      const bundle = await this.readBundle(environmentId, entry.name, bundleDir);
      bundles.push(bundle);
      errors.push(...bundle.errors);
    }

    return {
      environment: this.defaultEnvironmentRecord(environmentId),
      bundles: bundles.sort((a, b) => a.bundleId.localeCompare(b.bundleId)),
      errors,
    };
  }

  private defaultEnvironmentRecord(environmentId: string): EnvironmentRecord {
    const envPath = environmentId.split(":")[1] ?? environmentId;
    const displayName = envPath
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.replace(/[-_]+/g, " "))
      .join(" / ") || environmentId;
    return { id: environmentId, displayName, description: `Environment ${environmentId}` };
  }

  private resolveEnvironmentDir(environmentId: string): string | null {
    const colonIndex = environmentId.indexOf(":");
    if (colonIndex === -1) return null;
    const kind = environmentId.slice(0, colonIndex);
    const envPath = environmentId.slice(colonIndex + 1);
    if (!kind || !envPath) return null;
    return path.join(this.root, kind, envPath);
  }

  private async readBundle(environmentId: string, bundleId: string, bundleDir: string): Promise<EnvironmentBundle> {
    const errors: RepositoryReadError[] = [];
    let entries;
    try {
      entries = await readdir(bundleDir, { withFileTypes: true });
    } catch (error) {
      return this.invalidBundle(environmentId, bundleId, bundleDir, [{
        code: "unreadable_path",
        message: error instanceof Error ? error.message : String(error),
        repository: this.repositoryId,
        environmentId,
        bundleId,
        path: bundleDir,
      }]);
    }

    const groups = new Map<RecognizedContentDir, BundleArtifact[]>();
    const unknownEntries = entries.filter((entry) => !RECOGNIZED_CONTENT_DIRS.includes(entry.name as RecognizedContentDir));
    for (const entry of unknownEntries) {
      if (entry.name === ".manifest") continue;
      errors.push({
        code: "invalid_bundle_directory",
        message: `Unrecognized bundle entry ${entry.name}`,
        repository: this.repositoryId,
        environmentId,
        bundleId,
        path: path.join(bundleDir, entry.name),
      });
    }

    for (const groupName of RECOGNIZED_CONTENT_DIRS) {
      const contentDir = path.join(bundleDir, groupName);
      const artifacts = await this.readArtifactGroup(environmentId, bundleId, groupName, contentDir, errors);
      if (artifacts.length > 0) groups.set(groupName, artifacts);
    }

    const bundle: EnvironmentBundle = {
      id: `${environmentId}#${bundleId}`,
      bundleId,
      environmentId,
      repository: this.repositoryId,
      skills: groups.get("skills") ?? [],
      mcpServers: groups.get("mcp-servers") ?? [],
      apps: groups.get("apps") ?? [],
      valid: errors.length === 0 && groups.size > 0,
      errors,
    };

    if (groups.size === 0) {
      bundle.errors.push({
        code: "invalid_bundle_contents",
        message: `Bundle ${bundleId} has no recognized content directories`,
        repository: this.repositoryId,
        environmentId,
        bundleId,
        path: bundleDir,
      });
      bundle.valid = false;
    }

    return bundle;
  }

  private invalidBundle(environmentId: string, bundleId: string, bundleDir: string, errors: RepositoryReadError[]): EnvironmentBundle {
    return {
      id: `${environmentId}#${bundleId}`,
      bundleId,
      environmentId,
      repository: this.repositoryId,
      skills: [],
      mcpServers: [],
      apps: [],
      valid: false,
      errors: errors.length > 0 ? errors : [{
        code: "invalid_bundle_directory",
        message: `Invalid bundle directory ${bundleDir}`,
        repository: this.repositoryId,
        environmentId,
        bundleId,
        path: bundleDir,
      }],
    };
  }

  private async readArtifactGroup(
    environmentId: string,
    bundleId: string,
    groupName: RecognizedContentDir,
    contentDir: string,
    errors: RepositoryReadError[],
  ): Promise<BundleArtifact[]> {
    let entries;
    try {
      entries = await readdir(contentDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const artifacts: BundleArtifact[] = [];
    for (const entry of entries) {
      const absolutePath = path.join(contentDir, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const files = await this.readFilesUnder(absolutePath, entry.name);
        if (groupName === "skills" && !(`${entry.name}/SKILL.md` in files)) {
          errors.push({
            code: "invalid_bundle_contents",
            message: `Skill ${entry.name} is missing SKILL.md`,
            repository: this.repositoryId,
            environmentId,
            bundleId,
            path: absolutePath,
          });
          continue;
        }
        artifacts.push({ id: entry.name, files, sourcePath: absolutePath });
        continue;
      }

      if (entry.isFile()) {
        const files: Record<string, string> = { [entry.name]: await readFile(absolutePath, "utf8") };
        artifacts.push({ id: path.basename(entry.name, path.extname(entry.name)), files, sourcePath: absolutePath });
      }
    }

    return artifacts.sort((a, b) => a.id.localeCompare(b.id));
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
