import type { EnvironmentBundleResult, EnvironmentBundle } from "../../shared/environmentRepository.js";
import type { SkillPreview } from "../../shared/environment.js";
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

  async getSkillPreviews(environmentId: string): Promise<SkillPreview[]> {
    const result = await this.repository.getBundles(environmentId);
    const previews = result.bundles
      .flatMap((bundle) => bundle.skills)
      .map((skill) => ({ id: skill.id, name: skill.id, files: skill.files }));
    return previews.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getBundleInspection(environmentId: string): Promise<EnvironmentBundle[]> {
    const result = await this.repository.getBundles(environmentId);
    return result.bundles;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
