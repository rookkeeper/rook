import type {
  AgentRunStatus,
  AgentStatusChangedEvent,
  UserMessageAcceptedEvent,
  AssistantMessageEvent,
  AssistantMessageErrorEvent,
  AgentTextDeltaEvent,
  AgentThinkingDeltaEvent,
  AgentToolCallStartedEvent,
  AgentToolInputDeltaEvent,
  AgentToolCallReadyEvent,
  AgentToolRunningEvent,
  AgentToolOutputDeltaEvent,
  AgentToolCompletedEvent,
  AgentToolErrorEvent,
  AgentRunFailedEvent,
  AgentProtocolErrorEvent,
} from "./agent.js";
import type { AcpSessionUpdateNotification } from "./acp.js";

export type SessionEvent =
  | ({ type: "status_changed" } & AgentStatusChangedEvent)
  | ({ type: "user_message" } & UserMessageAcceptedEvent)
  | ({ type: "assistant_message_started" } & AssistantMessageEvent)
  | ({ type: "assistant_message_completed" } & AssistantMessageEvent)
  | ({ type: "assistant_message_error" } & AssistantMessageErrorEvent)
  | ({ type: "text_delta" } & AgentTextDeltaEvent)
  | ({ type: "thinking_delta" } & AgentThinkingDeltaEvent)
  | ({ type: "tool_call_started" } & AgentToolCallStartedEvent)
  | ({ type: "tool_input_delta" } & AgentToolInputDeltaEvent)
  | ({ type: "tool_call_ready" } & AgentToolCallReadyEvent)
  | ({ type: "tool_running" } & AgentToolRunningEvent)
  | ({ type: "tool_output_delta" } & AgentToolOutputDeltaEvent)
  | ({ type: "tool_completed" } & AgentToolCompletedEvent)
  | ({ type: "tool_error" } & AgentToolErrorEvent)
  | { type: "run_completed" }
  | ({ type: "run_failed" } & AgentRunFailedEvent)
  | ({ type: "protocol_error" } & AgentProtocolErrorEvent)
  | ({ type: "connection_error" } & AgentProtocolErrorEvent)
  | { type: "environment_event"; kind: string; payload?: unknown };

export type SessionEventType = SessionEvent["type"];

export const SESSION_EVENT_TYPES: SessionEventType[] = [
  "status_changed",
  "user_message",
  "assistant_message_started",
  "assistant_message_completed",
  "assistant_message_error",
  "text_delta",
  "thinking_delta",
  "tool_call_started",
  "tool_input_delta",
  "tool_call_ready",
  "tool_running",
  "tool_output_delta",
  "tool_completed",
  "tool_error",
  "run_completed",
  "run_failed",
  "protocol_error",
  "connection_error",
  "environment_event",
];

export function isSessionEventType(value: string): value is SessionEventType {
  return SESSION_EVENT_TYPES.includes(value as SessionEventType);
}

export function sessionEventTypeToRunStatus(type: SessionEventType): AgentRunStatus | null {
  switch (type) {
    case "status_changed":
      return "idle";
    case "thinking_delta":
      return "thinking";
    case "text_delta":
      return "streaming";
    case "tool_call_started":
    case "tool_input_delta":
    case "tool_call_ready":
    case "tool_running":
    case "tool_output_delta":
    case "tool_completed":
    case "tool_error":
      return "using_tool";
    case "run_failed":
    case "protocol_error":
    case "connection_error":
      return "error";
    default:
      return null;
  }
}

export type TextMessageUserEvent = {
  kind: "text_message";
  text: string;
};

export type UserEventPayload = TextMessageUserEvent;

export type UserEventMessage = {
  type: "user_event";
  requestId?: string;
  event: UserEventPayload;
};

export type SessionEventMessage = {
  type: "session_event";
  sessionId: string;
  sequence: number;
  event: SessionEvent;
};

export type EnvironmentEventPayload = {
  kind: string;
  payload?: unknown;
};

export type AckEventMessage = {
  type: "ack";
  requestId?: string;
};

export type ErrorEventMessage = {
  type: "error";
  requestId?: string;
  error: string;
};

export type AcpUpdateMessage = {
  type: "acp_update";
  notification: AcpSessionUpdateNotification;
};

export type OutboundRealtimeMessage = SessionEventMessage | AcpUpdateMessage | AckEventMessage | ErrorEventMessage;
export type RealtimeMessage = UserEventMessage | OutboundRealtimeMessage;

export function environmentPayloadToSessionEvent(payload: EnvironmentEventPayload): SessionEvent {
  return { type: "environment_event", kind: payload.kind, ...(payload.payload !== undefined ? { payload: payload.payload } : {}) };
}
