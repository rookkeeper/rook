import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_CLIENT_ROOT } from "../paths.js";

export interface AgentProfile {
  id: string;
  type: "pi";
  parentId?: string | null;
  args?: string[];
  cwd?: string;
  skillPaths?: string[];
  extensionPaths?: string[];
}

type AgentProfilesFile = {
  profiles?: AgentProfile[];
};

const AGENT_PROFILES_PATH = path.join(AGENT_CLIENT_ROOT, "config", "agent-profiles.json");

export function loadAgentProfiles(): AgentProfile[] {
  if (!existsSync(AGENT_PROFILES_PATH)) return [];
  const raw = readFileSync(AGENT_PROFILES_PATH, "utf8");
  const parsed = JSON.parse(raw) as AgentProfilesFile;
  if (!Array.isArray(parsed.profiles)) return [];

  return parsed.profiles.filter((profile): profile is AgentProfile => (
    typeof profile?.id === "string"
    && profile.id.length > 0
    && profile.type === "pi"
  ));
}

export const AGENT_PROFILES = loadAgentProfiles();
