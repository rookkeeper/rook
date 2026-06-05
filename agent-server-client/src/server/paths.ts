import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

function findAgentClientRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "agent-server-client") return current;
      } catch {
        // Keep walking if this is not a readable JSON package file.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir, "../..");
    current = parent;
  }
}

/** `agent-server-client/` package root. */
export const AGENT_CLIENT_ROOT = findAgentClientRoot(serverDir);

/** Monorepo root (parent of `agent-server-client/`). */
export const REPO_ROOT = path.resolve(AGENT_CLIENT_ROOT, "..");
