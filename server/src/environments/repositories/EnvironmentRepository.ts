import type { CapabilityType, EnvironmentBundle, EnvironmentBundleResult, EnvironmentRecord } from "../../shared/environmentRepository.js";

export abstract class EnvironmentRepository {
  readonly repositoryId?: string;

  abstract getBundles(environmentId: string): Promise<EnvironmentBundleResult>;

  /** Optional discovery API. Repositories may add it without changing bundle reads. */
  async listEnvironments(): Promise<EnvironmentRecord[]> {
    return [];
  }

  /** Optional search API. Repositories may add it without changing bundle reads. */
  async searchBundles(_query: string, _repositoryId?: string): Promise<EnvironmentBundle[]> {
    return [];
  }

  /** Optional write API for one complete user-owned capability file map. */
  async replaceCapabilityFiles(
    _environmentId: string,
    _bundleId: string,
    _type: CapabilityType,
    _capabilityName: string,
    _files: Record<string, string>,
    _repositoryId?: string,
  ): Promise<boolean> {
    return false;
  }

  /** Optional creation API for a newly authored capability. */
  async createCapabilityFiles(
    _environmentId: string,
    _bundleId: string,
    _type: CapabilityType,
    _capabilityName: string,
    _files: Record<string, string>,
    _repositoryId?: string,
  ): Promise<boolean> {
    return false;
  }

  /** Optional soft-delete API for a writable bundle membership. */
  async deleteCapability(
    _environmentId: string,
    _bundleId: string,
    _type: CapabilityType,
    _capabilityName: string,
    _repositoryId?: string,
  ): Promise<boolean> {
    return false;
  }

  /** Optional restoration API for a writable bundle membership. */
  async restoreCapability(
    _environmentId: string,
    _bundleId: string,
    _type: CapabilityType,
    _capabilityName: string,
    _repositoryId?: string,
  ): Promise<boolean> {
    return false;
  }
}
