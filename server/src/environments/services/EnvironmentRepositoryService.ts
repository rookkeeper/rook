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

  async replaceBundleInstructions(environmentId: string, bundleId: string, content: string): Promise<boolean> {
    return this.repository.replaceBundleInstructions(environmentId, bundleId, content);
  }

  async createArtifactFiles(environmentId: string, bundleId: string, kind: "skills" | "mcp-servers" | "apps", artifactId: string, files: Record<string, string>): Promise<boolean> {
    return this.repository.createArtifactFiles(environmentId, bundleId, kind, artifactId, files);
  }

  async ensurePersonalBundle(environmentId: string): Promise<boolean> {
    return this.repository.ensurePersonalBundle(environmentId);
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

  async hasKnownEnvironment(environmentId: string): Promise<boolean> {
    return (await this.getResolvedBundles(environmentId)).length > 0;
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
