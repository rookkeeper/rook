import type { EnvironmentBundle, EnvironmentBundleResult, EnvironmentRecord } from "../../shared/environmentRepository.js";

export abstract class EnvironmentRepository {
  abstract getBundles(environmentId: string): Promise<EnvironmentBundleResult>;

  /** Optional discovery API. Repositories may add it without changing bundle reads. */
  async listEnvironments(): Promise<EnvironmentRecord[]> {
    return [];
  }

  /** Optional search API. Repositories may add it without changing bundle reads. */
  async searchBundles(_query: string): Promise<EnvironmentBundle[]> {
    return [];
  }
}
