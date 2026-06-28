// @vitest-environment node
import { describe, expect, it } from "vitest";
import { distanceToPolygonMeters, haversineMeters, pointInPolygon } from "./geo.js";

describe("geo", () => {
  it("computes haversine distance", () => {
    // ~1 deg latitude ~= 111km.
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(110000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(112000);
    expect(haversineMeters(36.1627, -86.7816, 36.1627, -86.7816)).toBe(0);
  });

  it("tests point-in-polygon ([lon, lat] order)", () => {
    const square = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    expect(pointInPolygon(0, 0, square)).toBe(true); // lat=0, lon=0 inside
    expect(pointInPolygon(2, 0, square)).toBe(false); // lat=2 outside
    expect(pointInPolygon(0, 2, square)).toBe(false); // lon=2 outside
  });

  it("measures distance to a polygon (0 inside, ~meters outside)", () => {
    // ~10m square centered at (36, -86): half-side in degrees.
    const halfLat = 5 / 111320;
    const halfLon = 5 / (111320 * Math.cos((36 * Math.PI) / 180));
    const sq = [
      [-86 - halfLon, 36 - halfLat],
      [-86 + halfLon, 36 - halfLat],
      [-86 + halfLon, 36 + halfLat],
      [-86 - halfLon, 36 + halfLat],
    ];
    expect(distanceToPolygonMeters(36, -86, sq)).toBe(0); // center
    // 2m north of the top edge -> ~2m.
    const d = distanceToPolygonMeters(36 + (5 + 2) / 111320, -86, sq);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(2.5);
    // far away -> large.
    expect(distanceToPolygonMeters(36.1, -86, sq)).toBeGreaterThan(1000);
  });
});
