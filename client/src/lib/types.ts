export type Block =
  | UserMessageBlock
  | ThinkingBlock
  | AgentTextBlock
  | ToolBlock
  | ErrorBlock;

export interface UserMessageBlock {
  type: "text";
  role: "user";
  text: string;
  isStreaming: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  isStreaming: boolean;
}

export interface AgentTextBlock {
  type: "text";
  role: "assistant";
  text: string;
  isStreaming: boolean;
}

export type ToolBlockStatus = "input_streaming" | "ready" | "running" | "completed" | "error";

export interface ToolBlock {
  type: "toolBlock";
  id: string;
  name: string;
  status: ToolBlockStatus;
  arguments: string;
  argumentsStreaming: boolean;
  result: string | null;
  isError: boolean;
}

export interface ErrorBlock {
  type: "error";
  source: "assistant" | "tool" | "protocol" | "connection" | "run";
  message: string;
}
