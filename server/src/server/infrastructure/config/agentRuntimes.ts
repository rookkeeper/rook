import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getConfigDir } from "./configPaths.js";

export type AgentRuntimeType = "pi" | "claude" | "cursor" | "acp";

/** A concrete runtime the user explicitly opted into. */
export interface AgentRuntimeProfile {
  id: string;
  type: AgentRuntimeType;
  parentId?: string | null;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  skillPaths?: string[];
  extensionPaths?: string[];
  startupTimeoutMs?: number;
  mcpServers?: Array<Record<string, unknown>>;
  model?: string;
}

export function getAgentRuntimesPath(): string {
  return process.env.ROOK_AGENT_RUNTIMES_PATH ?? path.join(getConfigDir(), "agent-runtimes.json");
}

/**
 * Loads only concrete user-configured runtimes. There are deliberately no
 * implicit Pi/Claude/Cursor parents in this catalog.
 */
export function loadAgentRuntimes(): AgentRuntimeProfile[] {
  const configPath = getAgentRuntimesPath();
  if (!existsSync(configPath)) return [];
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { profiles?: unknown };
  if (!Array.isArray(parsed.profiles)) return [];
  return parsed.profiles.filter((value): value is AgentRuntimeProfile => validProfile(value));
}

function validProfile(value: unknown): value is AgentRuntimeProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const profile = value as Partial<AgentRuntimeProfile>;
  if (typeof profile.id !== "string" || profile.id.trim().length === 0) return false;
  if (profile.type !== "pi" && profile.type !== "claude" && profile.type !== "cursor" && profile.type !== "acp") return false;
  if (profile.command !== undefined && typeof profile.command !== "string") return false;
  if (profile.cwd !== undefined && typeof profile.cwd !== "string") return false;
  if (profile.model !== undefined && typeof profile.model !== "string") return false;
  if (profile.startupTimeoutMs !== undefined && (typeof profile.startupTimeoutMs !== "number" || profile.startupTimeoutMs <= 0)) return false;
  if (!validStrings(profile.args) || !validStrings(profile.skillPaths) || !validStrings(profile.extensionPaths)) return false;
  if (profile.env !== undefined && (typeof profile.env !== "object" || profile.env === null || Array.isArray(profile.env) || Object.values(profile.env).some((item) => typeof item !== "string"))) return false;
  if (profile.mcpServers !== undefined && (!Array.isArray(profile.mcpServers) || profile.mcpServers.some((item) => typeof item !== "object" || item === null || Array.isArray(item)))) return false;
  return true;
}

function validStrings(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}
