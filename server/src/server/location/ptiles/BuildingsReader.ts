import { cellToLatLng, latLngToCell } from "h3-js";
import { haversineMeters, pointInPolygon } from "./geo.js";
import type { PtilesRangeSource } from "./PtilesRangeSource.js";
import { decodeVarint, i16, u32, zigzagDecode, zigzagI32 } from "./ptilesFormat.js";

export interface BuildingMatch {
  osmId: number;
  buildingType: string;
  name: string | null;
  category: string | null;
  /** [lon, lat] pairs. */
  coordinates: number[][];
  centroidLat: number;
  centroidLon: number;
  /** True when the query point fell inside the footprint (vs nearest-within-50m). */
  inPoly: boolean;
}

/** Max distance (m) to accept a nearest-centroid building when none contains the point. */
const NEAREST_LIMIT_METERS = 50;

/**
 * Buildings layer reader, ported from the demo's `PtilesDemoReader.query`.
 * Returns the building footprint containing the point, else the nearest centroid
 * within 50m, else null.
 */
export async function queryBuilding(source: PtilesRangeSource, lat: number, lon: number): Promise<BuildingMatch | null> {
  const cellHex = latLngToCell(lat, lon, 7);
  const raw = await source.blockForCell(cellHex);
  if (!raw) return null;

  // String table prefix.
  const strCount = raw[0];
  let p = 1;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const slen = raw[p++];
    strings.push(new TextDecoder().decode(raw.subarray(p, p + slen)));
    p += slen;
  }
  const center = cellToLatLng(cellHex); // [lat, lng]
  const cx = Math.round(center[1] * 100000);
  const cy = Math.round(center[0] * 100000);

  let bestDist = Infinity;
  let best: BuildingMatch | null = null;
  let prevOsm = 0;

  while (p + 4 <= raw.length) {
    const rl = u32(new DataView(raw.buffer, raw.byteOffset + p, 4), 0);
    p += 4;
    if (p + rl > raw.length) break;
    const rec = raw.subarray(p, p + rl);
    let rp = 0;

    const dr = decodeVarint(rec, rp);
    rp += dr.consumed;
    const osmId = prevOsm + zigzagDecode(dr.value);
    prevOsm = osmId;

    const flags = rec[rp++];
    let vc = (flags >> 4) & 0x0f;
    if (vc === 0x0f) vc = rec[rp++];
    else vc += 4;
    if (vc === 0 || rp + 4 > rec.length) {
      p += rl;
      continue;
    }

    const fl = i16(new DataView(rec.buffer, rec.byteOffset + rp, 2), 0);
    const fa = i16(new DataView(rec.buffer, rec.byteOffset + rp + 2, 2), 0);
    rp += 4;
    let prevLon = cx + fl;
    let prevLat = cy + fa;
    const coords: number[][] = [[prevLon / 100000, prevLat / 100000]];
    for (let w = 1; w < vc; w++) {
      const r1 = decodeVarint(rec, rp);
      rp += r1.consumed;
      const r2 = decodeVarint(rec, rp);
      rp += r2.consumed;
      prevLon += zigzagI32(r1.value);
      prevLat += zigzagI32(r2.value);
      coords.push([prevLon / 100000, prevLat / 100000]);
    }
    if (rp >= rec.length) {
      p += rl;
      continue;
    }

    // Building type (string-table index or inline 0xff).
    const bt = rec[rp++];
    let btype: string;
    if (bt === 0xff) {
      const slen = rec[rp];
      btype = new TextDecoder().decode(rec.subarray(rp + 1, rp + 1 + slen));
      rp += 1 + slen;
    } else {
      btype = bt < strings.length ? strings[bt] : "yes";
    }

    let name: string | null = null;
    let category: string | null = null;
    if (rp < rec.length) {
      const f2 = rec[rp++];
      if (f2 & 0x01 && rp < rec.length) {
        const idx = rec[rp++];
        if (idx === 0xff) {
          const slen = rec[rp];
          name = new TextDecoder().decode(rec.subarray(rp + 1, rp + 1 + slen));
          rp += 1 + slen;
        } else {
          name = idx < strings.length ? strings[idx] : null;
        }
      }
      if (f2 & 0x02 && rp < rec.length) {
        const idx = rec[rp++];
        if (idx === 0xff) {
          const slen = rec[rp];
          category = new TextDecoder().decode(rec.subarray(rp + 1, rp + 1 + slen));
          rp += 1 + slen;
        } else {
          category = idx < strings.length ? strings[idx] : null;
        }
      }
    }

    const cl = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const ca = coords.reduce((s, c) => s + c[1], 0) / coords.length;

    if (pointInPolygon(lat, lon, coords)) {
      return { osmId, buildingType: btype, name, category, coordinates: coords, centroidLat: ca, centroidLon: cl, inPoly: true };
    }
    const d = haversineMeters(lat, lon, ca, cl);
    if (d < bestDist) {
      bestDist = d;
      best = { osmId, buildingType: btype, name, category, coordinates: coords, centroidLat: ca, centroidLon: cl, inPoly: false };
    }
    p += rl;
  }

  return bestDist < NEAREST_LIMIT_METERS ? best : null;
}
