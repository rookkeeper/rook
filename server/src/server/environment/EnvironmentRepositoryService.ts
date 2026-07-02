import path from "node:path";
import type { EnvironmentBundleResult, EnvironmentBundle } from "../../shared/environmentRepository.js";
import type { EnvironmentPreview } from "../../shared/environment.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

export class EnvironmentRepositoryService {
  constructor(private readonly repository: EnvironmentRepository) {}

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    return this.repository.getBundles(environmentId);
  }

  async getValidBundles(environmentId: string): Promise<EnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    return result.bundles.filter((bundle) => bundle.valid);
  }

  async getBundleCollectionPaths(environmentId: string): Promise<string[]> {
    const bundles = await this.getValidBundles(environmentId);
    return unique(
      bundles
        .map((bundle) => bundle.bundlePath)
        .filter((bundlePath): bundlePath is string => Boolean(bundlePath))
        .map((bundlePath) => path.dirname(bundlePath)),
    );
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
        skills: bundle.skills,
        mcpServers: bundle.mcpServers,
        apps: bundle.apps,
        errors: bundle.errors,
      })),
    };
  }

  async getBundleInspection(environmentId: string): Promise<EnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    return result.bundles;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
