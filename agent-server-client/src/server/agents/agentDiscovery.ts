import { REPO_ROOT } from "../paths.js";
import { AGENT_PROFILES } from "../config/agentProfiles.js";
import { BaseAgent } from "./BaseAgent.js";
import { MockAgent } from "./MockAgent.js";
import { PiAgent, PiAgentOptions } from "./PiAgent.js";
import { AgentRestartMetadata } from "./sessionLog.js";

export interface AgentDefinition {
  id: string;
  parentId: string | null;
}

export interface AgentCreateOptions {
  skillPaths?: string[];
  extensionPaths?: string[];
}

type AgentFactory = (restartMetadata?: AgentRestartMetadata, options?: AgentCreateOptions) => BaseAgent;

type AgentRegistryEntry = {
  id: string;
  parentId: string | null;
  create: AgentFactory;
};

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))];
}

function createPiAgent(restartMetadata: AgentRestartMetadata | undefined, options: PiAgentOptions): BaseAgent {
  return new PiAgent(options, restartMetadata);
}

const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    id: "MockAgent",
    parentId: null,
    create: (restartMetadata) => new MockAgent(restartMetadata),
  },
  {
    id: "PiAgent",
    parentId: null,
    create: (restartMetadata, options) => createPiAgent(restartMetadata, {
      cwd: REPO_ROOT,
      agentName: "PiAgent",
      skillPaths: uniqueNonEmpty(options?.skillPaths),
      extensionPaths: uniqueNonEmpty(options?.extensionPaths),
    } satisfies PiAgentOptions),
  },
  ...AGENT_PROFILES.map((profile): AgentRegistryEntry => ({
    id: profile.id,
    parentId: profile.parentId ?? "PiAgent",
    create: (restartMetadata, options) => createPiAgent(restartMetadata, {
      cwd: profile.cwd ?? REPO_ROOT,
      args: profile.args,
      agentName: profile.id,
      skillPaths: uniqueNonEmpty([...(profile.skillPaths ?? []), ...(options?.skillPaths ?? [])]),
      extensionPaths: uniqueNonEmpty([...(profile.extensionPaths ?? []), ...(options?.extensionPaths ?? [])]),
    } satisfies PiAgentOptions),
  })),
];

function findAgentEntry(id: string): AgentRegistryEntry | undefined {
  return AGENT_REGISTRY.find((entry) => entry.id === id);
}

export function getAgentDefinitions(): AgentDefinition[] {
  return AGENT_REGISTRY.map(({ id, parentId }) => ({ id, parentId }));
}

export function isKnownAgent(id: string): boolean {
  return findAgentEntry(id) !== undefined;
}

export function createAgent(id: string, restartMetadata?: AgentRestartMetadata, options?: AgentCreateOptions): BaseAgent {
  const entry = findAgentEntry(id);
  if (!entry) throw new Error(`Unknown agent: ${id}`);
  return entry.create(restartMetadata, options);
}
