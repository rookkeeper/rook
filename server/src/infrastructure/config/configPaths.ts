import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SERVER_ROOT } from "../paths.js";

const CONFIG_FILENAMES = ["agent-profiles.json"] as const;

export function getRookHomeDir(): string {
  return process.env.ROOK_HOME ?? path.join(os.homedir(), ".rook");
}

export function getConfigDir(): string {
  return process.env.ROOK_CONFIG_DIR ?? path.join(getRookHomeDir(), "config");
}

export function getLegacyServerConfigDir(): string {
  return process.env.ROOK_LEGACY_SERVER_CONFIG_DIR ?? path.join(SERVER_ROOT, "config");
}

export function getAgentProfilesPath(): string {
  return path.join(getConfigDir(), "agent-profiles.json");
}

export function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true });
}

export function migrateLegacyConfigIfNeeded(): void {
  const legacyDir = getLegacyServerConfigDir();
  if (!existsSync(legacyDir)) return;

  ensureConfigDir();
  for (const filename of CONFIG_FILENAMES) {
    const sourcePath = path.join(legacyDir, filename);
    const targetPath = path.join(getConfigDir(), filename);
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}
