import zlib from "node:zlib";

/**
 * Decompress a zstd block, optionally using a trained dictionary. PTILES data
 * blocks (buildings/business) are compressed with the file's dictionary; the
 * admin layer's string-table section is compressed without one.
 *
 * Node 22+'s built-in zstd (node:zlib) supports the `dictionary` option.
 */
export function decompressBlock(compressed: Uint8Array, dict?: Uint8Array): Buffer {
  const options = dict && dict.length > 0 ? { dictionary: Buffer.from(dict) } : undefined;
  return zlib.zstdDecompressSync(Buffer.from(compressed), options);
}
