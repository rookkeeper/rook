// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnvironmentIdentifier, type KnownEnvironmentLookup } from "./EnvironmentIdentifier.js";
import { MockBuildingSkillSuggester } from "./BuildingSkillSuggester.js";
import { StubPoiLookupProvider } from "./StubPoiLookupProvider.js";
import type { PoiLookupProvider, PoiResult } from "./PoiLookupProvider.js";

const TEST_COORD = { latitude: 37.3318, longitude: -122.0312 };

const emptyRepo: KnownEnvironmentLookup = { async getSkillRuntimePaths() { return []; } };
function identifierFor(poi: PoiResult): EnvironmentIdentifier {
  const provider: PoiLookupProvider = { async nearbyPois() { return [poi]; } };
  return new EnvironmentIdentifier({ poiProvider: provider, repository: emptyRepo, skillSuggester: new MockBuildingSkillSuggester() });
}

function makeIdentifier(knownIds: string[] = []) {
  const repository: KnownEnvironmentLookup = {
    async getSkillRuntimePaths(environmentId: string) {
      return knownIds.includes(environmentId) ? [`/repo/${environmentId}/skills/x`] : [];
    },
  };
  return new EnvironmentIdentifier({
    poiProvider: new StubPoiLookupProvider(),
    repository,
    skillSuggester: new MockBuildingSkillSuggester(),
  });
}

describe("EnvironmentIdentifier", () => {
  it("returns ranked candidates with stable loc: ids", async () => {
    const identifier = makeIdentifier();
    const candidates = await identifier.identifyAvailableEnvironments({ ...TEST_COORD, isStationary: true });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0].environmentId).toBe("loc:target.com/123-main-st-springfield-il");
    expect(candidates[0].displayName).toBe("Target");
    expect(candidates[0].storeNumber).toBe("1842");
    // Sorted descending by confidence.
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
    }
  });

  it("reports hasKnownEnvironment from the repository", async () => {
    const identifier = makeIdentifier(["loc:target.com/123-main-st-springfield-il"]);
    const candidates = await identifier.identifyAvailableEnvironments(TEST_COORD);
    const target = candidates.find((c) => c.environmentId === "loc:target.com/123-main-st-springfield-il");
    const starbucks = candidates.find((c) => c.environmentId === "loc:starbucks.com/119-main-st-springfield-il");

    expect(target?.hasKnownEnvironment).toBe(true);
    expect(target?.matchReasons).toContain("known_environment");
    expect(starbucks?.hasKnownEnvironment).toBe(false);
  });

  it("includes mocked possibleSkills for known operators", async () => {
    const identifier = makeIdentifier();
    const candidates = await identifier.identifyAvailableEnvironments(TEST_COORD);
    const target = candidates.find((c) => c.environmentId === "loc:target.com/123-main-st-springfield-il");
    expect(target?.possibleSkills).toContain("store-navigation");
  });

  it("lowers confidence when moving fast (driving-like)", async () => {
    const identifier = makeIdentifier();
    const stationary = await identifier.identifyAvailableEnvironments({ ...TEST_COORD, isStationary: true });
    const driving = await identifier.identifyAvailableEnvironments({ ...TEST_COORD, speedMetersPerSecond: 20 });
    expect(driving[0].confidence).toBeLessThan(stationary[0].confidence);
  });

  it("returns no candidates when coordinate is far away", async () => {
    const identifier = makeIdentifier();
    const candidates = await identifier.identifyAvailableEnvironments({ latitude: 40, longitude: -74 });
    expect(candidates).toHaveLength(0);
  });

  it("uses an address-based id and exposes the store number as metadata from a chain website", async () => {
    const identifier = identifierFor({
      name: "The Home Depot",
      operator: "The Home Depot",
      address: "546 Paul Huff Pkwy NW",
      latitude: 35.21,
      longitude: -84.85,
      distanceMeters: 8,
      matchReasons: ["inside_building"],
      raw: { website: "https://www.homedepot.com/l/Cleveland/TN/Cleveland/37312/743", state: "TN", zip: "37312" },
    });
    const [c] = await identifier.identifyAvailableEnvironments({ latitude: 35.21, longitude: -84.85 });
    expect(c.environmentId).toBe("loc:homedepot.com/tn-37312-546-paul-huff-pkwy-nw");
    expect(c.storeNumber).toBe("743");
    expect(c.matchReasons).toContain("operator_store_match");
    expect(c.latitude).toBe(35.21);
    expect(c.longitude).toBe(-84.85);
    expect(c.website).toBe("https://www.homedepot.com/l/Cleveland/TN/Cleveland/37312/743");
  });

  it("builds an address-slug id when there is no store number", async () => {
    const identifier = identifierFor({
      name: "Cicis",
      operator: "Cicis",
      address: "5705 Nolensville Pike",
      latitude: 36.06,
      longitude: -86.7,
      distanceMeters: 5,
      raw: { website: "https://www.cicis.com/locations/tn-nashville-5705-nolensville-pike", state: "TN", zip: "37211" },
    });
    const [c] = await identifier.identifyAvailableEnvironments({ latitude: 36.06, longitude: -86.7 });
    expect(c.environmentId).toBe("loc:cicis.com/tn-37211-5705-nolensville-pike");
    expect(c.storeNumber).toBeUndefined();
    expect(c.matchReasons).not.toContain("operator_store_match");
  });
});
