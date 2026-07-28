/**
 * Maps an identified building/operator into a set of *possible* skill slugs.
 *
 * NOTE: This is a placeholder for the follow-up phase (issue #22, "Build
 * environment skills at scale"). Phase 1 only identifies environments; it does
 * not generate skills. The mock returns canned suggestions so the response
 * shape is exercised end-to-end.
 */
export interface BuildingSkillInput {
  environmentId: string;
  operator?: string;
}

export interface BuildingSkillSuggester {
  suggestSkills(input: BuildingSkillInput): Promise<string[]>;
}

const MOCK_SUGGESTIONS: Record<string, string[]> = {
  "target.com": ["store-navigation", "price-check", "loyalty-circle"],
  "starbucks.com": ["mobile-order", "rewards-balance"],
  "lowes.com": ["aisle-locator", "pro-desk"],
};

/** Canned, operator-keyed skill suggestions. Replace with real generation. */
export class MockBuildingSkillSuggester implements BuildingSkillSuggester {
  async suggestSkills(input: BuildingSkillInput): Promise<string[]> {
    const colonIndex = input.environmentId.indexOf(":");
    const path = colonIndex === -1 ? input.environmentId : input.environmentId.slice(colonIndex + 1);
    const domain = path.split("/")[0] ?? "";
    return MOCK_SUGGESTIONS[domain] ?? [];
  }
}
