import type { CapabilityType, EnvironmentBundle, EnvironmentBundleResult, EnvironmentRecord, RepositoryReadError } from "../../shared/environmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

export class CompositeEnvironmentRepository extends EnvironmentRepository {
  constructor(private readonly repositories: EnvironmentRepository[]) {
    super();
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const results = await Promise.all(this.repositories.map((repository) => repository.getBundles(environmentId)));
    const environment = results.find((result) => result.environment)?.environment ?? null;
    const bundles = results.flatMap((result) => result.bundles);
    const errors: RepositoryReadError[] = results.flatMap((result) => result.errors);
    return { environment, bundles, errors };
  }

  async replaceCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>, repositoryId?: string): Promise<boolean> {
    const repository = await this.repositoryForBundle(environmentId, bundleId, repositoryId);
    return repository ? repository.replaceCapabilityFiles(environmentId, bundleId, type, capabilityName, files, repositoryId) : false;
  }

  async createCapabilityFiles(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, files: Record<string, string>, repositoryId?: string): Promise<boolean> {
    const repository = await this.repositoryForBundle(environmentId, bundleId, repositoryId);
    return repository ? repository.createCapabilityFiles(environmentId, bundleId, type, capabilityName, files, repositoryId) : false;
  }

  async deleteCapability(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, repositoryId?: string): Promise<boolean> {
    const repository = await this.repositoryForBundle(environmentId, bundleId, repositoryId);
    return repository ? repository.deleteCapability(environmentId, bundleId, type, capabilityName, repositoryId) : false;
  }

  async restoreCapability(environmentId: string, bundleId: string, type: CapabilityType, capabilityName: string, repositoryId?: string): Promise<boolean> {
    const repository = await this.repositoryForBundle(environmentId, bundleId, repositoryId);
    return repository ? repository.restoreCapability(environmentId, bundleId, type, capabilityName, repositoryId) : false;
  }

  async listEnvironments(): Promise<EnvironmentRecord[]> {
    const environments = (await Promise.all(this.repositories.map((repository) => repository.listEnvironments()))).flat();
    return uniqueBy(environments, (environment) => environment.id);
  }

  async searchBundles(query: string, repositoryId?: string): Promise<EnvironmentBundle[]> {
    const bundles = (await Promise.all(this.repositories.map((repository) => repository.searchBundles(query, repositoryId)))).flat();
    return uniqueBy(bundles, (bundle) => `${bundle.repository}:${bundle.id}`);
  }

  private async repositoryForBundle(environmentId: string, bundleId: string, repositoryId?: string): Promise<EnvironmentRepository | null> {
    const result = await this.getBundles(environmentId);
    const bundle = result.bundles.find((candidate) => candidate.bundleId === bundleId && (repositoryId === undefined || candidate.repository === repositoryId));
    if (bundle) return this.repositories.find((candidate) => candidate.repositoryId === bundle.repository) ?? null;
    // Personal authoring can start from an ephemeral empty bundle that has no
    // membership row yet. The explicit repository id is sufficient to route
    // its first capability write.
    return repositoryId ? this.repositories.find((candidate) => candidate.repositoryId === repositoryId) ?? null : null;
  }
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}
