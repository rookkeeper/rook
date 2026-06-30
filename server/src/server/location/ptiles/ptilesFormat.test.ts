// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodeVarint,
  parsePtilesHeader,
  parsePtilesIndex,
  readPacked,
  RES7_MASK,
  zigzagDecode,
  zigzagI32,
} from "./ptilesFormat.js";

describe("ptiles primitives", () => {
  it("decodes LEB128 varints", () => {
    expect(decodeVarint(new Uint8Array([0x00]), 0)).toEqual({ value: 0n, consumed: 1 });
    expect(decodeVarint(new Uint8Array([0x7f]), 0)).toEqual({ value: 127n, consumed: 1 });
    // 300 = 0b100101100 -> 0xac 0x02
    expect(decodeVarint(new Uint8Array([0xac, 0x02]), 0)).toEqual({ value: 300n, consumed: 2 });
  });

  it("zig-zag decodes signed values", () => {
    expect(zigzagDecode(0n)).toBe(0);
    expect(zigzagDecode(1n)).toBe(-1);
    expect(zigzagDecode(2n)).toBe(1);
    expect(zigzagI32(0n)).toBe(0);
    expect(zigzagI32(1n)).toBe(-1);
    expect(zigzagI32(4n)).toBe(2);
  });

  it("reads packed little-endian integers beyond 32 bits", () => {
    const data = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x01]); // 6 bytes
    expect(readPacked(data, 0, 3)).toBe(1);
    expect(readPacked(data, 0, 6)).toBe(1 + 0x010000000000);
  });

  it("parses a synthetic header", () => {
    const buf = new Uint8Array(256);
    const dv = new DataView(buf.buffer);
    buf.set([0x50, 0x54, 0x49, 0x4c, 0x45, 0x53, 0x46, 0x00], 0); // "PTILESF\0"
    dv.setUint8(8, 8); // version
    dv.setUint32(36, 5, true); // blockCount
    dv.setUint32(40, 100, true); // dictOffset (u64 low)
    dv.setUint32(48, 16, true); // dictLength
    dv.setUint32(52, 200, true); // indexOffset
    dv.setUint32(60, 32, true); // indexLength
    dv.setUint32(64, 300, true); // blocksOffset
    const h = parsePtilesHeader(buf);
    expect(h.format).toBe("F");
    expect(h.version).toBe(8);
    expect(h.blockCount).toBe(5);
    expect(h.dictOffset).toBe(100);
    expect(h.indexOffset).toBe(200);
    expect(h.blocksOffset).toBe(300);
  });

  it("parses an index and masks cells to res-7", () => {
    // One entry: cell, blockOffset(6), blockLength(3), featureCount(2) = 19 bytes after the count.
    const section = new Uint8Array(4 + 19);
    const dv = new DataView(section.buffer);
    dv.setUint32(0, 1, true); // count
    const cell = 0x87264d106ffffffn;
    for (let j = 0; j < 8; j++) section[4 + j] = Number((cell >> BigInt(j * 8)) & 0xffn);
    section[4 + 8] = 50; // blockOffset low byte
    section[4 + 14] = 10; // blockLength low byte
    dv.setUint16(4 + 17, 3, true); // featureCount
    const idx = parsePtilesIndex(section);
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0].blockOffset).toBe(50);
    expect(idx.entries[0].blockLength).toBe(10);
    expect(idx.entries[0].featureCount).toBe(3);
    expect(idx.cellMap.get(cell & RES7_MASK)).toBe(0);
  });
});
