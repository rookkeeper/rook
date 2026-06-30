/** Decimal places for the lat/lng fallback key (~1m precision). */
const GEO_PRECISION = 5;
const MAX_SLUG_LENGTH = 80;

export interface LocationKeyInput {
  address?: string;
  /** Two-letter state code, e.g. "TN". */
  stateAbbrev?: string;
  zip?: string;
  latitude: number;
  longitude: number;
  /** Centroid of the matched building, preferred over the point for the geo key. */
  buildingCentroidLat?: number;
  buildingCentroidLon?: number;
}

export interface LocationKey {
  /** Path component for the environment id (after `loc:<domain>/`). */
  key: string;
  /** How the key was derived. */
  kind: "address" | "geo";
}

/** Lowercase, collapse non-alphanumerics to single dashes, trim, length-cap. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Builds a stable, per-location key for a business — purely address-based:
 *   - `address`: `state-zip-street` slug when a street address is known,
 *   - `geo`: a rounded `lat,lng` otherwise — the matched building's centroid if the
 *     point is inside a building, else the business point.
 * Store numbers are NOT part of the key; they ride along as candidate metadata.
 */
export function locationKey(input: LocationKeyInput): LocationKey {
  const street = input.address ? slugify(input.address) : "";
  if (street) {
    const base = [input.stateAbbrev, input.zip, input.address]
      .map((p) => (p ? slugify(p) : ""))
      .filter(Boolean)
      .join("-");
    return { key: base, kind: "address" };
  }

  const geoLat = input.buildingCentroidLat ?? input.latitude;
  const geoLon = input.buildingCentroidLon ?? input.longitude;
  return { key: `${geoLat.toFixed(GEO_PRECISION)},${geoLon.toFixed(GEO_PRECISION)}`, kind: "geo" };
}
