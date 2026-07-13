export type JsonRpcId = string | number;
export type JsonObject = Record<string, unknown>;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: JsonObject;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: JsonObject;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export interface SessionRecord {
  sessionId: string;
  runtimeId: string;
  runtimeSessionId: string;
  cwd: string;
  title: string;
  startedAt: string;
  updatedAt: string;
}
