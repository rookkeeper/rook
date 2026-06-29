export interface EnvironmentRecord {
  id: string;
  displayName: string;
  description: string;
}

export interface RepositoryReadError {
  code:
    | "invalid_environment_id"
    | "invalid_environment_directory"
    | "invalid_bundle_directory"
    | "invalid_bundle_contents"
    | "unreadable_path";
  message: string;
  repository: string;
  environmentId: string;
  bundleId?: string;
  path?: string;
}

export interface BundleArtifact {
  id: string;
  files: Record<string, string>;
  /**
   * Transitional internal-only hint for runtime bridging while EnvironmentManager
   * still needs directory-backed skill paths.
   */
  sourcePath?: string;
}

export interface EnvironmentBundle {
  id: string;
  bundleId: string;
  environmentId: string;
  repository: string;
  skills: BundleArtifact[];
  mcpServers: BundleArtifact[];
  apps: BundleArtifact[];
  valid: boolean;
  errors: RepositoryReadError[];
}

export interface EnvironmentBundleResult {
  environment: EnvironmentRecord | null;
  bundles: EnvironmentBundle[];
  errors: RepositoryReadError[];
}
