/**
 * Dwell/motion analysis of GPS traces against the ptiles identification pipeline.
 *
 * For each trace it: classifies motion mode from speed, replays the production
 * matching (restrictToPlace/scoreBusinesses) per point, groups consecutive points
 * matched to the same place into "detections", and measures each detection's DWELL
 * (seconds) + speed — to separate real visits (sustained, slow) from drive-by hits
 * (brief, fast). Writes a per-trace + aggregate report to .var/validation-traces/.
 *
 * Corpus = committed fixtures (src/server/location/test-fixtures/gpx) plus anything in
 * .var/validation-traces/*.gpx (from fetch-validation-traces). Diagnostic: fetches
 * ptiles ranges directly. Usage: npm run dwell:analysis
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdminReader } from "../../src/server/location/ptiles/AdminReader.js";
import { queryBuilding } from "../../src/server/location/ptiles/BuildingsReader.js";
import { queryBusinesses } from "../../src/server/location/ptiles/BusinessReader.js";
import { haversineMeters } from "../../src/server/location/ptiles/geo.js";
import { PtilesRangeSource, type FetchRange } from "../../src/server/location/ptiles/PtilesRangeSource.js";
import { scoreBusinesses } from "../../src/server/location/ptiles/scoring.js";
import { stateAbbrev } from "../../src/server/location/ptiles/usStates.js";
import { restrictToPlace } from "../../src/server/location/PtilesPoiLookupProvider.js";
import { parseGpxTrack, type GpxTrackPoint } from "../../src/server/location/gpx.js";
import { REPO_ROOT } from "../../src/server/paths.js";

const BASE_URL = process.env.PTILES_BASE_URL ?? "https://maps.mydatatimeline.com/maps/";
const fetchRange: FetchRange = async (file, start, end) => {
  const r = await fetch(BASE_URL + file, { headers: { Range: `bytes=${start}-${end}` } });
  return { status: r.status, body: new Uint8Array(await r.arrayBuffer()) };
};

const FIXTURES = path.join(REPO_ROOT, "server", "src", "server", "location", "test-fixtures", "gpx");
const VALIDATION = path.join(REPO_ROOT, ".var", "validation-traces");
const MAX_LOOKUPS = 2500; // cap per trace; stride longer ones (dwell seconds stay correct)
const GAP_BREAK_S = 120; // a time gap larger than this splits motion segments
const NEARBY_M = 10;
const BUFFER_M = 2;

type Mode = "pedestrian" | "cycling" | "vehicle" | "unknown";

interface Detection {
  key: string;
  name: string;
  kind: "inside" | "nearby";
  dwellSeconds: number;
  points: number;
  meanSpeed: number;
  maxSpeed: number;
}
interface TraceResult {
  file: string;
  state: string | null;
  buildingsIndexValid: boolean;
  mode: Mode;
  points: number;
  durationMin: number;
  movingP50: number;
  movingP85: number;
  detections: Detection[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Per-step speed (m/s) where a timestamp gap exists; NaN when unknown/segment break. */
function stepSpeeds(points: GpxTrackPoint[]): number[] {
  const speeds: number[] = [NaN];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.t === undefined || b.t === undefined) {
      speeds.push(NaN);
      continue;
    }
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || dt > GAP_BREAK_S) {
      speeds.push(NaN);
      continue;
    }
    speeds.push(haversineMeters(a.lat, a.lon, b.lat, b.lon) / dt);
  }
  return speeds;
}

function classifyMode(p85: number, hasTime: boolean): Mode {
  if (!hasTime) return "unknown";
  if (p85 < 2.5) return "pedestrian";
  if (p85 < 7) return "cycling";
  return "vehicle";
}

async function analyzeTrace(file: string, full: string): Promise<TraceResult | null> {
  const pts = parseGpxTrack(readFileSync(full, "utf8"));
  if (pts.length < 10) return null;
  const speeds = stepSpeeds(pts);
  const moving = speeds.filter((s) => Number.isFinite(s) && s > 0.3).sort((a, b) => a - b);
  const hasTime = pts.some((p) => p.t !== undefined);
  const mode = classifyMode(percentile(moving, 85), hasTime);
  const t0 = pts.find((p) => p.t !== undefined)?.t;
  const tN = [...pts].reverse().find((p) => p.t !== undefined)?.t;
  const durationMin = t0 !== undefined && tN !== undefined ? (tN - t0) / 60000 : 0;

  // State + sources.
  const adminReader = new AdminReader(new PtilesRangeSource("US.admin.ptiles", fetchRange));
  const mid = pts[Math.floor(pts.length / 2)];
  const abbrev = stateAbbrev((await adminReader.query(mid.lat, mid.lon))?.state) ?? stateAbbrev((await adminReader.query(pts[0].lat, pts[0].lon))?.state);
  const base: TraceResult = { file, state: abbrev, buildingsIndexValid: false, mode, points: pts.length, durationMin, movingP50: percentile(moving, 50), movingP85: percentile(moving, 85), detections: [] };
  if (!abbrev) return base;

  const buildings = new PtilesRangeSource(`${abbrev}.buildings_v8.ptiles`, fetchRange);
  const business = new PtilesRangeSource(`${abbrev}.business.ptiles`, fetchRange);
  await Promise.all([buildings.init(), business.init()]);
  base.buildingsIndexValid = (await buildings.getIndex()).entries.length > 0;

  const stride = Math.max(1, Math.ceil(pts.length / MAX_LOOKUPS));
  // Per-point match: place key + kind + the point's speed.
  const matched: Array<{ key: string; name: string; kind: "inside" | "nearby"; t?: number; speed: number }> = [];
  for (let i = 0; i < pts.length; i += stride) {
    const p = pts[i];
    const [building, nearby] = await Promise.all([
      queryBuilding(buildings, p.lat, p.lon),
      queryBusinesses(business, p.lat, p.lon, 0.1),
    ]);
    const top = scoreBusinesses(restrictToPlace(nearby, building, { bufferMeters: BUFFER_M, nearbyRadiusMeters: NEARBY_M }), building)[0]?.biz;
    const speed = Number.isFinite(speeds[i]) ? speeds[i] : 0;
    if (top) matched.push({ key: `b:${top.uid}`, name: top.name, kind: building?.inPoly ? "inside" : "nearby", t: p.t, speed });
    else matched.push({ key: "", name: "", kind: "nearby", t: p.t, speed });
  }

  // Group consecutive same-key points into detections.
  let run: typeof matched = [];
  const flush = () => {
    if (run.length === 0 || !run[0].key) {
      run = [];
      return;
    }
    const first = run[0];
    const last = run[run.length - 1];
    const dwellSeconds = first.t !== undefined && last.t !== undefined ? (last.t - first.t) / 1000 : 0;
    const sp = run.map((r) => r.speed);
    base.detections.push({
      key: first.key,
      name: first.name,
      kind: first.kind,
      dwellSeconds,
      points: run.length,
      meanSpeed: sp.reduce((s, v) => s + v, 0) / sp.length,
      maxSpeed: Math.max(...sp),
    });
    run = [];
  };
  for (const m of matched) {
    if (run.length > 0 && m.key === run[0].key) run.push(m);
    else {
      flush();
      if (m.key) run.push(m);
    }
  }
  flush();
  return base;
}

function bucket(s: number): string {
  if (s < 5) return "<5s";
  if (s < 20) return "5-20s";
  if (s < 60) return "20-60s";
  if (s < 300) return "1-5m";
  return ">5m";
}

async function main(): Promise<void> {
  mkdirSync(VALIDATION, { recursive: true });
  const files: Array<{ file: string; full: string }> = [];
  for (const dir of [FIXTURES, VALIDATION]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".gpx")) files.push({ file: f, full: path.join(dir, f) });
    } catch {
      /* dir may not exist */
    }
  }
  console.log(`Analyzing ${files.length} trace(s)…\n`);

  const results: TraceResult[] = [];
  for (const { file, full } of files) {
    try {
      const r = await analyzeTrace(file, full);
      if (!r) continue;
      results.push(r);
      const dets = r.detections;
      console.log(`${file}  state=${r.state ?? "?"} mode=${r.mode} pts=${r.points} dur=${r.durationMin.toFixed(0)}m p85=${r.movingP85.toFixed(1)}m/s bldgIdx=${r.buildingsIndexValid ? "ok" : "EMPTY"} detections=${dets.length}`);
    } catch (e) {
      console.log(`${file}  ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Aggregate by mode.
  const md: string[] = [`# Dwell / motion analysis\n`, `Traces: ${results.length}. Detection = consecutive points matched to the same place. Dwell = its time span.\n`];
  md.push(`## Per-trace\n`, `| trace | state | mode | pts | dur(min) | p50 | p85 (m/s) | bldg idx | detections | drive-bys(<20s) | visits(>=60s) |`, `|---|---|---|---|---|---|---|---|---|---|---|`);
  const byMode: Record<string, Detection[]> = {};
  for (const r of results) {
    const driveby = r.detections.filter((d) => d.dwellSeconds < 20).length;
    const visits = r.detections.filter((d) => d.dwellSeconds >= 60).length;
    md.push(`| ${r.file} | ${r.state ?? "?"} | ${r.mode} | ${r.points} | ${r.durationMin.toFixed(0)} | ${r.movingP50.toFixed(1)} | ${r.movingP85.toFixed(1)} | ${r.buildingsIndexValid ? "ok" : "EMPTY"} | ${r.detections.length} | ${driveby} | ${visits} |`);
    (byMode[r.mode] ??= []).push(...r.detections);
  }
  md.push(`\n## Dwell distribution by mode\n`);
  for (const [mode, dets] of Object.entries(byMode)) {
    const buckets: Record<string, number> = {};
    for (const d of dets) buckets[bucket(d.dwellSeconds)] = (buckets[bucket(d.dwellSeconds)] ?? 0) + 1;
    const order = ["<5s", "5-20s", "20-60s", "1-5m", ">5m"];
    const driveby = dets.filter((d) => d.dwellSeconds < 20).length;
    md.push(`### ${mode} — ${dets.length} detections (${((driveby / Math.max(1, dets.length)) * 100).toFixed(0)}% under 20s)`);
    md.push(order.map((b) => `${b}: ${buckets[b] ?? 0}`).join(" · "));
    const longest = [...dets].sort((a, b) => b.dwellSeconds - a.dwellSeconds).slice(0, 5);
    md.push(`top dwells: ` + longest.map((d) => `${d.name}(${Math.round(d.dwellSeconds)}s,${d.kind},${d.meanSpeed.toFixed(1)}m/s)`).join("; ") + "\n");
  }

  writeFileSync(path.join(VALIDATION, "dwell-report.md"), md.join("\n"), "utf8");
  writeFileSync(path.join(VALIDATION, "dwell-report.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(`\nWrote ${path.join(VALIDATION, "dwell-report.md")}`);
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
