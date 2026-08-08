import os from "node:os";
import path from "node:path";

export function getRookHomeDir(): string {
  return process.env.ROOK_HOME ?? path.join(os.homedir(), ".rook");
}

export function getConfigDir(): string {
  return process.env.ROOK_CONFIG_DIR ?? path.join(getRookHomeDir(), "config");
}
