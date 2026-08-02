import type { EnvironmentBundle, EnvironmentBundleResult, EnvironmentRecord } from "../../shared/environmentRepository.js";

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

  /** Optional write API for user-owned database-backed artifacts. */
  async replaceArtifactFiles(_environmentId: string, _bundleId: string, _kind: "skills" | "mcp-servers" | "apps", _artifactId: string, _files: Record<string, string>): Promise<boolean> {
    return false;
  }

  /** Optional write API for user-owned bundle instructions. */
  async replaceBundleInstructions(_environmentId: string, _bundleId: string, _content: string): Promise<boolean> {
    return false;
  }

  /** Optional creation API for a newly authored skill. */
  async createArtifactFiles(_environmentId: string, _bundleId: string, _kind: "skills" | "mcp-servers" | "apps", _artifactId: string, _files: Record<string, string>): Promise<boolean> {
    return false;
  }

  /** Optional initialization API for an empty personal bundle. */
  async ensurePersonalBundle(_environmentId: string): Promise<boolean> {
    return false;
  }
}
