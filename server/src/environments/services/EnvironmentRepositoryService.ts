import crypto from "node:crypto";
import path from "node:path";
import type { EnvironmentBundleResult, EnvironmentBundle } from "../../shared/environmentRepository.js";
import type { EnvironmentPreview } from "../../shared/environment.js";
import { EnvironmentRepository } from "../repositories/EnvironmentRepository.js";

export interface ResolvedEnvironmentBundle {
  bundle: EnvironmentBundle;
  bundleHash: string;
}

export class EnvironmentRepositoryService {
  constructor(private readonly repository: EnvironmentRepository) {}

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    return this.repository.getBundles(environmentId);
  }

  async listEnvironments() {
    return this.repository.listEnvironments();
  }

  async searchBundles(query: string): Promise<EnvironmentBundle[]> {
    return this.repository.searchBundles(query);
  }

  async getResolvedBundles(environmentId: string): Promise<ResolvedEnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    const valid = result.bundles.filter((bundle) => bundle.valid);
    const resolved: ResolvedEnvironmentBundle[] = [];
    for (const bundle of valid) {
      resolved.push({ bundle, bundleHash: hashEnvironmentBundle(bundle) });
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
        bundleHash: hashEnvironmentBundle(bundle),
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

/**
 * Hashes canonical bundle content, not its storage path. This keeps approval
 * stable when the same bundle moves between repository backends or is
 * materialized into a different working directory.
 */
export function hashEnvironmentBundle(bundle: EnvironmentBundle): string {
  const hash = crypto.createHash("sha256");
  hash.update("rook-environment-bundle-content-v3\n");
  for (const [groupName, artifacts] of [
    ["skills", bundle.skills],
    ["mcp-servers", bundle.mcpServers],
    ["apps", bundle.apps],
  ] as const) {
    hash.update(`${groupName}\u0000`);
    for (const artifact of [...artifacts].sort((a, b) => a.id.localeCompare(b.id))) {
      hash.update(`${artifact.id}\u0000`);
      for (const filePath of Object.keys(artifact.files).sort((a, b) => a.localeCompare(b))) {
        hash.update(`${filePath}\u0000${artifact.files[filePath]}\u0000`);
      }
    }
  }
  hash.update(`agents-md\u0000${bundle.agentsMd ?? ""}\u0000`);
  return hash.digest("hex");
}
