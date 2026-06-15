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

export interface AgentToolCallStartedEvent {
  toolCallId: string;
  toolName: string;
  rawInput?: string;
}

export interface AgentToolInputDeltaEvent {
  toolCallId: string;
  toolName?: string;
  delta: string;
}

export interface AgentToolCallReadyEvent {
  toolCallId: string;
  toolName?: string;
}
