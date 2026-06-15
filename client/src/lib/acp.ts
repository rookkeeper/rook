export type JsonRpcId = string | number;

export type JsonRpcMeta = Record<string, unknown>;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export interface AcpTextContentBlock {
  type: "text";
  text: string;
}

export interface AcpContentItem {
  type: "content";
  content: AcpTextContentBlock;
}

export interface AcpUserMessageChunkUpdate {
  sessionUpdate: "user_message_chunk";
  messageId?: string;
  content: AcpTextContentBlock;
  _meta?: JsonRpcMeta;
}

export interface AcpAgentMessageChunkUpdate {
  sessionUpdate: "agent_message_chunk";
  messageId?: string;
  content: AcpTextContentBlock;
  _meta?: JsonRpcMeta;
}

export interface AcpAgentThoughtChunkUpdate {
  sessionUpdate: "agent_thought_chunk";
  messageId?: string;
  content: AcpTextContentBlock;
  _meta?: JsonRpcMeta;
}

export interface AcpToolCallUpdateStart {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  kind: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  content?: AcpContentItem[];
  _meta?: JsonRpcMeta;
}

export interface AcpToolCallUpdateStatus {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  content?: AcpContentItem[];
  _meta?: JsonRpcMeta;
}

export interface AcpPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface AcpPlanUpdate {
  sessionUpdate: "plan";
  entries: AcpPlanEntry[];
  _meta?: JsonRpcMeta;
}

export interface AcpUsageUpdate {
  sessionUpdate: "usage_update";
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
  _meta?: JsonRpcMeta;
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpCurrentModeUpdate {
  sessionUpdate: "current_mode_update";
  modeId: string;
  _meta?: JsonRpcMeta;
}

export interface AcpConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: "select";
  currentValue: string;
  options: AcpConfigOptionValue[];
}

export interface AcpConfigOptionUpdate {
  sessionUpdate: "config_option_update";
  configOptions: AcpConfigOption[];
  _meta?: JsonRpcMeta;
}

export interface AcpCustomSessionUpdate {
  sessionUpdate: string;
  _meta?: JsonRpcMeta;
  [key: string]: unknown;
}

export type AcpSessionUpdate =
  | AcpUserMessageChunkUpdate
  | AcpAgentMessageChunkUpdate
  | AcpAgentThoughtChunkUpdate
  | AcpToolCallUpdateStart
  | AcpToolCallUpdateStatus
  | AcpPlanUpdate
  | AcpUsageUpdate
  | AcpCurrentModeUpdate
  | AcpConfigOptionUpdate
  | AcpCustomSessionUpdate;

export interface AcpPromptResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: {
    stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
    _meta?: JsonRpcMeta;
  };
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AcpPermissionToolCall {
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  content?: AcpTextContentBlock[] | AcpContentItem[];
}

export interface AcpPermissionRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: "session/request_permission";
  params: {
    sessionId: string;
    toolCall: AcpPermissionToolCall;
    options: AcpPermissionOption[];
    _meta?: JsonRpcMeta;
  };
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
