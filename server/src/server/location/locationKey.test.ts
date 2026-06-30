// @vitest-environment node
import { describe, expect, it } from "vitest";
import { locationKey } from "./locationKey.js";

const COORD = { latitude: 36.06, longitude: -86.7 };

describe("locationKey", () => {
  it("generates a state-zip-street slug from the address (no store segment)", () => {
    const lk = locationKey({ address: "1 Main St", stateAbbrev: "TN", zip: "37000", ...COORD });
    expect(lk).toMatchObject({ key: "tn-37000-1-main-st", kind: "address" });
  });

  it("ignores any store number — the key is purely address-based", () => {
    const lk = locationKey({ address: "546 Paul Huff Pkwy NW", stateAbbrev: "TN", zip: "37312", ...COORD });
    expect(lk.key).toBe("tn-37312-546-paul-huff-pkwy-nw");
    expect(lk.key).not.toContain("store");
  });

  it("normalizes punctuation/whitespace in the slug", () => {
    const lk = locationKey({ address: "  100  N. Main St. #2 ", stateAbbrev: "TN", zip: "37000", ...COORD });
    expect(lk.key).toBe("tn-37000-100-n-main-st-2");
  });

  it("falls back to the business lat,lng when there is no address", () => {
    const lk = locationKey({ latitude: 36.061234, longitude: -86.701239 });
    expect(lk.kind).toBe("geo");
    expect(lk.key).toBe("36.06123,-86.70124");
  });

  it("uses the building centroid for the geo key when in a building", () => {
    const lk = locationKey({
      latitude: 36.061234,
      longitude: -86.701239,
      buildingCentroidLat: 36.062,
      buildingCentroidLon: -86.7025,
    });
    expect(lk.kind).toBe("geo");
    expect(lk.key).toBe("36.06200,-86.70250");
  });
});
