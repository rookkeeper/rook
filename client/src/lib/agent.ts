export type AgentBackend = string;

export interface AgentDefinition {
  id: string;
  parentId: string | null;
}

export interface AgentSessionSummary {
  id: string;
  agent: string;
  name?: string;
  createdAt: string;
  restart: Record<string, unknown>;
  running?: boolean;
  connectedClients?: number;
}

export type AgentRunStatus = "idle" | "busy" | "thinking" | "streaming" | "using_tool" | "retrying" | "queued" | "error";
