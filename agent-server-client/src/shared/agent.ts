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

export interface AgentStatusChangedEvent {
  status: AgentRunStatus;
  message?: string;
}

export interface UserMessageAcceptedEvent {
  id?: string;
  text: string;
  queued?: boolean;
}

export interface AssistantMessageEvent {
  id?: string;
  model?: string;
  provider?: string;
}

export interface AssistantMessageErrorEvent {
  error: string;
}

export interface AgentTextDeltaEvent {
  delta: string;
}

export interface AgentThinkingDeltaEvent {
  delta: string;
}

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

export interface AgentToolRunningEvent {
  toolCallId: string;
}

export interface AgentToolOutputDeltaEvent {
  toolCallId: string;
  toolName?: string;
  delta: string;
}

export interface AgentToolCompletedEvent {
  toolCallId: string;
  toolName: string;
  output: string;
}

export interface AgentToolErrorEvent {
  toolCallId: string;
  toolName: string;
  error: string;
}

export interface AgentRunFailedEvent {
  error: string;
}

export interface AgentProtocolErrorEvent {
  error: string;
}
