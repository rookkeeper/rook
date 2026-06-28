// @vitest-environment node
import { describe, expect, it } from "vitest";
import { locationKey } from "./locationKey.js";

const COORD = { latitude: 36.06, longitude: -86.7 };

describe("locationKey", () => {
  it("appends an authoritative provider store number after the address", () => {
    const lk = locationKey({ domain: "target.com", storeNumber: "1842", address: "1 Main St", stateAbbrev: "TN", zip: "37000", ...COORD });
    expect(lk).toMatchObject({ key: "tn-37000-1-main-st/store-1842", kind: "address", storeNumber: "1842" });
  });

  it("guesses a numeric store id from the website and appends it after the address", () => {
    const lk = locationKey({
      domain: "homedepot.com",
      website: "https://www.homedepot.com/l/Cleveland/TN/Cleveland/37312/743",
      address: "546 Paul Huff Pkwy NW",
      stateAbbrev: "TN",
      zip: "37312",
      ...COORD,
    });
    expect(lk).toMatchObject({ key: "tn-37312-546-paul-huff-pkwy-nw/store-743", kind: "address", storeNumber: "743" });
  });

  it("appends the store number after the geo base when there is no address", () => {
    const lk = locationKey({ domain: "x.com", storeNumber: "55", latitude: 36.062, longitude: -86.7025 });
    expect(lk).toMatchObject({ key: "36.06200,-86.70250/store-55", kind: "geo", storeNumber: "55" });
  });

  it("generates a state-zip-street slug when there is no store id", () => {
    const lk = locationKey({
      domain: "cicis.com",
      website: "https://www.cicis.com/locations/tn-nashville-5735-nolensville-pike",
      address: "5705 Nolensville Pike",
      stateAbbrev: "TN",
      zip: "37211",
      ...COORD,
    });
    expect(lk.kind).toBe("address");
    expect(lk.key).toBe("tn-37211-5705-nolensville-pike");
    expect(lk.storeNumber).toBeUndefined();
  });

  it("normalizes punctuation/whitespace in the slug", () => {
    const lk = locationKey({ domain: "x.com", address: "  100  N. Main St. #2 ", stateAbbrev: "TN", zip: "37000", ...COORD });
    expect(lk.key).toBe("tn-37000-100-n-main-st-2");
  });

  it("falls back to the business lat,lng when there is no address", () => {
    const lk = locationKey({ domain: "starbucks.com", latitude: 36.061234, longitude: -86.701239 });
    expect(lk.kind).toBe("geo");
    expect(lk.key).toBe("36.06123,-86.70124");
  });

  it("uses the building centroid for the geo key when in a building", () => {
    const lk = locationKey({
      domain: "starbucks.com",
      latitude: 36.061234,
      longitude: -86.701239,
      buildingCentroidLat: 36.062,
      buildingCentroidLon: -86.7025,
    });
    expect(lk.kind).toBe("geo");
    expect(lk.key).toBe("36.06200,-86.70250");
  });
});
