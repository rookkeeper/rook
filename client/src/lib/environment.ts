export interface SkillPreview {
  id: string;
  name: string;
  files: Record<string, string>;
}

export interface EnvironmentPreview {
  environmentId: string;
  skills: SkillPreview[];
}

export type EnvironmentDecision = "accept" | "approve" | "ignore" | "reject";

export const ENVIRONMENT_OFFER_AVAILABLE_KIND = "environment_offer_available";
export const ENVIRONMENT_OFFER_RESOLVED_KIND = "environment_offer_resolved";

export interface EnvironmentOfferAvailablePayload {
  environmentId: string;
  sourceName?: string;
  canonicalSourceUrl?: string;
}

export interface EnvironmentOfferResolvedPayload {
  environmentId: string;
  decision: "approved" | "dismissed" | "unavailable";
}
