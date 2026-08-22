import { readFileSync } from "node:fs";
import path from "node:path";
import { SERVER_ROOT } from "./paths.js";

function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Version declared in `server/package.json`, read once at import; `"0.0.0"` when unreadable. */
export const SERVER_VERSION = readServerVersion();
