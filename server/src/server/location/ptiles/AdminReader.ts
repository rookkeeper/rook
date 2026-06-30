import { latLngToCell } from "h3-js";
import type { PtilesRangeSource } from "./PtilesRangeSource.js";
import { u16, u32 } from "./ptilesFormat.js";
import { decompressBlock } from "./zstdBlock.js";

const GRID_ENTRY_SIZE = 16; // 8 (cell) + 1 country + 1 state + 2 county + 2 zip + 1 tz + 1 flags

export interface AdminResult {
  country?: string;
  state?: string;
  county?: string;
  zip?: string;
  timezone?: string;
}

interface StringTables {
  country: string[];
  state: string[];
  county: string[];
  zip: string[];
  tz: string[];
}

function decodeStringTable(data: Uint8Array, pos: number): { strings: string[]; consumed: number } {
  const start = pos;
  const dv = new DataView(data.buffer, data.byteOffset, data.length);
  const count = u32(dv, pos);
  pos += 4;
  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    const slen = u16(dv, pos);
    pos += 2;
    strings.push(new TextDecoder().decode(data.subarray(pos, pos + slen)));
    pos += slen;
  }
  return { strings, consumed: pos - start };
}

function decodeAllStringTables(data: Uint8Array): StringTables {
  let pos = 0;
  const country = decodeStringTable(data, pos);
  pos += country.consumed;
  const state = decodeStringTable(data, pos);
  pos += state.consumed;
  const county = decodeStringTable(data, pos);
  pos += county.consumed;
  const zip = decodeStringTable(data, pos);
  pos += zip.consumed;
  const tz = decodeStringTable(data, pos);
  return { country: country.strings, state: state.strings, county: county.strings, zip: zip.strings, tz: tz.strings };
}

/**
 * Resolves country/state/county/zip/timezone for a coordinate from
 * `US.admin.ptiles`, ported from `read_admin.py`. The string tables live in the
 * (plain-zstd) dict section; the lookup grid is the uncompressed aux section,
 * binary-searched here via tiny 16-byte range reads so the whole grid is never
 * downloaded.
 */
export class AdminReader {
  private tables?: StringTables;
  private entryCount?: number;

  constructor(private readonly source: PtilesRangeSource) {}

  private async ensureLoaded(): Promise<void> {
    await this.source.init();
    if (!this.tables) {
      this.tables = decodeAllStringTables(decompressBlock(await this.source.dictSection()));
    }
    if (this.entryCount === undefined) {
      const h = this.source.header!;
      const head = await this.source.read(h.auxOffset, h.auxOffset + 3);
      this.entryCount = u32(new DataView(head.buffer, head.byteOffset, 4), 0);
    }
  }

  async query(lat: number, lon: number): Promise<AdminResult | null> {
    await this.ensureLoaded();
    const tables = this.tables!;
    const h = this.source.header!;
    const cellInt = BigInt("0x" + latLngToCell(lat, lon, 7));

    // Binary search the grid via 16-byte range reads.
    let left = 0;
    let right = (this.entryCount ?? 0) - 1;
    let entry: Uint8Array | null = null;
    while (left <= right) {
      const mid = (left + right) >> 1;
      const pos = h.auxOffset + 4 + mid * GRID_ENTRY_SIZE;
      const buf = await this.source.read(pos, pos + GRID_ENTRY_SIZE - 1);
      let midCell = 0n;
      for (let j = 0; j < 8; j++) midCell |= BigInt(buf[j]) << BigInt(j * 8);
      if (midCell === cellInt) {
        entry = buf;
        break;
      } else if (midCell < cellInt) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    if (!entry) return null;

    const dv = new DataView(entry.buffer, entry.byteOffset, entry.length);
    const countryIdx = entry[8];
    const stateIdx = entry[9];
    const countyIdx = u16(dv, 10);
    const zipIdx = u16(dv, 12);
    const tzIdx = entry[14];

    const result: AdminResult = {};
    if (countryIdx < tables.country.length) result.country = tables.country[countryIdx];
    if (stateIdx < tables.state.length) result.state = tables.state[stateIdx];
    if (countyIdx < tables.county.length) result.county = tables.county[countyIdx];
    if (zipIdx < tables.zip.length) result.zip = tables.zip[zipIdx];
    if (tzIdx < tables.tz.length) result.timezone = tables.tz[tzIdx];
    return result;
  }
}
