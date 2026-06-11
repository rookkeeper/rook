import type { SessionEvent, SessionEventMessage } from "../../shared/realtime.js";
import type { AcpServerMessage, AcpSessionUpdate, JsonRpcMeta } from "../../shared/acp.js";

function sequenceMeta(sequence?: number): JsonRpcMeta | undefined {
  return sequence === undefined ? undefined : { rookery: { sequence } };
}

function updateNotification(sessionId: string, update: AcpSessionUpdate, sequence?: number): AcpServerMessage {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update,
      ...(sequence === undefined ? {} : { _meta: sequenceMeta(sequence) }),
    },
  };
}

function customUpdate(sessionUpdate: string, payload: Record<string, unknown> = {}, sequence?: number): AcpSessionUpdate {
  return {
    sessionUpdate,
    ...payload,
    ...(sequence === undefined ? {} : { _meta: sequenceMeta(sequence) }),
  };
}

export function translateSessionEventToAcp(sessionId: string, event: SessionEvent, sequence?: number): AcpServerMessage[] {
  switch (event.type) {
    case "user_message":
      return [updateNotification(sessionId, {
        sessionUpdate: "user_message_chunk",
        ...(event.id ? { messageId: event.id } : {}),
        content: { type: "text", text: event.text },
        ...(sequence === undefined ? {} : { _meta: sequenceMeta(sequence) }),
      }, sequence)];

    case "text_delta":
      return [updateNotification(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: event.delta },
        ...(sequence === undefined ? {} : { _meta: sequenceMeta(sequence) }),
      }, sequence)];

    case "thinking_delta":
      return [updateNotification(sessionId, {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: event.delta },
        ...(sequence === undefined ? {} : { _meta: sequenceMeta(sequence) }),
      }, sequence)];

    case "tool_call_started":
      return [updateNotification(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: event.toolName,
        kind: "other",
        status: "pending",
        ...(event.rawInput
          ? {
              _meta: {
                ...(sequence === undefined ? {} : sequenceMeta(sequence)),
                rookery: {
                  ...(sequence === undefined ? {} : { sequence }),
                  rawInput: event.rawInput,
                },
              },
            }
          : (sequence === undefined ? {} : { _meta: sequenceMeta(sequence) })),
      }, sequence)];

    case "tool_input_delta":
      return [updateNotification(sessionId, customUpdate("_rookery_tool_input_delta", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        delta: event.delta,
      }, sequence), sequence)];

    case "tool_call_ready":
      return [updateNotification(sessionId, customUpdate("_rookery_tool_call_ready", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      }, sequence), sequence)];

    case "tool_running":
      return [updateNotification(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "in_progress",
        ...(sequence === undefined ? {} : { _meta: sequenceMeta(sequence) }),
      }, sequence)];

    case "tool_output_delta":
      return [updateNotification(sessionId, customUpdate("_rookery_tool_output_delta", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        delta: event.delta,
      }, sequence), sequence)];

    case "tool_completed":
      return [updateNotification(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: event.output } }],
        _meta: {
          ...(sequence === undefined ? {} : sequenceMeta(sequence)),
          rookery: { ...(sequence === undefined ? {} : { sequence }), toolName: event.toolName },
        },
      }, sequence)];

    case "tool_error":
      return [updateNotification(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: event.error } }],
        _meta: {
          ...(sequence === undefined ? {} : sequenceMeta(sequence)),
          rookery: { ...(sequence === undefined ? {} : { sequence }), toolName: event.toolName, isError: true },
        },
      }, sequence)];

    case "run_completed":
      return [updateNotification(sessionId, customUpdate("_rookery_run_completed", {}, sequence), sequence)];

    case "run_failed":
      return [updateNotification(sessionId, customUpdate("_rookery_run_failed", { error: event.error }, sequence), sequence)];

    case "status_changed":
      return [updateNotification(sessionId, customUpdate("_rookery_status_changed", { status: event.status, message: event.message }, sequence), sequence)];

    case "assistant_message_started":
      return [updateNotification(sessionId, customUpdate("_rookery_assistant_message_started", {
        id: event.id,
        model: event.model,
        provider: event.provider,
      }, sequence), sequence)];

    case "assistant_message_completed":
      return [updateNotification(sessionId, customUpdate("_rookery_assistant_message_completed", {
        id: event.id,
        model: event.model,
        provider: event.provider,
      }, sequence), sequence)];

    case "assistant_message_error":
      return [updateNotification(sessionId, customUpdate("_rookery_assistant_message_error", { error: event.error }, sequence), sequence)];

    case "protocol_error":
      return [updateNotification(sessionId, customUpdate("_rookery_protocol_error", { error: event.error }, sequence), sequence)];

    case "connection_error":
      return [updateNotification(sessionId, customUpdate("_rookery_connection_error", { error: event.error }, sequence), sequence)];

    case "environment_event":
      return [updateNotification(sessionId, customUpdate("_rookery_environment_event", { kind: event.kind, payload: event.payload }, sequence), sequence)];
  }
}

export function translateSessionEventMessageToAcp(message: SessionEventMessage): AcpServerMessage[] {
  return translateSessionEventToAcp(message.sessionId, message.event, message.sequence);
}
