import type { FetchRange } from "./PtilesRangeSource.js";

/** Default upstream host for PTILES data files. */
export const DEFAULT_PTILES_BASE_URL = "https://maps.mydatatimeline.com/maps/";

/** Allowlisted file names: per-state buildings/business + the national admin grid. */
const FILE_ALLOWLIST = /^([A-Z]{2}\.(buildings_v8|business)|US\.admin)\.ptiles$/;

/**
 * Build the single egress to the PTILES data host. Ptiles is an internal
 * implementation detail of geo-identification — this fetches the requested byte
 * range directly from the upstream host (allowlisted file names only); nothing is
 * exposed as a public route.
 */
export function createUpstreamFetchRange(baseUrl: string = process.env.PTILES_BASE_URL ?? DEFAULT_PTILES_BASE_URL): FetchRange {
  return async (file, start, endInclusive) => {
    if (!FILE_ALLOWLIST.test(file)) {
      throw new Error(`PTILES file not allowed: ${file}`);
    }
    const res = await fetch(baseUrl + file, { headers: { range: `bytes=${start}-${endInclusive}` } });
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body };
  };
}
