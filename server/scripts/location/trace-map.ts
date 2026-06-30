/**
 * Render a GPX trace + the ptiles buildings/businesses it matches into a single
 * self-contained HTML map (Leaflet) so you can eyeball identification accuracy.
 *
 * Diagnostic tool: it fetches ptiles ranges DIRECTLY from the data host (not via
 * the server proxy) and reuses the production matching (restrictToPlace,
 * scoreBusinesses, locationKey) plus the building geometry the API normally drops.
 *
 * Usage:
 *   npm run trace:map -- <file.gpx> [stride] [out.html]
 *   (stride replays every Nth trackpoint; default 10. out defaults to <gpx>.map.html)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdminReader } from "../../src/server/location/ptiles/AdminReader.js";
import { queryBuilding, type BuildingMatch } from "../../src/server/location/ptiles/BuildingsReader.js";
import { queryBusinesses } from "../../src/server/location/ptiles/BusinessReader.js";
import { PtilesRangeSource, type FetchRange } from "../../src/server/location/ptiles/PtilesRangeSource.js";
import { scoreBusinesses } from "../../src/server/location/ptiles/scoring.js";
import { stateAbbrev } from "../../src/server/location/ptiles/usStates.js";
import { restrictToPlace } from "../../src/server/location/PtilesPoiLookupProvider.js";
import { locationKey } from "../../src/server/location/locationKey.js";
import { domainFromWebsite, operatorDomain } from "../../src/server/location/operatorAliases.js";
import { parseGpxPoints } from "../../src/server/location/gpx.js";

const BASE_URL = process.env.PTILES_BASE_URL ?? "https://maps.mydatatimeline.com/maps/";
const directFetchRange: FetchRange = async (file, start, end) => {
  const resp = await fetch(BASE_URL + file, { headers: { Range: `bytes=${start}-${end}` } });
  return { status: resp.status, body: new Uint8Array(await resp.arrayBuffer()) };
};

type Feature = Record<string, unknown>;

export interface TraceMapStats {
  state: string;
  points: number;
  sampled: number;
  matches: number;
  buildings: number;
}

/** Render a GPX + its ptiles matches to a self-contained HTML map at `outPath`. */
export async function writeTraceMap(gpxPath: string, stride: number, outPath: string): Promise<TraceMapStats | null> {
  const all = parseGpxPoints(await readFile(gpxPath, "utf8"));
  if (all.length === 0) return null;
  const points = all.filter((_, i) => i % Math.max(1, stride) === 0);

  // Resolve the state once (a single run stays in one state); reuse for all points.
  const adminReader = new AdminReader(new PtilesRangeSource("US.admin.ptiles", directFetchRange));
  const admin0 = await adminReader.query(points[0].lat, points[0].lon);
  const abbrev = stateAbbrev(admin0?.state);
  if (!abbrev) return null;
  const buildings = new PtilesRangeSource(`${abbrev}.buildings_v8.ptiles`, directFetchRange);
  const business = new PtilesRangeSource(`${abbrev}.business.ptiles`, directFetchRange);
  await Promise.all([buildings.init(), business.init()]);

  const buildingFeatures = new Map<number, Feature>(); // dedupe by osmId
  const businessFeatures: Feature[] = [];
  const matchedPoints: Feature[] = [];
  let matches = 0;

  for (const p of points) {
    const [building, nearby] = await Promise.all([
      queryBuilding(buildings, p.lat, p.lon),
      queryBusinesses(business, p.lat, p.lon, 0.2),
    ]);
    const selected = restrictToPlace(nearby, building, { bufferMeters: 2, nearbyRadiusMeters: 10 });
    const top = scoreBusinesses(selected, building)[0]?.biz;
    if (!top) continue;
    matches++;
    // Footprint of the matched store (the building the business sits in), so the
    // route point can be compared against the actual store outline.
    const storeBuilding = building && building.inPoly ? building : await queryBuilding(buildings, top.lat, top.lon);
    if (storeBuilding && !buildingFeatures.has(storeBuilding.osmId)) {
      buildingFeatures.set(storeBuilding.osmId, polygonFeature(storeBuilding));
    }
    const website = top.website || undefined;
    const domain = domainFromWebsite(website) ?? operatorDomain(top.brand || top.name);
    const lk = locationKey({
      domain, website, address: top.address, stateAbbrev: abbrev, zip: admin0?.zip,
      latitude: top.lat, longitude: top.lon,
      buildingCentroidLat: building?.centroidLat, buildingCentroidLon: building?.centroidLon,
    });
    const locId = `loc:${domain}/${lk.key}`;
    businessFeatures.push(pointFeature(top.lon, top.lat, { kind: "business", name: top.name, locId, address: top.address ?? "" }));
    matchedPoints.push(pointFeature(p.lon, p.lat, { kind: "query", name: top.name, locId }));
  }

  const route: Feature = {
    type: "Feature",
    properties: { kind: "route" },
    geometry: { type: "LineString", coordinates: all.map((p) => [p.lon, p.lat]) },
  };
  const geojson = {
    type: "FeatureCollection",
    features: [route, ...buildingFeatures.values(), ...businessFeatures, ...matchedPoints],
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, htmlPage(geojson, { gpx: path.basename(gpxPath), state: abbrev, total: all.length, sampled: points.length, matches, buildings: buildingFeatures.size }), "utf8");
  return { state: abbrev, points: all.length, sampled: points.length, matches, buildings: buildingFeatures.size };
}

async function main(): Promise<void> {
  const gpxPath = process.argv[2];
  if (!gpxPath) {
    console.error("usage: npm run trace:map -- <file.gpx> [stride] [out.html]");
    process.exit(1);
  }
  const stride = Math.max(1, Number(process.argv[3] ?? 10) || 10);
  const outPath = process.argv[4] ?? gpxPath.replace(/\.[^.]+$/, "") + ".map.html";
  console.log(`Tracing ${gpxPath} (stride ${stride})…`);
  const stats = await writeTraceMap(gpxPath, stride, outPath);
  if (!stats) {
    console.error("No points or could not resolve a US state for this trace.");
    process.exit(1);
  }
  console.log(`Matches: ${stats.matches}/${stats.sampled}; buildings: ${stats.buildings}. Wrote ${outPath}`);
}

function polygonFeature(b: BuildingMatch): Feature {
  return {
    type: "Feature",
    properties: { kind: "building", osmId: b.osmId, name: b.name ?? "", buildingType: b.buildingType, inPoly: b.inPoly },
    geometry: { type: "Polygon", coordinates: [b.coordinates.map((c) => [c[0], c[1]])] },
  };
}
function pointFeature(lon: number, lat: number, props: Record<string, unknown>): Feature {
  return { type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } };
}

function htmlPage(geojson: unknown, meta: { gpx: string; state: string; total: number; sampled: number; matches: number; buildings: number }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Trace map — ${meta.gpx}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0}#info{position:absolute;z-index:1000;top:8px;right:8px;background:#fff;padding:8px 10px;font:12px system-ui;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.3)}</style>
</head><body>
<div id="map"></div>
<div id="info"><b>${meta.gpx}</b><br>state ${meta.state} · ${meta.sampled}/${meta.total} pts · ${meta.matches} matches · ${meta.buildings} buildings<br>
<span style="color:#2a8">■</span> inside-building &nbsp; <span style="color:#e80">■</span> nearest &nbsp; <span style="color:#06f">—</span> route &nbsp; <span style="color:#d00">●</span> business</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data = ${JSON.stringify(geojson)};
const map = L.map('map');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const layer = L.geoJSON(data,{
  style: f => f.properties.kind==='route' ? {color:'#06f',weight:3,opacity:.8}
    : f.properties.kind==='building' ? {color:f.properties.inPoly?'#2a8':'#e80',weight:1,fillOpacity:.35} : {},
  pointToLayer: (f,latlng) => f.properties.kind==='business'
    ? L.circleMarker(latlng,{radius:5,color:'#d00',fillColor:'#d00',fillOpacity:.9})
    : L.circleMarker(latlng,{radius:3,color:'#06f',fillOpacity:.6}),
  onEachFeature: (f,l) => {
    const p=f.properties;
    if(p.kind==='building') l.bindPopup('<b>'+(p.name||'(unnamed building)')+'</b><br>osm '+p.osmId+'<br>'+(p.inPoly?'inside':'nearest')+' · '+p.buildingType);
    else if(p.kind==='business') l.bindPopup('<b>'+p.name+'</b><br>'+(p.address||'')+'<br><code>'+p.locId+'</code>');
  }
}).addTo(map);
map.fitBounds(layer.getBounds(),{padding:[20,20]});
</script>
</body></html>`;
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
