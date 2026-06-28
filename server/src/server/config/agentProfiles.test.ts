import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentProfiles } from "./agentProfiles";
import { getAgentProfilesPath } from "./configPaths";

let tempRoot: string | null = null;

function setupConfigDirs(): { configDir: string; legacyConfigDir: string } {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "rook-config-test-"));
  const configDir = path.join(tempRoot, "home-config");
  const legacyConfigDir = path.join(tempRoot, "legacy-config");
  process.env.ROOK_CONFIG_DIR = configDir;
  process.env.ROOK_LEGACY_SERVER_CONFIG_DIR = legacyConfigDir;
  return { configDir, legacyConfigDir };
}

describe("loadAgentProfiles", () => {
  afterEach(() => {
    delete process.env.ROOK_CONFIG_DIR;
    delete process.env.ROOK_LEGACY_SERVER_CONFIG_DIR;
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it("returns an empty list when no config file exists", () => {
    setupConfigDirs();
    expect(loadAgentProfiles()).toEqual([]);
  });

  it("keeps valid pi/acp profiles and drops invalid ones", () => {
    const { configDir } = setupConfigDirs();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "agent-profiles.json"), JSON.stringify({
      profiles: [
        { id: "MyPiOpenAiAgent", type: "pi", args: ["-e", "../my-agent", "--model", "openai/gpt-4o"], startupTimeoutMs: 5000 },
        { id: "MyClaudeAgent", type: "claude", command: "claude", args: ["--add-dir", "../workspace"], mcpServers: [{ name: "docs", command: "npx" }] },
        { id: "Worker", type: "acp", command: "node", env: { FOO: "bar" } },
        { id: "", type: "pi" },
        { id: "BadEnv", type: "acp", env: { BAD: 123 } },
        { id: "BadArgs", type: "pi", args: ["ok", 1] },
        { id: "BadClaudeMcp", type: "claude", mcpServers: ["bad"] },
        { id: "BadType", type: "other" },
      ],
    }), "utf8");

    expect(loadAgentProfiles()).toEqual([
      { id: "MyPiOpenAiAgent", type: "pi", args: ["-e", "../my-agent", "--model", "openai/gpt-4o"], startupTimeoutMs: 5000 },
      { id: "MyClaudeAgent", type: "claude", command: "claude", args: ["--add-dir", "../workspace"], mcpServers: [{ name: "docs", command: "npx" }] },
      { id: "Worker", type: "acp", command: "node", env: { FOO: "bar" } },
    ]);
  });

  it("copies legacy config into ~/.rook/config on first load", () => {
    const { legacyConfigDir } = setupConfigDirs();
    mkdirSync(legacyConfigDir, { recursive: true });
    writeFileSync(path.join(legacyConfigDir, "agent-profiles.json"), JSON.stringify({
      profiles: [{ id: "MigratedAgent", type: "pi", args: ["-e", "../my-agent"] }],
    }), "utf8");

    expect(loadAgentProfiles()).toEqual([
      { id: "MigratedAgent", type: "pi", args: ["-e", "../my-agent"] },
    ]);
    expect(existsSync(getAgentProfilesPath())).toBe(true);
  });
});
