import {
  blockOffsetsAreRelative,
  parsePtilesHeader,
  parsePtilesIndex,
  RES7_MASK,
  type PtilesHeader,
  type PtilesIndex,
} from "./ptilesFormat.js";
import { decompressBlock } from "./zstdBlock.js";

/** Fetches an inclusive byte range for a file. Wired to the proxy route. */
export type FetchRange = (file: string, start: number, endInclusive: number) => Promise<{ status: number; body: Uint8Array }>;

/**
 * Low-level accessor for a single `.ptiles` file, reading only the byte ranges
 * it needs (header, dict, index, individual blocks, or arbitrary aux ranges)
 * through an injected range-fetcher. Header/dict/index are cached for the
 * file's lifetime; decompressed blocks are cached in a small LRU.
 */
export class PtilesRangeSource {
  header?: PtilesHeader;
  private dict?: Uint8Array;
  private index?: PtilesIndex;
  private relOff = false;
  private blockCache = new Map<string, Uint8Array>();
  private static MAX_BLOCKS = 64;

  constructor(
    readonly file: string,
    private readonly fetchRange: FetchRange,
  ) {}

  async init(): Promise<void> {
    if (this.header) return;
    this.header = parsePtilesHeader(await this.read(0, 255));
  }

  private requireHeader(): PtilesHeader {
    if (!this.header) throw new Error("PtilesRangeSource not initialized");
    return this.header;
  }

  /** Read an inclusive byte range, tolerating 200 (full) or 206 (partial). */
  async read(start: number, endInclusive: number): Promise<Uint8Array> {
    const { status, body } = await this.fetchRange(this.file, start, endInclusive);
    if (status !== 206 && status !== 200) {
      throw new Error(`Range fetch for ${this.file} returned ${status}`);
    }
    return body;
  }

  /** Raw (still-compressed) dictionary / string-table section. */
  async dictSection(): Promise<Uint8Array> {
    const h = this.requireHeader();
    if (h.dictLength === 0) return new Uint8Array(0);
    if (!this.dict) this.dict = await this.read(h.dictOffset, h.dictOffset + h.dictLength - 1);
    return this.dict;
  }

  async getIndex(): Promise<PtilesIndex> {
    const h = this.requireHeader();
    if (!this.index) {
      const section = await this.read(h.indexOffset, h.indexOffset + h.indexLength - 1);
      this.index = parsePtilesIndex(section);
      this.relOff = blockOffsetsAreRelative(this.index, h);
    }
    return this.index;
  }

  /** Decompress the data block for an H3 cell (res-7 masked), or null if absent. */
  async blockForCell(cellHex: string): Promise<Uint8Array | null> {
    const cached = this.blockCache.get(cellHex);
    if (cached) return cached;

    const h = this.requireHeader();
    const index = await this.getIndex();
    const cellInt = BigInt("0x" + cellHex) & RES7_MASK;
    const ei = index.cellMap.get(cellInt);
    if (ei === undefined) return null;

    const entry = index.entries[ei];
    const abs = this.relOff ? h.blocksOffset + entry.blockOffset : entry.blockOffset;
    const compressed = await this.read(abs, abs + entry.blockLength - 1);
    const dict = await this.dictSection();
    const raw = decompressBlock(compressed, dict);

    this.blockCache.set(cellHex, raw);
    if (this.blockCache.size > PtilesRangeSource.MAX_BLOCKS) {
      this.blockCache.delete(this.blockCache.keys().next().value as string);
    }
    return raw;
  }
}
