/**
 * Binary decoders for the PTILES v7/v8 format, ported from the steele.red/ptiles
 * demo (inline JS) and the schema at ~/pcode/ptiles/schema/ptiles.schema.v7.md.
 *
 * Layout: 256-byte header, then dictionary/string-table section, an H3 spatial
 * index (cell -> block offset/length), and zstd-compressed per-cell data blocks
 * (plus an optional uncompressed auxiliary section, used by the admin layer).
 */

/** Mask that reduces an H3 cell to its resolution-7 base for index lookup. */
export const RES7_MASK = 0xffffffffffe00000n;

export interface PtilesHeader {
  format: string;
  version: number;
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
  featureCount: number;
  blockCount: number;
  dictOffset: number;
  dictLength: number;
  indexOffset: number;
  indexLength: number;
  blocksOffset: number;
  auxOffset: number;
  auxLength: number;
}

export interface PtilesIndexEntry {
  h3Cell: bigint;
  blockOffset: number;
  blockLength: number;
  featureCount: number;
}

export interface PtilesIndex {
  entries: PtilesIndexEntry[];
  /** res-7-masked cell -> entry index. */
  cellMap: Map<bigint, number>;
}

// --- Little-endian primitive readers (mirror the demo's u16/i16/... helpers) ---
export function u16(v: DataView, o: number): number {
  return v.getUint16(o, true);
}
export function i16(v: DataView, o: number): number {
  return v.getInt16(o, true);
}
export function i32(v: DataView, o: number): number {
  return v.getInt32(o, true);
}
export function u32(v: DataView, o: number): number {
  return v.getUint32(o, true);
}
export function u64(v: DataView, o: number): number {
  return v.getUint32(o, true) + v.getUint32(o + 4, true) * 0x100000000;
}
export function f32(v: DataView, o: number): number {
  return v.getFloat32(o, true);
}

/** Read `len` little-endian bytes as an unsigned integer. */
export function readPacked(data: Uint8Array, off: number, len: number): number {
  let r = 0;
  for (let i = 0; i < len; i++) r += data[off + i] * 2 ** (i * 8);
  return r;
}

/** Decode a LEB128 varint starting at `start`. Returns value + bytes consumed. */
export function decodeVarint(data: Uint8Array, start: number): { value: bigint; consumed: number } {
  let r = 0n;
  let s = 0n;
  let p = start;
  while (p < data.length) {
    const b = data[p++];
    r |= BigInt(b & 0x7f) << s;
    if ((b & 0x80) === 0) break;
    s += 7n;
  }
  return { value: r, consumed: p - start };
}

/** Zig-zag decode a 32-bit delta (used for polygon coordinate deltas). */
export function zigzagI32(n: bigint): number {
  return (Number(n & 0xffffffffn) >>> 1) ^ -(Number(n & 0xffffffffn) & 1);
}

/** Zig-zag decode a 64-bit value (used for osm/uid deltas). */
export function zigzagDecode(n: bigint): number {
  return Number(BigInt.asIntN(64, n >> 1n) ^ BigInt.asIntN(64, -(n & 1n)));
}

export function parsePtilesHeader(buf: Uint8Array): PtilesHeader {
  const dv = new DataView(buf.buffer, buf.byteOffset, 256);
  return {
    format: String.fromCharCode(buf[6]),
    version: dv.getUint8(8),
    minLat: f32(dv, 12),
    minLon: f32(dv, 16),
    maxLat: f32(dv, 20),
    maxLon: f32(dv, 24),
    featureCount: u64(dv, 28),
    blockCount: u32(dv, 36),
    dictOffset: u64(dv, 40),
    dictLength: u32(dv, 48),
    indexOffset: u64(dv, 52),
    indexLength: u32(dv, 60),
    blocksOffset: u64(dv, 64),
    auxOffset: u64(dv, 72),
    auxLength: u32(dv, 80),
  };
}

/** Parse the spatial index from a buffer holding exactly the index section. */
export function parsePtilesIndex(indexSection: Uint8Array): PtilesIndex {
  const dv = new DataView(indexSection.buffer, indexSection.byteOffset, indexSection.length);
  const cnt = u32(dv, 0);
  const entries: PtilesIndexEntry[] = [];
  const cellMap = new Map<bigint, number>();
  let off = 4;
  for (let i = 0; i < cnt && off + 19 <= indexSection.length; i++) {
    let cb = 0n;
    for (let j = 0; j < 8; j++) cb |= BigInt(indexSection[off + j]) << BigInt(j * 8);
    const bo = readPacked(indexSection, off + 8, 6);
    const bl = readPacked(indexSection, off + 14, 3);
    const fc = u16(dv, off + 17);
    entries.push({ h3Cell: cb, blockOffset: bo, blockLength: bl, featureCount: fc });
    cellMap.set(cb & RES7_MASK, i);
    off += 19;
  }
  return { entries, cellMap };
}

/**
 * Whether block offsets in the index are relative to `blocksOffset` (the demo's
 * `relOff` heuristic: the first entry's offset is below the blocks section).
 */
export function blockOffsetsAreRelative(index: PtilesIndex, header: PtilesHeader): boolean {
  return index.entries.length > 0 && index.entries[0].blockOffset < header.blocksOffset;
}
