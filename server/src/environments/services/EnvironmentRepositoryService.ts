import path from "node:path";
import type { EnvironmentBundleResult, EnvironmentBundle } from "../../shared/environmentRepository.js";
import type { EnvironmentPreview } from "../../shared/environment.js";
import { EnvironmentRepository } from "../repositories/EnvironmentRepository.js";
import { hashEnvironmentBundle } from "../../shared/environmentBundleHash.js";

export { hashEnvironmentBundle } from "../../shared/environmentBundleHash.js";

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

  async searchBundles(query: string, repositoryId?: string): Promise<EnvironmentBundle[]> {
    return this.repository.searchBundles(query, repositoryId);
  }

  async replaceArtifactFiles(environmentId: string, bundleId: string, kind: "skills" | "mcp-servers" | "apps", artifactId: string, files: Record<string, string>): Promise<boolean> {
    return this.repository.replaceArtifactFiles(environmentId, bundleId, kind, artifactId, files);
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
        revision: bundle.revision,
        valid: bundle.valid,
        bundleHash: hashEnvironmentBundle(bundle),
        skills: bundle.skills,
        mcpServers: bundle.mcpServers,
        apps: bundle.apps,
        facts: bundle.facts ?? [],
        llmsTxt: bundle.llmsTxt,
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

