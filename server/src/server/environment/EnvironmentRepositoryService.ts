import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EnvironmentBundleResult, EnvironmentBundle } from "../../shared/environmentRepository.js";
import type { EnvironmentPreview } from "../../shared/environment.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

export interface ResolvedEnvironmentBundle {
  bundle: EnvironmentBundle;
  bundleHash: string;
}

export class EnvironmentRepositoryService {
  constructor(private readonly repository: EnvironmentRepository) {}

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    return this.repository.getBundles(environmentId);
  }

  async getResolvedBundles(environmentId: string): Promise<ResolvedEnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    const valid = result.bundles.filter((bundle) => bundle.valid);
    const resolved: ResolvedEnvironmentBundle[] = [];
    for (const bundle of valid) {
      resolved.push({ bundle, bundleHash: await hashBundle(bundle) });
    }
    return resolved;
  }

  async getValidBundles(environmentId: string): Promise<EnvironmentBundle[]> {
    return (await this.getResolvedBundles(environmentId)).map(({ bundle }) => bundle);
  }

  async getBundleCollectionPaths(environmentId: string): Promise<string[]> {
    const bundles = (await this.getResolvedBundles(environmentId)).map(({ bundle }) => bundle);
    return unique(
      bundles
        .map((bundle) => bundle.bundlePath)
        .filter((bundlePath): bundlePath is string => Boolean(bundlePath))
        .map((bundlePath) => path.dirname(bundlePath)),
    );
  }

  async getEnvironmentPreview(environmentId: string): Promise<EnvironmentPreview> {
    const result = await this.repository.getBundles(environmentId);
    const bundles = [];
    for (const bundle of result.bundles) {
      bundles.push({
        id: bundle.id,
        bundleId: bundle.bundleId,
        environmentId: bundle.environmentId,
        repository: bundle.repository,
        valid: bundle.valid,
        bundleHash: await hashBundle(bundle),
        skills: bundle.skills,
        mcpServers: bundle.mcpServers,
        apps: bundle.apps,
        agentsMd: bundle.agentsMd,
        errors: bundle.errors,
      });
    }
    return { environmentId, bundles };
  }

  async getBundleInspection(environmentId: string): Promise<EnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    return result.bundles;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function hashBundle(bundle: EnvironmentBundle): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update("rook-environment-bundle-v2\n");

  if (bundle.bundlePath) {
    // Merkle tree: walk the directory and hash every file.
    const fileHashes = await collectFileHashes(bundle.bundlePath);
    for (const [relativePath, fileHash] of fileHashes) {
      hash.update(`${relativePath}\n${fileHash}\n`);
    }
  } else {
    // Fallback: hash parsed artifact content when no bundlePath is available.
    for (const [groupName, artifacts] of [
      ["skills", bundle.skills],
      ["mcp-servers", bundle.mcpServers],
      ["apps", bundle.apps],
    ] as const) {
      hash.update(`${groupName}\n`);
      for (const artifact of [...artifacts].sort((a, b) => a.id.localeCompare(b.id))) {
        hash.update(`${artifact.id}\n`);
        for (const filePath of Object.keys(artifact.files).sort((a, b) => a.localeCompare(b))) {
          hash.update(`${filePath}\n`);
          hash.update(artifact.files[filePath]);
          hash.update("\n\u0000\n");
        }
      }
    }
    if (bundle.agentsMd) {
      hash.update("AGENTS.md\n");
      hash.update(bundle.agentsMd);
      hash.update("\n\u0000\n");
    }
  }

  return hash.digest("hex");
}

async function collectFileHashes(rootDir: string): Promise<[string, string][]> {
  const result: [string, string][] = [];
  await walkDirectory(rootDir, "", result);
  result.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

async function walkDirectory(
  dir: string,
  relativePrefix: string,
  result: [string, string][],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      await walkDirectory(absolutePath, relativePath, result);
    } else if (entry.isFile()) {
      const content = await readFile(absolutePath);
      const fileHash = crypto.createHash("sha256").update(content).digest("hex");
      result.push([relativePath, fileHash]);
    }
  }
}
