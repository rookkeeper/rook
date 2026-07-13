import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AgentRuntimeProfile {
  id: string;
  type: "pi" | "claude" | "acp" | "cursor";
  parentId?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  model?: string;
}

export function agentRuntimesPath(): string {
  return process.env.ROOK_AGENT_RUNTIMES_PATH ?? path.join(os.homedir(), ".rook", "config", "agent-runtimes.json");
}

export function loadAgentRuntimeProfiles(): AgentRuntimeProfile[] {
  const configPath = agentRuntimesPath();
  if (!existsSync(configPath)) return [];
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { profiles?: unknown };
  if (!Array.isArray(parsed.profiles)) return [];
  return parsed.profiles.filter((value): value is AgentRuntimeProfile => {
    if (typeof value !== "object" || value === null) return false;
    const profile = value as Partial<AgentRuntimeProfile>;
    return typeof profile.id === "string"
      && profile.id.length > 0
      && (profile.type === "pi" || profile.type === "claude" || profile.type === "acp" || profile.type === "cursor")
      && (profile.command === undefined || typeof profile.command === "string")
      && (profile.args === undefined || (Array.isArray(profile.args) && profile.args.every((arg) => typeof arg === "string")));
  });
}
