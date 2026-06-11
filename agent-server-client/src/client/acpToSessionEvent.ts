import type { SessionEvent } from "../shared/realtime";
import type { AgentRunStatus } from "./agent";
import type {
  AcpServerMessage,
  AcpSessionUpdate,
  JsonRpcFailure,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcSuccess,
} from "../shared/acp";

function getRookeryMeta(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const meta = (value as Record<string, unknown>).rookery;
  return meta && typeof meta === "object" ? meta as Record<string, unknown> : undefined;
}

export function getSequenceFromAcpMessage(message: JsonRpcMessage): number | undefined {
  if ("method" in message && message.method === "session/update") {
    const params = message.params as { _meta?: unknown; update?: { _meta?: unknown } } | undefined;
    const direct = getRookeryMeta(params?._meta)?.sequence;
    if (typeof direct === "number") return direct;
    const updateLevel = getRookeryMeta(params?.update?._meta)?.sequence;
    if (typeof updateLevel === "number") return updateLevel;
  }
  if ("result" in message && message.result && typeof message.result === "object") {
    const direct = getRookeryMeta((message.result as Record<string, unknown>)._meta)?.sequence;
    if (typeof direct === "number") return direct;
  }
  return undefined;
}

function textFromContentItems(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = (item as { content?: { text?: unknown } }).content?.text;
      return typeof value === "string" ? value : "";
    })
    .join("\n");
}

function updateToSessionEvents(update: AcpSessionUpdate): SessionEvent[] {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const chunk = update as { messageId?: string; content?: { type?: unknown; text?: unknown } };
      return chunk.content?.type === "text" && typeof chunk.content.text === "string"
        ? [{ type: "user_message", ...(typeof chunk.messageId === "string" ? { id: chunk.messageId } : {}), text: chunk.content.text, queued: false }]
        : [];
    }
    case "agent_message_chunk": {
      const chunk = update as { content?: { type?: unknown; text?: unknown } };
      return chunk.content?.type === "text" && typeof chunk.content.text === "string"
        ? [{ type: "text_delta", delta: chunk.content.text }]
        : [];
    }
    case "agent_thought_chunk": {
      const chunk = update as { content?: { type?: unknown; text?: unknown } };
      return chunk.content?.type === "text" && typeof chunk.content.text === "string"
        ? [{ type: "thinking_delta", delta: chunk.content.text }]
        : [];
    }
    case "tool_call": {
      const toolCall = update as { toolCallId: string; title: string; _meta?: unknown };
      const rookery = getRookeryMeta(toolCall._meta);
      return [{
        type: "tool_call_started",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.title,
        ...(typeof rookery?.rawInput === "string" ? { rawInput: rookery.rawInput } : {}),
      }];
    }
    case "tool_call_update": {
      const toolCallUpdate = update as { toolCallId: string; status: string; content?: unknown; _meta?: unknown };
      const rookery = getRookeryMeta(toolCallUpdate._meta);
      const toolName = typeof rookery?.toolName === "string" ? rookery.toolName : undefined;
      const output = textFromContentItems(toolCallUpdate.content);
      if (toolCallUpdate.status === "in_progress") return [{ type: "tool_running", toolCallId: toolCallUpdate.toolCallId }];
      if (toolCallUpdate.status === "completed") {
        return [{ type: "tool_completed", toolCallId: toolCallUpdate.toolCallId, toolName: toolName ?? "tool", output }];
      }
      if (toolCallUpdate.status === "failed" || toolCallUpdate.status === "cancelled") {
        return [{ type: "tool_error", toolCallId: toolCallUpdate.toolCallId, toolName: toolName ?? "tool", error: output || toolCallUpdate.status }];
      }
      return [];
    }
    case "_rookery_tool_input_delta":
      return [{
        type: "tool_input_delta",
        toolCallId: String(update.toolCallId ?? ""),
        ...(typeof update.toolName === "string" ? { toolName: update.toolName } : {}),
        delta: String(update.delta ?? ""),
      }];
    case "_rookery_tool_call_ready":
      return [{
        type: "tool_call_ready",
        toolCallId: String(update.toolCallId ?? ""),
        ...(typeof update.toolName === "string" ? { toolName: update.toolName } : {}),
      }];
    case "_rookery_tool_output_delta":
      return [{
        type: "tool_output_delta",
        toolCallId: String(update.toolCallId ?? ""),
        ...(typeof update.toolName === "string" ? { toolName: update.toolName } : {}),
        delta: String(update.delta ?? ""),
      }];
    case "_rookery_run_completed":
      return [{ type: "run_completed" }];
    case "_rookery_run_failed":
      return [{ type: "run_failed", error: String(update.error ?? "Run failed") }];
    case "_rookery_status_changed": {
      const status = String(update.status ?? "idle") as AgentRunStatus;
      return [{ type: "status_changed", status, ...(typeof update.message === "string" ? { message: update.message } : {}) }];
    }
    case "_rookery_assistant_message_started":
      return [{ type: "assistant_message_started", ...(typeof update.id === "string" ? { id: update.id } : {}), ...(typeof update.model === "string" ? { model: update.model } : {}), ...(typeof update.provider === "string" ? { provider: update.provider } : {}) }];
    case "_rookery_assistant_message_completed":
      return [{ type: "assistant_message_completed", ...(typeof update.id === "string" ? { id: update.id } : {}), ...(typeof update.model === "string" ? { model: update.model } : {}), ...(typeof update.provider === "string" ? { provider: update.provider } : {}) }];
    case "_rookery_assistant_message_error":
      return [{ type: "assistant_message_error", error: String(update.error ?? "Assistant error") }];
    case "_rookery_protocol_error":
      return [{ type: "protocol_error", error: String(update.error ?? "Protocol error") }];
    case "_rookery_connection_error":
      return [{ type: "connection_error", error: String(update.error ?? "Connection error") }];
    case "_rookery_environment_event":
      return [{ type: "environment_event", kind: String(update.kind ?? "unknown"), ...(update.payload !== undefined ? { payload: update.payload } : {}) }];
    default:
      return [];
  }
}

export function acpServerMessageToSessionEvents(message: AcpServerMessage): SessionEvent[] {
  if ("method" in message && message.method === "session/update") {
    return updateToSessionEvents(message.params?.update as AcpSessionUpdate);
  }
  if ("error" in message) {
    return [{ type: "connection_error", error: message.error.message }];
  }
  return [];
}

export function isJsonRpcSuccess(message: JsonRpcMessage): message is JsonRpcSuccess {
  return "id" in message && "result" in message;
}

export function isJsonRpcFailure(message: JsonRpcMessage): message is JsonRpcFailure {
  return "error" in message;
}

export function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}
