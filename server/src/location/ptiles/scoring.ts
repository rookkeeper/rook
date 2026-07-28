import type { BuildingMatch } from "./BuildingsReader.js";
import type { BusinessMatch } from "./BusinessReader.js";
import { pointInPolygon } from "./geo.js";

const STOPWORDS = new Set(["the", "inc", "llc", "ltd", "and", "of", "for", "&"]);

function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export interface ScoredBusiness {
  biz: BusinessMatch;
  score: number;
  inside: boolean;
  nameMatch: boolean;
}

/**
 * Port of the demo's `doLookup` scoring: rank nearby businesses by whether they
 * fall inside the matched building footprint and/or share its name, then by
 * distance. Lower score = better (inside&name -1, inside 0, name 1, nearby 100).
 */
export function scoreBusinesses(businesses: BusinessMatch[], building: BuildingMatch | null): ScoredBusiness[] {
  const bldgNameLower = building?.name ? building.name.toLowerCase() : "";
  const bldgWords = bldgNameLower ? significantWords(bldgNameLower) : [];

  const scored: ScoredBusiness[] = businesses.map((biz) => {
    let score = 100;
    const inside = building ? pointInPolygon(biz.lat, biz.lon, building.coordinates) : false;
    if (inside) score = 0;

    const brNameLower = biz.name.toLowerCase();
    let nameMatch = false;
    if (bldgNameLower && brNameLower && bldgNameLower !== brNameLower) {
      if (brNameLower.includes(bldgNameLower) || bldgNameLower.includes(brNameLower)) nameMatch = true;
      const brWords = significantWords(brNameLower);
      if (bldgWords.length > 0 && brWords.length > 0) {
        let common = 0;
        for (const bw of bldgWords) if (brWords.includes(bw)) common++;
        if (common / Math.min(bldgWords.length, brWords.length) >= 0.5) nameMatch = true;
      }
    } else if (bldgNameLower && bldgNameLower === brNameLower) {
      nameMatch = true;
    }
    if (nameMatch) score = Math.min(score, score === 0 ? 0 : 1);
    if (inside && nameMatch) score = -1;

    return { biz, score, inside, nameMatch };
  });

  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.biz.distance - b.biz.distance));
  return scored;
}

/** The match reason for a scored business, for surfacing in candidate metadata. */
export function matchReason(s: ScoredBusiness): string {
  return s.inside ? "inside_building" : s.nameMatch ? "name_match" : "nearby";
}
