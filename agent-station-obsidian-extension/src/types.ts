export type Block =
  | UserMessageBlock
  | ThinkingBlock
  | AgentTextBlock
  | ToolBlock;

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

export interface ToolBlock {
  type: "toolBlock";
  id: string;
  name: string;
  arguments: string;
  argumentsStreaming: boolean;
  result: string | null;
  isError: boolean;
}
