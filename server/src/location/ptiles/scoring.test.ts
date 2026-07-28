// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BuildingMatch } from "./BuildingsReader.js";
import type { BusinessMatch } from "./BusinessReader.js";
import { matchReason, scoreBusinesses } from "./scoring.js";

function biz(partial: Partial<BusinessMatch> & { name: string; lat: number; lon: number; distance: number }): BusinessMatch {
  return { uid: 0, category: "", brand: "", chainCount: 0, phone: "", website: "", address: "", ...partial };
}

const building: BuildingMatch = {
  osmId: 1,
  buildingType: "retail",
  name: "Target",
  category: null,
  // unit square around (0,0), [lon, lat] order
  coordinates: [
    [-0.001, -0.001],
    [0.001, -0.001],
    [0.001, 0.001],
    [-0.001, 0.001],
  ],
  centroidLat: 0,
  centroidLon: 0,
  inPoly: true,
};

describe("scoreBusinesses", () => {
  it("ranks inside+name over inside over name over nearby", () => {
    const businesses = [
      biz({ name: "Far Cafe", lat: 0.5, lon: 0.5, distance: 180 }), // nearby
      biz({ name: "Target", lat: 0, lon: 0, distance: 5 }), // inside + name
      biz({ name: "Target", lat: 0.5, lon: 0.5, distance: 170 }), // name only (outside poly)
      biz({ name: "Lobby Kiosk", lat: 0.0005, lon: 0.0005, distance: 8 }), // inside, no name
    ];
    const scored = scoreBusinesses(businesses, building);
    expect(scored.map((s) => s.biz.name)).toEqual(["Target", "Lobby Kiosk", "Target", "Far Cafe"]);
    expect(matchReason(scored[0])).toBe("inside_building");
    expect(matchReason(scored[1])).toBe("inside_building");
    expect(matchReason(scored[2])).toBe("name_match");
    expect(matchReason(scored[3])).toBe("nearby");
  });

  it("falls back to distance ordering with no building", () => {
    const businesses = [
      biz({ name: "B", lat: 0, lon: 0, distance: 30 }),
      biz({ name: "A", lat: 0, lon: 0, distance: 10 }),
    ];
    const scored = scoreBusinesses(businesses, null);
    expect(scored.map((s) => s.biz.name)).toEqual(["A", "B"]);
    expect(scored.every((s) => matchReason(s) === "nearby")).toBe(true);
  });
});
