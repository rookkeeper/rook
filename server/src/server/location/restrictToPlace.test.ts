// @vitest-environment node
import { describe, expect, it } from "vitest";
import { restrictToPlace } from "./PtilesPoiLookupProvider.js";
import type { BuildingMatch } from "./ptiles/BuildingsReader.js";
import type { BusinessMatch } from "./ptiles/BusinessReader.js";

const OPTS = { bufferMeters: 2, nearbyRadiusMeters: 10 };

function biz(name: string, lat: number, lon: number, distance: number): BusinessMatch {
  return { uid: 0, name, category: "", brand: "", chainCount: 0, phone: "", website: "", address: "", lat, lon, distance };
}

// ~20m square footprint centered at (36, -86).
const half = 10 / 111320;
const halfLon = 10 / (111320 * Math.cos((36 * Math.PI) / 180));
const building: BuildingMatch = {
  osmId: 1,
  buildingType: "retail",
  name: null,
  category: null,
  coordinates: [
    [-86 - halfLon, 36 - half],
    [-86 + halfLon, 36 - half],
    [-86 + halfLon, 36 + half],
    [-86 - halfLon, 36 + half],
  ],
  centroidLat: 36,
  centroidLon: -86,
  inPoly: true,
};

describe("restrictToPlace", () => {
  it("returns only businesses inside the building footprint", () => {
    const inside = biz("Inside Co", 36, -86, 1);
    const outside = biz("Neighbor", 36 + 50 / 111320, -86, 50);
    const out = restrictToPlace([inside, outside], building, OPTS);
    expect(out.map((b) => b.name)).toEqual(["Inside Co"]);
  });

  it("falls back to a buffer around the footprint when none are inside", () => {
    const justOutside = biz("Edge Kiosk", 36 + (10 + 1.5) / 111320, -86, 11.5); // ~1.5m past edge
    const tooFar = biz("Across St", 36 + (10 + 5) / 111320, -86, 15); // ~5m past edge
    const out = restrictToPlace([justOutside, tooFar], building, OPTS);
    expect(out.map((b) => b.name)).toEqual(["Edge Kiosk"]);
  });

  it("uses a tight radius when not inside a building", () => {
    const near = biz("Cart", 36, -86, 8);
    const far = biz("Down the block", 36, -86, 25);
    // nearest-but-not-contained building => treated as not-in-building
    const nearestOnly: BuildingMatch = { ...building, inPoly: false };
    expect(restrictToPlace([near, far], nearestOnly, OPTS).map((b) => b.name)).toEqual(["Cart"]);
    expect(restrictToPlace([near, far], null, OPTS).map((b) => b.name)).toEqual(["Cart"]);
  });
});
