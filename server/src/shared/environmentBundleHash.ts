import crypto from "node:crypto";
import type { EnvironmentBundle } from "./environmentRepository.js";

/** Hashes canonical agent-visible bundle content, independent of storage paths. */
export function hashEnvironmentBundle(bundle: EnvironmentBundle): string {
  const hash = crypto.createHash("sha256");
  hash.update("rook-environment-bundle-content-v3\n");
  for (const [groupName, artifacts] of [
    ["skills", bundle.skills],
    ["mcp-servers", bundle.mcpServers],
    ["apps", bundle.apps],
  ] as const) {
    hash.update(`${groupName}\u0000`);
    for (const artifact of [...artifacts].sort((a, b) => a.id.localeCompare(b.id))) {
      hash.update(`${artifact.id}\u0000`);
      for (const filePath of Object.keys(artifact.files).sort((a, b) => a.localeCompare(b))) {
        hash.update(`${filePath}\u0000${artifact.files[filePath]}\u0000`);
      }
    }
  }
  hash.update(`agents-md\u0000${bundle.agentsMd ?? ""}\u0000`);
  return hash.digest("hex");
}
