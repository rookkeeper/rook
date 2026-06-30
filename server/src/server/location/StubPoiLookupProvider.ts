import type { PoiLookupInput, PoiLookupProvider, PoiResult } from "./PoiLookupProvider.js";

/** Approximate meters per degree of latitude (good enough for nearby ranking). */
const METERS_PER_DEGREE = 111_320;

interface FixturePoi {
  name: string;
  operator: string;
  storeNumber?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

/**
 * Deterministic, network-free POI provider for development and tests. Returns
 * a small fixed catalog of POIs, computing real distances from the requested
 * coordinate and filtering by radius. Swap for a real provider in production.
 */
export class StubPoiLookupProvider implements PoiLookupProvider {
  private readonly catalog: FixturePoi[];
  private readonly defaultRadiusMeters: number;

  constructor(options: { catalog?: FixturePoi[]; defaultRadiusMeters?: number } = {}) {
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    this.defaultRadiusMeters = options.defaultRadiusMeters ?? 200;
  }

  async nearbyPois(input: PoiLookupInput): Promise<PoiResult[]> {
    const radius = input.radiusMeters ?? this.defaultRadiusMeters;
    return this.catalog
      .map((poi) => ({
        ...poi,
        distanceMeters: haversineMeters(input.latitude, input.longitude, poi.latitude, poi.longitude),
      }))
      .filter((poi) => poi.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const meanLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const x = dLat * METERS_PER_DEGREE;
  const y = dLon * METERS_PER_DEGREE * Math.cos(meanLat);
  return Math.sqrt(x * x + y * y);
}

/** Fixture POIs clustered near (37.3318, -122.0312) for manual + unit testing. */
const DEFAULT_CATALOG: FixturePoi[] = [
  {
    name: "Target",
    operator: "Target",
    storeNumber: "1842",
    address: "123 Main St, Springfield, IL",
    latitude: 37.33182,
    longitude: -122.03118,
  },
  {
    name: "Starbucks",
    operator: "Starbucks",
    storeNumber: "9988",
    address: "119 Main St, Springfield, IL",
    latitude: 37.33205,
    longitude: -122.0314,
  },
];
