// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PtilesPoiLookupProvider } from "./PtilesPoiLookupProvider.js";
import type { FetchRange } from "./ptiles/PtilesRangeSource.js";

/**
 * Live integration against the real PTILES host. Gated behind PTILES_LIVE=1 so
 * CI stays hermetic. Validates the end-to-end port (state resolution → buildings
 * + business decode → scoring) against real data.
 *
 * Run: PTILES_LIVE=1 npx vitest run PtilesPoiLookupProvider.live
 */
const LIVE = process.env.PTILES_LIVE === "1";

const directFetchRange: FetchRange = async (file, start, end) => {
  const base = process.env.PTILES_BASE_URL ?? "https://maps.mydatatimeline.com/maps/";
  const resp = await fetch(base + file, { headers: { Range: `bytes=${start}-${end}` } });
  return { status: resp.status, body: new Uint8Array(await resp.arrayBuffer()) };
};

describe.runIf(LIVE)("PtilesPoiLookupProvider (live)", () => {
  it("returns ranked candidates for a Nashville coordinate", async () => {
    const provider = new PtilesPoiLookupProvider({ fetchRange: directFetchRange });
    const pois = await provider.nearbyPois({ latitude: 36.1627, longitude: -86.7816 });
    expect(pois.length).toBeGreaterThan(0);
    expect(pois[0].matchReasons?.length).toBeGreaterThan(0);
    // Distances should be ascending-ish and within the search radius.
    expect(pois[0].distanceMeters).toBeLessThan(250);
  }, 30000);

  it("returns nothing far out in the ocean", async () => {
    const provider = new PtilesPoiLookupProvider({ fetchRange: directFetchRange });
    const pois = await provider.nearbyPois({ latitude: 25, longitude: -45 });
    expect(pois).toHaveLength(0);
  }, 30000);
});
