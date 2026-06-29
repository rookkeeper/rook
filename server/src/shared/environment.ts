import type { EnvironmentBundle, BundleArtifact, RepositoryReadError } from "./environmentRepository.js";

export interface BundleArtifactPreview extends BundleArtifact {}

export interface EnvironmentBundlePreview extends Pick<EnvironmentBundle, "id" | "bundleId" | "environmentId" | "repository" | "valid"> {
  skills: BundleArtifactPreview[];
  mcpServers: BundleArtifactPreview[];
  apps: BundleArtifactPreview[];
  errors: RepositoryReadError[];
}

export interface EnvironmentPreview {
  environmentId: string;
  bundles: EnvironmentBundlePreview[];
}

/** The 2×2 decision model: positive/negative × this-visit/permanent. */
export type EnvironmentDecision = "accept" | "approve" | "ignore" | "reject";

export const ENVIRONMENT_OFFER_AVAILABLE_KIND = "environment_offer_available";
export const ENVIRONMENT_OFFER_RESOLVED_KIND = "environment_offer_resolved";
export const ENVIRONMENT_ENTERED_KIND = "environment_entered";
export const ENVIRONMENT_EXITED_KIND = "environment_exited";

export interface EnvironmentOfferAvailablePayload {
  environmentId: string;
  sourceName?: string;
  canonicalSourceUrl?: string;
}

export interface EnvironmentOfferResolvedPayload {
  environmentId: string;
  decision: "approved" | "dismissed" | "unavailable";
}

export interface EnvironmentLifecyclePayload {
  environmentId: string;
}
