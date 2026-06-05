import React, { useReducer, useRef } from "react";
import { Block, UserMessageBlock, ThinkingBlock, AgentTextBlock, ToolBlock } from "../types";
import { MessageUpdateEvent, ToolExecutionEvent } from "../agent";
import { MockAgent } from "../mockAgent";
import { MessageThread } from "./MessageThread";
import { ComposeBox } from "./ComposeBox";

type State = { blocks: Block[]; isAgentProcessing: boolean };

type Action =
  | { type: "USER_MESSAGE"; text: string }
  | { type: "AGENT_START" }
  | { type: "AGENT_END" }
  | { type: "MESSAGE_END" }
  | { type: "MESSAGE_UPDATE"; event: MessageUpdateEvent }
  | { type: "TOOL_EXECUTION"; event: ToolExecutionEvent };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "USER_MESSAGE": {
      const block: UserMessageBlock = { type: "text", role: "user", text: action.text, isStreaming: false };
      return { ...state, blocks: [...state.blocks, block] };
    }
    case "AGENT_START":  return { ...state, isAgentProcessing: true };
    case "AGENT_END":    return { ...state, isAgentProcessing: false };
    case "MESSAGE_END":  return {
      ...state,
      blocks: state.blocks.map((b) => {
        if (b.type === "toolBlock") return b.argumentsStreaming ? { ...b, argumentsStreaming: false } : b;
        return b.isStreaming ? { ...b, isStreaming: false } : b;
      }),
    };
    case "MESSAGE_UPDATE": {
      const ev = action.event;
      const blocks = [...state.blocks];
      if (ev.type === "thinking") {
        const last = blocks[blocks.length - 1];
        if (last && last.type === "thinking" && last.isStreaming) {
          blocks[blocks.length - 1] = { ...last, thinking: last.thinking + ev.delta };
        } else {
          blocks.push({ type: "thinking", thinking: ev.delta, isStreaming: true } as ThinkingBlock);
        }
      } else if (ev.type === "text") {
        const last = blocks[blocks.length - 1];
        if (last && last.type === "text" && last.role === "assistant" && last.isStreaming) {
          blocks[blocks.length - 1] = { ...last, text: last.text + ev.delta };
        } else {
          blocks.push({ type: "text", role: "assistant", text: ev.delta, isStreaming: true } as AgentTextBlock);
        }
      } else if (ev.type === "toolCall") {
        const idx = blocks.findLastIndex((b) => b.type === "toolBlock" && b.id === ev.id);
        if (idx !== -1) {
          const existing = blocks[idx] as ToolBlock;
          blocks[idx] = { ...existing, arguments: existing.arguments + ev.argumentsDelta };
        } else {
          blocks.push({ type: "toolBlock", id: ev.id, name: ev.name, arguments: ev.argumentsDelta, argumentsStreaming: true, result: null, isError: false });
        }
      }
      return { ...state, blocks };
    }
    case "TOOL_EXECUTION": {
      const ev = action.event;
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.type === "toolBlock" && b.id === ev.toolCallId
            ? { ...b, result: ev.content, isError: ev.isError, argumentsStreaming: false }
            : b
        ),
      };
    }
    default: return state;
  }
}

export function ChatPanel() {
  const [state, dispatch] = useReducer(reducer, { blocks: [], isAgentProcessing: false });
  const agentRef = useRef<MockAgent | null>(null);

  const handleSubmit = (text: string) => {
    dispatch({ type: "USER_MESSAGE", text });
    const agent = new MockAgent({
      onAgentStart:   () => dispatch({ type: "AGENT_START" }),
      onAgentEnd:     () => dispatch({ type: "AGENT_END" }),
      onMessageStart: () => { /* reserved */ },
      onMessageUpdate: (event) => dispatch({ type: "MESSAGE_UPDATE", event }),
      onMessageEnd:   () => dispatch({ type: "MESSAGE_END" }),
      onToolExecution: (event) => dispatch({ type: "TOOL_EXECUTION", event }),
    });
    agentRef.current = agent;
    agent.run(text);
  };

  return (
    <div className="cwa-panel">
      <MessageThread blocks={state.blocks} isStreaming={state.isAgentProcessing} />
      <ComposeBox onSubmit={handleSubmit} disabled={state.isAgentProcessing} />
    </div>
  );
}
