/**
 * A point-of-interest near a coordinate, as returned by a lookup provider
 * (reverse geocoder / POI database). Provider-agnostic shape.
 */
export interface PoiResult {
  name: string;
  operator?: string;
  storeNumber?: string;
  address?: string;
  latitude: number;
  longitude: number;
  /** Distance from the requested coordinate, in meters. */
  distanceMeters: number;
  /** Provider-supplied match signals (e.g. "inside_building", "name_match", "nearby"). */
  matchReasons?: string[];
  /** Raw provider payload, for debugging / future enrichment. */
  raw?: Record<string, unknown>;
}

export interface PoiLookupInput {
  latitude: number;
  longitude: number;
  /** Search radius in meters; provider may treat as a hint. */
  radiusMeters?: number;
}

/**
 * Resolves a coordinate into nearby points of interest. Implementations are
 * injected so the real (networked) provider can be swapped in later without
 * touching identification logic. See {@link StubPoiLookupProvider}.
 */
export interface PoiLookupProvider {
  nearbyPois(input: PoiLookupInput): Promise<PoiResult[]>;
}
