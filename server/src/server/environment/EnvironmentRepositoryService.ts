import type { EnvironmentBundleResult, EnvironmentBundle } from "../../shared/environmentRepository.js";
import type { EnvironmentPreview } from "../../shared/environment.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

export class EnvironmentRepositoryService {
  constructor(private readonly repository: EnvironmentRepository) {}

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    return this.repository.getBundles(environmentId);
  }

  async getSkillRuntimePaths(environmentId: string): Promise<string[]> {
    const result = await this.repository.getBundles(environmentId);
    return unique(
      result.bundles
        .filter((bundle) => bundle.valid)
        .flatMap((bundle) => bundle.skills)
        .map((skill) => skill.sourcePath)
        .filter((path): path is string => Boolean(path)),
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
