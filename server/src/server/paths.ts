import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from `startDir` until we find a directory containing `package.json` named `rookery-server`. */
function findServerRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (pkg.name === "rookery-server") return current;
      } catch {
        // keep walking
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // In production builds (rootDir: "..") the compiled files live under dist/.
      // When the package root is unreachable by name, fall back to a fixed depth.
      // Four levels from the server entry point in source: server/src/server/ → server/
      return path.resolve(startDir, "..", "..", "..", "..");
    }
    current = parent;
  }
}

/** Monorepo root — walks up from the server package root. */
function findRepoRoot(serverRoot: string): string {
  // Walk up from serverRoot to find the top-level package.json (rook).
  let current = serverRoot;
  while (true) {
    const parent = path.dirname(current);
    const grandparent = path.dirname(parent);

    // If parent has a top-level package.json, stop at parent.
    if (existsSync(path.join(parent, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(parent, "package.json"), "utf8")) as { name?: string };
        if (pkg.name === "rook") return parent;
      } catch {
        // keep walking
      }
    }

    // Safety: don't walk beyond the filesystem root.
    if (grandparent === parent || parent === current) {
      // Fallback: assume serverRoot is inside a monorepo and repo root is one up.
      return path.resolve(serverRoot, "..");
    }
    current = parent;
  }
}

/** Server package root (`server/`). */
export const SERVER_ROOT = findServerRoot(serverDir);

/** Monorepo root (parent of `server/`). */
export const REPO_ROOT = findRepoRoot(SERVER_ROOT);

