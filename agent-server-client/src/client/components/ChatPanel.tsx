import { useEffect, useReducer, useRef, useState } from "react";
import { Block, UserMessageBlock, ThinkingBlock, AgentTextBlock, ToolBlock } from "../types";
import {
  AgentBackend,
  AgentRunStatus,
  AgentSessionSummary,
  AgentStatusChangedEvent,
  AgentTextDeltaEvent,
  AgentThinkingDeltaEvent,
  AgentToolCallStartedEvent,
  AgentToolInputDeltaEvent,
  AgentToolCallReadyEvent,
  AgentToolRunningEvent,
  AgentToolOutputDeltaEvent,
  AgentToolCompletedEvent,
  AgentToolErrorEvent,
  UserMessageAcceptedEvent,
} from "../agent";
import { RemoteAgent, type RemoteSessionEvent } from "../remoteAgent";
import {
  ENVIRONMENT_OFFER_AVAILABLE_KIND,
  ENVIRONMENT_OFFER_RESOLVED_KIND,
  type EnvironmentOfferAvailablePayload,
  type EnvironmentOfferResolvedPayload,
} from "../../shared/environment";
import { MessageThread } from "./MessageThread";
import { ComposeBox } from "./ComposeBox";
import { BlockModal } from "./BlockModal";
import {
  createParentMessageToolState,
  maybePostParentMessageToolCall,
  recordParentMessageToolInputDelta,
  recordParentMessageToolStart,
  type ParentMessagePoster,
} from "../parentMessageTool";

type StatusState = { status: AgentRunStatus | "queued"; message: string };
type QueuedMessage = { id: string; text: string };
type State = {
  blocks: Block[];
  isAgentProcessing: boolean;
  status: StatusState;
  queuedMessages: QueuedMessage[];
};

type Action =
  | { type: "STATUS_CHANGED"; event: AgentStatusChangedEvent }
  | { type: "USER_MESSAGE_QUEUED"; message: QueuedMessage }
  | { type: "USER_MESSAGE_DEQUEUED"; id: string }
  | { type: "USER_MESSAGE_ACCEPTED"; event: UserMessageAcceptedEvent }
  | { type: "ASSISTANT_MESSAGE_COMPLETED" }
  | { type: "TEXT_DELTA"; event: AgentTextDeltaEvent }
  | { type: "THINKING_DELTA"; event: AgentThinkingDeltaEvent }
  | { type: "TOOL_CALL_STARTED"; event: AgentToolCallStartedEvent }
  | { type: "TOOL_INPUT_DELTA"; event: AgentToolInputDeltaEvent }
  | { type: "TOOL_CALL_READY"; event: AgentToolCallReadyEvent }
  | { type: "TOOL_RUNNING"; event: AgentToolRunningEvent }
  | { type: "TOOL_OUTPUT_DELTA"; event: AgentToolOutputDeltaEvent }
  | { type: "TOOL_COMPLETED"; event: AgentToolCompletedEvent }
  | { type: "TOOL_ERROR"; event: AgentToolErrorEvent }
  | { type: "RUN_COMPLETED" }
  | { type: "RUN_FAILED"; error: string; source?: "protocol" | "connection" | "run" };

function finalizeStreamingBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    if (b.type === "toolBlock") {
      const status = b.status === "input_streaming" ? "ready" : b.status;
      return b.argumentsStreaming ? { ...b, status, argumentsStreaming: false } : { ...b, status };
    }
    if (b.type === "text" || b.type === "thinking") return b.isStreaming ? { ...b, isStreaming: false } : b;
    return b;
  });
}

function updateLastToolBlock(blocks: Block[], toolCallId: string, update: (block: ToolBlock) => ToolBlock): Block[] {
  const next = [...blocks];
  const idx = next.findLastIndex((b) => b.type === "toolBlock" && b.id === toolCallId);
  if (idx === -1) return blocks;
  next[idx] = update(next[idx] as ToolBlock);
  return next;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "STATUS_CHANGED":
      return {
        ...state,
        status: { status: action.event.status, message: action.event.message ?? action.event.status },
        isAgentProcessing: action.event.status !== "idle" && action.event.status !== "error",
      };

    case "USER_MESSAGE_QUEUED":
      return {
        ...state,
        status: { status: "queued", message: `${state.queuedMessages.length + 1} queued message${state.queuedMessages.length === 0 ? "" : "s"}` },
        queuedMessages: [...state.queuedMessages, action.message],
      };

    case "USER_MESSAGE_DEQUEUED":
      return {
        ...state,
        queuedMessages: state.queuedMessages.filter((message) => message.id !== action.id),
      };

    case "USER_MESSAGE_ACCEPTED": {
      const block: UserMessageBlock = { type: "text", role: "user", text: action.event.text, isStreaming: false };
      return { ...state, blocks: [...state.blocks, block] };
    }

    case "ASSISTANT_MESSAGE_COMPLETED":
      return { ...state, blocks: finalizeStreamingBlocks(state.blocks) };

    case "TEXT_DELTA": {
      const blocks = [...state.blocks];
      const last = blocks[blocks.length - 1];
      if (last && last.type === "text" && last.role === "assistant" && last.isStreaming) {
        blocks[blocks.length - 1] = { ...last, text: last.text + action.event.delta };
      } else {
        blocks.push({ type: "text", role: "assistant", text: action.event.delta, isStreaming: true } as AgentTextBlock);
      }
      return { ...state, blocks };
    }

    case "THINKING_DELTA": {
      const blocks = [...state.blocks];
      const last = blocks[blocks.length - 1];
      if (last && last.type === "thinking" && last.isStreaming) {
        blocks[blocks.length - 1] = { ...last, thinking: last.thinking + action.event.delta };
      } else {
        blocks.push({ type: "thinking", thinking: action.event.delta, isStreaming: true } as ThinkingBlock);
      }
      return { ...state, blocks };
    }

    case "TOOL_CALL_STARTED": {
      const ev = action.event;
      const exists = state.blocks.some((b) => b.type === "toolBlock" && b.id === ev.toolCallId);
      if (exists) return state;

      return {
        ...state,
        blocks: [
          ...state.blocks,
          {
            type: "toolBlock",
            id: ev.toolCallId,
            name: ev.toolName,
            status: "input_streaming",
            arguments: ev.rawInput ?? "",
            argumentsStreaming: true,
            result: null,
            isError: false,
          },
        ],
      };
    }

    case "TOOL_INPUT_DELTA": {
      const ev = action.event;
      const blocks = [...state.blocks];
      const idx = blocks.findLastIndex((b) => b.type === "toolBlock" && b.id === ev.toolCallId);
      if (idx !== -1) {
        const existing = blocks[idx] as ToolBlock;
        blocks[idx] = { ...existing, status: "input_streaming", arguments: existing.arguments + ev.delta };
      } else {
        blocks.push({
          type: "toolBlock",
          id: ev.toolCallId,
          name: ev.toolName ?? "tool",
          status: "input_streaming",
          arguments: ev.delta,
          argumentsStreaming: true,
          result: null,
          isError: false,
        });
      }
      return { ...state, blocks };
    }

    case "TOOL_CALL_READY":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.event.toolCallId, (b) => ({
          ...b,
          name: action.event.toolName ?? b.name,
          status: "ready",
          argumentsStreaming: false,
        })),
      };

    case "TOOL_RUNNING":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.event.toolCallId, (b) => ({ ...b, status: "running" })),
      };

    case "TOOL_OUTPUT_DELTA":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.event.toolCallId, (b) => ({
          ...b,
          status: "running",
          result: action.event.delta,
          isError: false,
          argumentsStreaming: false,
        })),
      };

    case "TOOL_COMPLETED":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.event.toolCallId, (b) => ({
          ...b,
          status: "completed",
          result: action.event.output,
          isError: false,
          argumentsStreaming: false,
        })),
      };

    case "TOOL_ERROR":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.event.toolCallId, (b) => ({
          ...b,
          status: "error",
          result: action.event.error,
          isError: true,
          argumentsStreaming: false,
        })),
      };

    case "RUN_COMPLETED":
      return {
        ...state,
        isAgentProcessing: false,
        status: state.queuedMessages.length > 0
          ? { status: "queued", message: `${state.queuedMessages.length} queued message${state.queuedMessages.length === 1 ? "" : "s"}` }
          : { status: "idle", message: "Ready" },
        blocks: finalizeStreamingBlocks(state.blocks),
      };

    case "RUN_FAILED":
      return {
        ...state,
        isAgentProcessing: false,
        status: { status: "error", message: action.error },
        blocks: [
          ...finalizeStreamingBlocks(state.blocks),
          { type: "error", source: action.source ?? "run", message: action.error },
        ],
      };

    default:
      return state;
  }
}

interface ChatPanelProps {
  agentBackend: AgentBackend;
  initialSession: AgentSessionSummary | null;
  disabled?: boolean;
  onParentMessage?: ParentMessagePoster | null;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
  replayEvents?: RemoteSessionEvent[];
}

export function ChatPanel({
  agentBackend,
  initialSession,
  disabled = false,
  onParentMessage = null,
  onEnvironmentOfferAvailable,
  onEnvironmentOfferResolved,
  replayEvents = [],
}: ChatPanelProps) {
  const [state, dispatch] = useReducer(reducer, {
    blocks: [],
    isAgentProcessing: false,
    status: { status: "idle", message: "Ready" },
    queuedMessages: [],
  });
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const agentRef = useRef<RemoteAgent | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const isAgentProcessingRef = useRef(false);
  const messageIdRef = useRef(0);
  const parentMessageToolStateRef = useRef(createParentMessageToolState());
  const replayAppliedRef = useRef(false);

  const handleRunCompletion = () => {
    dispatch({ type: "RUN_COMPLETED" });
    const nextMessage = queueRef.current.shift();
    if (nextMessage) {
      dispatch({ type: "USER_MESSAGE_DEQUEUED", id: nextMessage.id });
      window.setTimeout(() => startAgentRun(nextMessage.text), 120);
    } else {
      isAgentProcessingRef.current = false;
    }
  };

  const applyServerEvent = (message: RemoteSessionEvent) => {
    switch (message.type) {
      case "status_changed":
        dispatch({ type: "STATUS_CHANGED", event: message as AgentStatusChangedEvent });
        break;
      case "user_message":
        dispatch({ type: "USER_MESSAGE_ACCEPTED", event: message as UserMessageAcceptedEvent });
        break;
      case "assistant_message_completed":
        dispatch({ type: "ASSISTANT_MESSAGE_COMPLETED" });
        break;
      case "text_delta":
        dispatch({ type: "TEXT_DELTA", event: message as AgentTextDeltaEvent });
        break;
      case "thinking_delta":
        dispatch({ type: "THINKING_DELTA", event: message as AgentThinkingDeltaEvent });
        break;
      case "tool_call_started": {
        const event = message as AgentToolCallStartedEvent;
        recordParentMessageToolStart(parentMessageToolStateRef.current, event);
        dispatch({ type: "TOOL_CALL_STARTED", event });
        break;
      }
      case "tool_input_delta": {
        const event = message as AgentToolInputDeltaEvent;
        recordParentMessageToolInputDelta(parentMessageToolStateRef.current, event);
        dispatch({ type: "TOOL_INPUT_DELTA", event });
        break;
      }
      case "tool_call_ready": {
        const event = message as AgentToolCallReadyEvent;
        maybePostParentMessageToolCall(parentMessageToolStateRef.current, event, onParentMessage);
        dispatch({ type: "TOOL_CALL_READY", event });
        break;
      }
      case "tool_running":
        dispatch({ type: "TOOL_RUNNING", event: message as AgentToolRunningEvent });
        break;
      case "tool_output_delta":
        dispatch({ type: "TOOL_OUTPUT_DELTA", event: message as AgentToolOutputDeltaEvent });
        break;
      case "tool_completed":
        dispatch({ type: "TOOL_COMPLETED", event: message as AgentToolCompletedEvent });
        break;
      case "tool_error":
        dispatch({ type: "TOOL_ERROR", event: message as AgentToolErrorEvent });
        break;
      case "run_completed":
        handleRunCompletion();
        break;
      case "run_failed":
        isAgentProcessingRef.current = false;
        dispatch({ type: "RUN_FAILED", error: message.error ?? "Run failed", source: "run" });
        break;
      case "protocol_error":
        isAgentProcessingRef.current = false;
        dispatch({ type: "RUN_FAILED", error: message.error ?? "Protocol error", source: "protocol" });
        break;
      case "connection_error":
        isAgentProcessingRef.current = false;
        dispatch({ type: "RUN_FAILED", error: message.error ?? "Connection error", source: "connection" });
        break;
      case "environment_event":
        if (message.kind === ENVIRONMENT_OFFER_AVAILABLE_KIND && onEnvironmentOfferAvailable) {
          const payload = message.payload;
          if (payload && typeof payload === "object" && "environmentId" in payload && typeof payload.environmentId === "string") {
            const offer = payload as { environmentId: string; sourceName?: unknown; canonicalSourceUrl?: unknown };
            onEnvironmentOfferAvailable({
              environmentId: offer.environmentId,
              ...(typeof offer.sourceName === "string" ? { sourceName: offer.sourceName } : {}),
              ...(typeof offer.canonicalSourceUrl === "string" ? { canonicalSourceUrl: offer.canonicalSourceUrl } : {}),
            });
          }
        }
        if (message.kind === ENVIRONMENT_OFFER_RESOLVED_KIND && onEnvironmentOfferResolved) {
          const payload = message.payload;
          if (
            payload
            && typeof payload === "object"
            && "environmentId" in payload
            && typeof payload.environmentId === "string"
            && "decision" in payload
            && (payload.decision === "approved" || payload.decision === "dismissed" || payload.decision === "unavailable")
          ) {
            onEnvironmentOfferResolved({
              environmentId: payload.environmentId,
              decision: payload.decision,
            });
          }
        }
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (replayAppliedRef.current) return;
    replayAppliedRef.current = true;
    if (replayEvents.length === 0) return;
    for (const event of replayEvents) applyServerEvent(event);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let connectTimer = 0;

    const activeAgent = new RemoteAgent({
      backend: agentBackend,
      session: initialSession ?? undefined,
      onSessionEvent: applyServerEvent,
    });

    agentRef.current = activeAgent;
    connectTimer = window.setTimeout(() => {
      if (cancelled) return;
      void activeAgent.connect().catch(() => undefined);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(connectTimer);
      if (agentRef.current === activeAgent) agentRef.current = null;
      activeAgent.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBackend, initialSession?.id]);

  const startAgentRun = (text: string) => {
    isAgentProcessingRef.current = true;
    const activeAgent = agentRef.current;
    if (!activeAgent) return;
    void activeAgent.run(text);
  };

  const handleSubmit = (text: string) => {
    if (disabled) return;

    if (isAgentProcessingRef.current) {
      messageIdRef.current += 1;
      const queuedMessage = { id: `queued-${messageIdRef.current}`, text };
      queueRef.current.push(queuedMessage);
      dispatch({ type: "USER_MESSAGE_QUEUED", message: queuedMessage });
      return;
    }

    startAgentRun(text);
  };

  return (
    <div className="cwa-panel">
      <MessageThread blocks={state.blocks} isStreaming={state.isAgentProcessing} onOpenBlock={setSelectedBlock} />
      {state.queuedMessages.length > 0 && (
        <div className="cwa-queue" aria-label="Queued messages">
          <div className="cwa-queue__label">Queued</div>
          <ol className="cwa-queue__list">
            {state.queuedMessages.map((message) => (
              <li key={message.id} className="cwa-queue__item">{message.text}</li>
            ))}
          </ol>
        </div>
      )}
      <div className={`cwa-status-line cwa-status-line--${state.status.status}`}>
        <span className="cwa-status-line__dot" />
        <span className="cwa-status-line__label">{state.status.message}</span>
      </div>
      <ComposeBox onSubmit={handleSubmit} isQueueing={state.isAgentProcessing} disabled={disabled} />
      <BlockModal block={selectedBlock} onClose={() => setSelectedBlock(null)} />
    </div>
  );
}
