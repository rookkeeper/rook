import type { EnvironmentCandidate, IdentifyAvailableRequest } from "../../shared/environment.js";
import type { BuildingSkillSuggester } from "./BuildingSkillSuggester.js";
import { locationKey } from "./locationKey.js";
import { storeNumberFromWebsite } from "./storeNumber.js";
import { domainFromWebsite, isKnownOperator, operatorDomain } from "./operatorAliases.js";
import type { PoiLookupProvider, PoiResult } from "./PoiLookupProvider.js";

/** Minimal repository surface needed to check if an environment is known. */
export interface KnownEnvironmentLookup {
  getSkillRuntimePaths(environmentId: string): Promise<string[]>;
}

export interface EnvironmentIdentifierDeps {
  poiProvider: PoiLookupProvider;
  repository: KnownEnvironmentLookup;
  skillSuggester: BuildingSkillSuggester;
}

const SEARCH_RADIUS_METERS = 150;

/**
 * Turns a dwell + lat/long request into a ranked list of candidate `loc:`
 * environments (issue #42, phase 1). Identification only — does not register
 * or enter environments.
 */
export class EnvironmentIdentifier {
  constructor(private readonly deps: EnvironmentIdentifierDeps) {}

  async identifyAvailableEnvironments(request: IdentifyAvailableRequest): Promise<EnvironmentCandidate[]> {
    const pois = await this.deps.poiProvider.nearbyPois({
      latitude: request.latitude,
      longitude: request.longitude,
      radiusMeters: SEARCH_RADIUS_METERS,
    });

    const candidates = await Promise.all(pois.map((poi) => this.toCandidate(poi, request)));
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  private async toCandidate(poi: PoiResult, request: IdentifyAvailableRequest): Promise<EnvironmentCandidate> {
    const operator = poi.operator ?? poi.name;
    // Prefer a domain from the business website (most reliable), else the alias table.
    const website = typeof poi.raw?.website === "string" ? poi.raw.website : undefined;
    const domain = domainFromWebsite(website) ?? operatorDomain(operator);

    // Per-location key: address slug -> building centroid / lat,lng (no store segment).
    const lk = locationKey({
      address: poi.address,
      stateAbbrev: typeof poi.raw?.state === "string" ? poi.raw.state : undefined,
      zip: typeof poi.raw?.zip === "string" ? poi.raw.zip : undefined,
      latitude: poi.latitude,
      longitude: poi.longitude,
      buildingCentroidLat: typeof poi.raw?.buildingCentroidLat === "number" ? poi.raw.buildingCentroidLat : undefined,
      buildingCentroidLon: typeof poi.raw?.buildingCentroidLon === "number" ? poi.raw.buildingCentroidLon : undefined,
    });
    const environmentId = `loc:${domain}/${lk.key}`;

    // Store number is optional metadata only: authoritative provider value, else parsed
    // from the chain's store-locator URL.
    const storeNumber = poi.storeNumber ?? storeNumberFromWebsite(website, domain) ?? undefined;

    const skillPaths = await this.deps.repository.getSkillRuntimePaths(environmentId);
    const hasKnownEnvironment = skillPaths.length > 0;
    const possibleSkills = await this.deps.skillSuggester.suggestSkills({ environmentId, operator });

    const matchReasons = computeMatchReasons(poi, !!storeNumber, hasKnownEnvironment);
    const confidence = computeConfidence(poi, request, operator, !!storeNumber);

    return {
      environmentId,
      displayName: poi.name,
      operator,
      ...(storeNumber ? { storeNumber } : {}),
      ...(poi.address ? { address: poi.address } : {}),
      latitude: poi.latitude,
      longitude: poi.longitude,
      ...(website ? { website } : {}),
      distanceMeters: Math.round(poi.distanceMeters),
      confidence,
      matchReasons,
      hasKnownEnvironment,
      ...(possibleSkills.length ? { possibleSkills } : {}),
    };
  }
}

function computeMatchReasons(poi: PoiResult, hasStore: boolean, hasKnownEnvironment: boolean): string[] {
  // Prefer provider-supplied signals (e.g. ptiles inside_building/name_match);
  // otherwise derive a coarse proximity reason from distance.
  const reasons: string[] = poi.matchReasons?.length ? [...poi.matchReasons] : [poi.distanceMeters <= 30 ? "nearest_poi" : "nearby_poi"];
  if (hasStore) reasons.push("operator_store_match");
  if (hasKnownEnvironment) reasons.push("known_environment");
  return reasons;
}

/**
 * Rough 0..1 confidence. Closer + recognized operator + stationary/dwell raise
 * it; poor GPS accuracy and movement lower it. Intentionally coarse for MVP.
 */
function computeConfidence(poi: PoiResult, request: IdentifyAvailableRequest, operator: string, hasStore: boolean): number {
  // Distance: 1.0 at 0m decaying to ~0 by 150m.
  const distanceScore = clamp01(1 - poi.distanceMeters / SEARCH_RADIUS_METERS);
  let score = distanceScore * 0.6;

  if (isKnownOperator(operator)) score += 0.2;
  if (hasStore) score += 0.1;

  // Provider match quality (ptiles): containment and name agreement are strong signals.
  if (poi.matchReasons?.includes("inside_building")) score += 0.25;
  if (poi.matchReasons?.includes("name_match")) score += 0.15;

  // Motion/dwell signal: stationary or meaningful dwell raises confidence;
  // clearly moving (driving-like speed) lowers it.
  if (request.isStationary || (request.dwellSeconds ?? 0) >= 120) score += 0.1;
  if ((request.speedMetersPerSecond ?? 0) > 2) score -= 0.2;

  // Penalize very poor GPS accuracy.
  if ((request.horizontalAccuracy ?? 0) > 50) score -= 0.1;

  return Number(clamp01(score).toFixed(2));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
