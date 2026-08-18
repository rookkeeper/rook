export interface EnvironmentRecord {
  id: string;
  displayName: string;
  description: string;
  metadata: Record<string, unknown>;
}

export type CapabilityType = "skill" | "instructions" | "llms-txt" | "facts" | "mcp" | "app";

export interface RepositoryReadError {
  code:
    | "invalid_environment_id"
    | "invalid_environment_directory"
    | "invalid_bundle_directory"
    | "invalid_bundle_contents"
    | "unreadable_path"
    | "unreachable_url"
    | "unsupported_capability";
  message: string;
  repository: string;
  environmentId: string;
  bundleId?: string;
  path?: string;
  /** URL the error refers to, for web-sourced content. */
  url?: string;
}

export interface BundleArtifact {
  id: string;
  files: Record<string, string>;
  /** Internal-only path hint for directory-backed bundle artifacts. */
  sourcePath?: string;
  /** URL the content was fetched from, when the bundle is web-sourced. */
  sourceUrl?: string;
}

export interface EnvironmentBundle {
  id: string;
  bundleId: string;
  environmentId: string;
  repository: string;
  /** Path to the bundle directory/root when one exists on disk (or an equivalent synthesized bundle root). */
  bundlePath?: string;
  /** URL the content was fetched from, when the bundle is web-sourced. */
  sourceUrl?: string;
  skills: BundleArtifact[];
  mcpServers: BundleArtifact[];
  apps: BundleArtifact[];
  /** Small arbitrary facts/references that may be injected as instructions or skills. */
  facts?: BundleArtifact[];
  /** Fetched llms.txt content when the bundle provides it. */
  llmsTxt?: string;
  /** Raw content of AGENTS.md at the bundle root, when present. */
  agentsMd?: string;
  valid: boolean;
  errors: RepositoryReadError[];
}

export interface EnvironmentBundleResult {
  environment: EnvironmentRecord | null;
  bundles: EnvironmentBundle[];
  errors: RepositoryReadError[];
}
