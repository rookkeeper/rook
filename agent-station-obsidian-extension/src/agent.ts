export type MessageUpdateEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "toolCall"; id: string; name: string; argumentsDelta: string };

export interface ToolExecutionEvent {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export interface AgentCallbacks {
  onAgentStart: () => void;
  onAgentEnd: () => void;
  onMessageStart: () => void;
  onMessageUpdate: (event: MessageUpdateEvent) => void;
  onMessageEnd: () => void;
  onToolExecution: (event: ToolExecutionEvent) => void;
}

export abstract class Agent {
  protected callbacks: AgentCallbacks;

  constructor(callbacks: AgentCallbacks) {
    this.callbacks = callbacks;
  }

  abstract run(userMessage: string): Promise<void>;
}
