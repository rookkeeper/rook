import type { EnvironmentBundleResult, EnvironmentBundle, EnvironmentRecord, CapabilityType } from "../../shared/environmentRepository.js";
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

  async replaceCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>, repositoryId?: string): Promise<boolean> {
    return this.repository.replaceCapabilityFiles(environmentId, bundleId, type, capabilityName, files, repositoryId);
  }

  async createCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>, repositoryId?: string): Promise<boolean> {
    return this.repository.createCapabilityFiles(environmentId, bundleId, type, capabilityName, files, repositoryId);
  }

  async deleteCapability(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, repositoryId?: string): Promise<boolean> {
    return this.repository.deleteCapability(environmentId, bundleId, type, capabilityName, repositoryId);
  }

  async restoreCapability(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, repositoryId?: string): Promise<boolean> {
    return this.repository.restoreCapability(environmentId, bundleId, type, capabilityName, repositoryId);
  }

  async getResolvedBundles(environmentId: string): Promise<ResolvedEnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    return result.bundles
      .filter((bundle) => bundle.valid)
      .map((bundle) => ({ bundle, bundleHash: hashEnvironmentBundle(bundle) }));
  }

  async getValidBundles(environmentId: string): Promise<EnvironmentBundle[]> {
    return (await this.getResolvedBundles(environmentId)).map(({ bundle }) => bundle);
  }

  async hasKnownEnvironment(environmentId: string): Promise<boolean> {
    return (await this.getResolvedBundles(environmentId)).length > 0;
  }

  /** Returns repository metadata only when the environment still has valid bundles. */
  async getKnownEnvironment(environmentId: string): Promise<EnvironmentRecord | undefined> {
    const result = await this.repository.getBundles(environmentId);
    if (!result.environment || !result.bundles.some((bundle) => bundle.valid)) return undefined;
    return result.environment;
  }

  async getEnvironmentPreview(environmentId: string): Promise<EnvironmentPreview> {
    const result = await this.repository.getBundles(environmentId);
    return {
      environmentId,
      bundles: result.bundles.map((bundle) => ({
        id: bundle.id,
        bundleId: bundle.bundleId,
        environmentId: bundle.environmentId,
        repository: bundle.repository,
        valid: bundle.valid,
        bundleHash: hashEnvironmentBundle(bundle),
        skills: bundle.skills,
        mcpServers: bundle.mcpServers,
        apps: bundle.apps,
        facts: bundle.facts ?? [],
        llmsTxt: bundle.llmsTxt,
        agentsMd: bundle.agentsMd,
        errors: bundle.errors,
      })),
    };
  }

  async getBundleInspection(environmentId: string): Promise<EnvironmentBundle[]> {
    return (await this.repository.getBundles(environmentId)).bundles;
  }
}
