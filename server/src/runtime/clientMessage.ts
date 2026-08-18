import type { JsonRpcMessage } from "./SessionRuntime.js";

export const MAX_CLIENT_MESSAGE_BYTES = 10 * 1024;
const TRUNCATION_MARKER = "[Rook truncated this presentation payload because it exceeded 10 kB.]";

/** Bounds ACP messages sent to a client without changing the runtime's history. */
export function boundedClientMessage(message: JsonRpcMessage): JsonRpcMessage {
  if (serializedBytes(message) <= MAX_CLIENT_MESSAGE_BYTES) return message;

  const compacted = compactValue(message) as JsonRpcMessage;
  if (serializedBytes(compacted) <= MAX_CLIENT_MESSAGE_BYTES) return compacted;

  const params = object(message.params);
  const update = object(params?.update);
  if (params && update) {
    const boundedUpdate: JsonRpcMessage = {
      sessionUpdate: update.sessionUpdate,
      ...(typeof update.toolCallId === "string" ? { toolCallId: update.toolCallId } : {}),
      ...(typeof update.status === "string" ? { status: update.status } : {}),
      ...(typeof update.title === "string" ? { title: update.title } : {}),
      ...(typeof update.kind === "string" ? { kind: update.kind } : {}),
      ...(typeof update.rawInput !== "undefined" ? { rawInput: TRUNCATION_MARKER } : {}),
      ...(typeof update.rawOutput !== "undefined" ? { rawOutput: TRUNCATION_MARKER } : {}),
      ...(typeof update.content !== "undefined" ? { content: [{ type: "content", content: { type: "text", text: TRUNCATION_MARKER } }] } : {}),
    };
    const candidate = { ...message, params: { sessionId: params.sessionId, update: boundedUpdate } };
    if (serializedBytes(candidate) <= MAX_CLIENT_MESSAGE_BYTES) return candidate;
  }

  return minimalMessage(message);
}

function minimalMessage(message: JsonRpcMessage): JsonRpcMessage {
  const result: JsonRpcMessage = { jsonrpc: "2.0" };
  if (typeof message.id === "string" || typeof message.id === "number") result.id = message.id;
  if (typeof message.method === "string") result.method = message.method;
  const params = object(message.params);
  const update = object(params?.update);
  if (params && update) {
    result.params = {
      ...(typeof params.sessionId === "string" ? { sessionId: params.sessionId } : {}),
      update: {
        ...(typeof update.sessionUpdate === "string" ? { sessionUpdate: update.sessionUpdate } : {}),
        ...(typeof update.toolCallId === "string" ? { toolCallId: update.toolCallId } : {}),
        ...(typeof update.status === "string" ? { status: update.status } : {}),
        content: [{ type: "content", content: { type: "text", text: TRUNCATION_MARKER } }],
      },
    };
  } else if (typeof message.method === "string") {
    result.params = { message: TRUNCATION_MARKER };
  } else if ("error" in message) {
    result.error = { code: -32000, message: TRUNCATION_MARKER };
  } else {
    result.result = TRUNCATION_MARKER;
  }
  return result;
}

function compactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return serializedBytes(value) > 1024 ? TRUNCATION_MARKER : value;
  }
  if (Array.isArray(value)) return value.map(compactValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactValue(item)]));
  }
  return value;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function object(value: unknown): JsonRpcMessage | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRpcMessage : undefined;
}
