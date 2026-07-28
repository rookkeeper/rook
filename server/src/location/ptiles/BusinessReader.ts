import { gridRing, latLngToCell } from "h3-js";
import { haversineMeters } from "./geo.js";
import type { PtilesRangeSource } from "./PtilesRangeSource.js";
import { decodeVarint, u16, u32, zigzagDecode } from "./ptilesFormat.js";

export interface BusinessRecord {
  uid: number;
  name: string;
  category: string;
  brand: string;
  chainCount: number;
  phone: string;
  website: string;
  address: string;
  lat: number;
  lon: number;
}

export interface BusinessMatch extends BusinessRecord {
  distance: number;
}

/** Decode all business records in a decompressed block (port of `_decodeRecords`). */
export function decodeBusinessRecords(raw: Uint8Array): BusinessRecord[] {
  const records: BusinessRecord[] = [];
  let prevUid = 0;
  let p = 0;
  while (p + 4 <= raw.length) {
    const rl = u32(new DataView(raw.buffer, raw.byteOffset + p, 4), 0);
    p += 4;
    if (p + rl > raw.length) break;
    const rec = raw.subarray(p, p + rl);
    let rp = 0;
    try {
      const dr = decodeVarint(rec, rp);
      rp += dr.consumed;
      const uid = prevUid + zigzagDecode(dr.value);
      prevUid = uid;
      if (rp + 8 > rec.length) {
        p += rl;
        continue;
      }
      const dv = new DataView(rec.buffer, rec.byteOffset + rp, 8);
      const bizLon = dv.getInt32(0, true) / 100000;
      const bizLat = dv.getInt32(4, true) / 100000;
      rp += 8;
      if (rp + 2 > rec.length) {
        p += rl;
        continue;
      }
      const nlen = u16(new DataView(rec.buffer, rec.byteOffset + rp, 2), 0);
      rp += 2;
      const name = new TextDecoder().decode(rec.subarray(rp, rp + nlen));
      rp += nlen;
      if (rp >= rec.length) {
        p += rl;
        continue;
      }
      const catIdx = rec[rp++];
      if (rp >= rec.length) {
        p += rl;
        continue;
      }
      const flags = rec[rp++];
      let phone = "";
      let website = "";
      let address = "";
      let brand = "";
      let chainCount = 0;
      if (flags & 0x01 && rp < rec.length) {
        const plen = rec[rp++];
        phone = new TextDecoder().decode(rec.subarray(rp, rp + plen));
        rp += plen;
      }
      if (flags & 0x02 && rp < rec.length) {
        const wlen = rec[rp++];
        website = new TextDecoder().decode(rec.subarray(rp, rp + wlen));
        rp += wlen;
      }
      if (flags & 0x04 && rp + 2 <= rec.length) {
        const alen = u16(new DataView(rec.buffer, rec.byteOffset + rp, 2), 0);
        rp += 2;
        address = new TextDecoder().decode(rec.subarray(rp, rp + alen));
        rp += alen;
      }
      if (flags & 0x08 && rp < rec.length) {
        const blen = rec[rp++];
        brand = new TextDecoder().decode(rec.subarray(rp, rp + blen));
        rp += blen;
      }
      if (flags & 0x80 && rp < rec.length) chainCount = rec[rp++];
      records.push({ uid, name, category: "(cat:" + catIdx + ")", brand, chainCount, phone, website, address, lat: bizLat, lon: bizLon });
    } catch {
      // skip malformed record
    }
    p += rl;
  }
  return records;
}

/**
 * Business layer reader, ported from the demo's `BusinessReader.query`. Searches
 * the point's H3 cell plus its ring-1 neighbors, returning businesses within
 * `radiusKm` ordered by distance.
 */
export async function queryBusinesses(
  source: PtilesRangeSource,
  lat: number,
  lon: number,
  radiusKm = 0.05,
): Promise<BusinessMatch[]> {
  const cellHex = latLngToCell(lat, lon, 7);
  const cells = [cellHex];
  try {
    cells.push(...gridRing(cellHex, 1));
  } catch {
    // ring unavailable; center cell only
  }

  const results: BusinessMatch[] = [];
  for (const cell of cells) {
    const raw = await source.blockForCell(cell);
    if (!raw) continue;
    for (const br of decodeBusinessRecords(raw)) {
      const dist = haversineMeters(lat, lon, br.lat, br.lon);
      if (dist <= radiusKm * 1000) results.push({ ...br, distance: dist });
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results;
}
