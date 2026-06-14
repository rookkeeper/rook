import { useEffect, useReducer, useRef, useState } from "react";
import { Block, UserMessageBlock, ThinkingBlock, AgentTextBlock, ToolBlock } from "../types";
import {
  AgentBackend,
  AgentRunStatus,
  AgentSessionSummary,
} from "../agent";
import { RemoteAgent, type RemoteSessionEvent } from "../remoteAgent";
import type { AcpClientEvent } from "../acpClientTypes";
import type { AcpConfigOption, AcpPermissionOption, AcpPermissionToolCall, AcpPlanEntry, AcpSessionMode } from "../../shared/acp";
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
  recordParentMessageToolStart,
  type ParentMessagePoster,
} from "../parentMessageTool";

type StatusState = { status: AgentRunStatus | "queued"; message: string };
type QueuedMessage = { id: string; text: string };
type PermissionRequestState = {
  requestId: string;
  toolCall: AcpPermissionToolCall;
  options: AcpPermissionOption[];
};
type UsageState = { used: number; size: number; cost?: { amount: number; currency: string } | null };
type ModesState = { currentModeId: string; availableModes: AcpSessionMode[] };
type State = {
  blocks: Block[];
  isAgentProcessing: boolean;
  status: StatusState;
  queuedMessages: QueuedMessage[];
  pendingPermission: PermissionRequestState | null;
  planEntries: AcpPlanEntry[];
  usage: UsageState | null;
  modes: ModesState | null;
  configOptions: AcpConfigOption[];
  lastStopReason: string | null;
};

type Action =
  | { type: "STATUS_CHANGED"; status: AgentRunStatus; message?: string }
  | { type: "USER_MESSAGE_QUEUED"; message: QueuedMessage }
  | { type: "USER_MESSAGE_DEQUEUED"; id: string }
  | { type: "USER_MESSAGE"; text: string; messageId?: string }
  | { type: "AGENT_MESSAGE_CHUNK"; text: string }
  | { type: "AGENT_THOUGHT_CHUNK"; text: string }
  | { type: "TOOL_CALL_STARTED"; toolCallId: string; toolName: string; rawInput?: string }
  | { type: "TOOL_INPUT_DELTA"; toolCallId: string; toolName?: string; delta: string }
  | { type: "TOOL_RUNNING"; toolCallId: string }
  | { type: "TOOL_OUTPUT_DELTA"; toolCallId: string; toolName?: string; delta: string }
  | { type: "TOOL_COMPLETED"; toolCallId: string; toolName: string; output: string }
  | { type: "TOOL_ERROR"; toolCallId: string; toolName: string; error: string }
  | { type: "PERMISSION_REQUESTED"; requestId: string; toolCall: AcpPermissionToolCall; options: AcpPermissionOption[] }
  | { type: "PERMISSION_CLEARED" }
  | { type: "PLAN_UPDATED"; entries: AcpPlanEntry[] }
  | { type: "USAGE_UPDATED"; usage: UsageState }
  | { type: "MODES_UPDATED"; modes: ModesState }
  | { type: "CURRENT_MODE_UPDATED"; modeId: string }
  | { type: "CONFIG_OPTIONS_UPDATED"; configOptions: AcpConfigOption[] }
  | { type: "FINALIZE_BLOCKS" }
  | { type: "RUN_COMPLETED"; stopReason: string }
  | { type: "RUN_FAILED"; error: string; source?: "run" | "connection" | "protocol" };

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

function finalizeBeforeAppending(blocks: Block[]): Block[] {
  return finalizeStreamingBlocks(blocks);
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
        status: { status: action.status, message: action.message ?? action.status },
        isAgentProcessing: action.status !== "idle" && action.status !== "error",
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

    case "USER_MESSAGE": {
      const block: UserMessageBlock = { type: "text", role: "user", text: action.text, isStreaming: false };
      return { ...state, blocks: [...finalizeBeforeAppending(state.blocks), block] };
    }

    case "AGENT_MESSAGE_CHUNK": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.type === "text" && last.role === "assistant" && last.isStreaming) {
        const blocks = [...state.blocks];
        blocks[blocks.length - 1] = { ...last, text: last.text + action.text };
        return { ...state, blocks };
      }
      return {
        ...state,
        blocks: [...finalizeBeforeAppending(state.blocks), { type: "text", role: "assistant", text: action.text, isStreaming: true } as AgentTextBlock],
      };
    }

    case "AGENT_THOUGHT_CHUNK": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.type === "thinking" && last.isStreaming) {
        const blocks = [...state.blocks];
        blocks[blocks.length - 1] = { ...last, thinking: `${last.thinking}${action.text}` };
        return { ...state, blocks };
      }
      return {
        ...state,
        blocks: [...finalizeBeforeAppending(state.blocks), { type: "thinking", thinking: action.text, isStreaming: true } as ThinkingBlock],
      };
    }

    case "TOOL_CALL_STARTED": {
      const exists = state.blocks.some((b) => b.type === "toolBlock" && b.id === action.toolCallId);
      if (exists) return state;

      // Normalize empty‑placeholder rawInput (legacy replay may still carry "{}").
      const normalizedInput = (action.rawInput && action.rawInput !== "{}") ? action.rawInput : undefined;
      return {
        ...state,
        blocks: [
          ...finalizeBeforeAppending(state.blocks),
          {
            type: "toolBlock",
            id: action.toolCallId,
            name: action.toolName,
            status: normalizedInput ? "input_streaming" : "ready",
            arguments: normalizedInput ?? "",
            argumentsStreaming: false,
            result: null,
            isError: false,
          },
        ],
      };
    }

    case "TOOL_INPUT_DELTA": {
      const blocks = [...state.blocks];
      const idx = blocks.findLastIndex((b) => b.type === "toolBlock" && b.id === action.toolCallId);
      if (idx !== -1) {
        const existing = blocks[idx] as ToolBlock;
        blocks[idx] = { ...existing, status: "input_streaming", arguments: action.delta, argumentsStreaming: true };
        return { ...state, blocks };
      }
      return {
        ...state,
        blocks: [
          ...finalizeBeforeAppending(state.blocks),
          {
            type: "toolBlock",
            id: action.toolCallId,
            name: action.toolName ?? "tool",
            status: "input_streaming",
            arguments: action.delta,
            argumentsStreaming: true,
            result: null,
            isError: false,
          },
        ],
      };
    }

    case "TOOL_RUNNING":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.toolCallId, (b) => ({ ...b, status: "running", argumentsStreaming: false })),
      };

    case "TOOL_OUTPUT_DELTA":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.toolCallId, (b) => ({
          ...b,
          status: "running",
          result: `${b.result ?? ""}${action.delta}`,
          isError: false,
          argumentsStreaming: false,
        })),
      };

    case "TOOL_COMPLETED":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.toolCallId, (b) => ({
          ...b,
          status: "completed",
          result: action.output,
          isError: false,
          argumentsStreaming: false,
        })),
      };

    case "TOOL_ERROR":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.toolCallId, (b) => ({
          ...b,
          status: "error",
          result: action.error,
          isError: true,
          argumentsStreaming: false,
        })),
      };

    case "PERMISSION_REQUESTED":
      return {
        ...state,
        pendingPermission: { requestId: action.requestId, toolCall: action.toolCall, options: action.options },
      };

    case "PERMISSION_CLEARED":
      return {
        ...state,
        pendingPermission: null,
      };

    case "PLAN_UPDATED":
      return {
        ...state,
        planEntries: action.entries,
      };

    case "USAGE_UPDATED":
      return {
        ...state,
        usage: action.usage,
      };

    case "MODES_UPDATED":
      return {
        ...state,
        modes: action.modes,
      };

    case "CURRENT_MODE_UPDATED":
      return {
        ...state,
        modes: state.modes ? { ...state.modes, currentModeId: action.modeId } : state.modes,
      };

    case "CONFIG_OPTIONS_UPDATED":
      return {
        ...state,
        configOptions: action.configOptions,
      };

    case "FINALIZE_BLOCKS":
      return {
        ...state,
        blocks: finalizeStreamingBlocks(state.blocks),
      };

    case "RUN_COMPLETED":
      return {
        ...state,
        isAgentProcessing: false,
        pendingPermission: null,
        lastStopReason: action.stopReason,
        status: state.queuedMessages.length > 0
          ? { status: "queued", message: `${state.queuedMessages.length} queued message${state.queuedMessages.length === 1 ? "" : "s"}` }
          : { status: "idle", message: "Ready" },
        blocks: finalizeStreamingBlocks(state.blocks),
      };

    case "RUN_FAILED":
      return {
        ...state,
        isAgentProcessing: false,
        pendingPermission: null,
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
  showAcpSettings?: boolean;
  disabled?: boolean;
  onParentMessage?: ParentMessagePoster | null;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
  replayEvents?: RemoteSessionEvent[];
}

function formatUsage(usage: UsageState | null): string | null {
  if (!usage) return null;
  const pct = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0;
  const base = `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens (${pct}%)`;
  if (!usage.cost) return base;
  return `${base} · ${usage.cost.amount.toFixed(3)} ${usage.cost.currency}`;
}

function displayConfigOptions(configOptions: AcpConfigOption[], hasModes: boolean): AcpConfigOption[] {
  return configOptions.filter((option) => !(hasModes && option.category === "mode"));
}

function optionLabel(option: AcpConfigOption, value: AcpConfigOption["options"][number]): string {
  if (option.category === "model" && value.description) return `${value.name} — ${value.description}`;
  return value.name;
}

export function ChatPanel({
  agentBackend,
  initialSession,
  showAcpSettings = false,
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
    pendingPermission: null,
    planEntries: [],
    usage: null,
    modes: null,
    configOptions: [],
    lastStopReason: null,
  });
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const agentRef = useRef<RemoteAgent | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const isAgentProcessingRef = useRef(false);
  const messageIdRef = useRef(0);
  const parentMessageToolStateRef = useRef(createParentMessageToolState());
  const replayAppliedRef = useRef(false);

  const handleRunCompletion = (stopReason: string) => {
    dispatch({ type: "RUN_COMPLETED", stopReason });
    const nextMessage = queueRef.current.shift();
    if (nextMessage) {
      dispatch({ type: "USER_MESSAGE_DEQUEUED", id: nextMessage.id });
      window.setTimeout(() => startAgentRun(nextMessage.text), 120);
    } else {
      isAgentProcessingRef.current = false;
    }
  };

  const applyAcpEvent = (event: AcpClientEvent) => {
    switch (event.type) {
      case "acp_status_changed":
        dispatch({ type: "STATUS_CHANGED", status: event.status, message: event.message });
        break;
      case "acp_user_message":
        dispatch({ type: "USER_MESSAGE", text: event.text, messageId: event.messageId });
        break;
      case "acp_user_message_chunk":
        break;
      case "acp_agent_message_chunk":
        dispatch({ type: "AGENT_MESSAGE_CHUNK", text: event.text });
        break;
      case "acp_agent_thought_chunk":
        dispatch({ type: "AGENT_THOUGHT_CHUNK", text: event.text });
        break;
      case "acp_tool_call_started": {
        const toolName = event.title;
        recordParentMessageToolStart(parentMessageToolStateRef.current, {
          toolCallId: event.toolCallId,
          toolName,
          rawInput: event.rawInput,
        });
        dispatch({
          type: "TOOL_CALL_STARTED",
          toolCallId: event.toolCallId,
          toolName,
          rawInput: event.rawInput,
        });
        break;
      }
      case "acp_tool_input_delta":
        dispatch({ type: "TOOL_INPUT_DELTA", toolCallId: event.toolCallId, delta: event.delta });
        break;
      case "acp_tool_call_update": {
        const tc = event;
        switch (tc.status) {
          case "in_progress": {
            if (tc.output !== undefined) {
              dispatch({
                type: "TOOL_OUTPUT_DELTA",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                delta: tc.output,
              });
            } else {
              dispatch({ type: "TOOL_RUNNING", toolCallId: tc.toolCallId });
            }
            break;
          }
          case "completed": {
            maybePostParentMessageToolCall(
              parentMessageToolStateRef.current,
              { toolCallId: tc.toolCallId, toolName: tc.toolName },
              onParentMessage,
            );
            dispatch({
              type: "TOOL_COMPLETED",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName ?? "tool",
              output: tc.output ?? "",
            });
            break;
          }
          case "failed":
          case "cancelled":
            dispatch({
              type: "TOOL_ERROR",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName ?? "tool",
              error: tc.output ?? tc.status,
            });
            break;
        }
        break;
      }
      case "acp_permission_request":
        dispatch({ type: "PERMISSION_REQUESTED", requestId: event.requestId, toolCall: event.toolCall, options: event.options });
        break;
      case "acp_plan_update":
        dispatch({ type: "PLAN_UPDATED", entries: event.entries });
        break;
      case "acp_usage_update":
        dispatch({ type: "USAGE_UPDATED", usage: { used: event.used, size: event.size, ...(event.cost !== undefined ? { cost: event.cost } : {}) } });
        break;
      case "acp_modes_state":
        dispatch({ type: "MODES_UPDATED", modes: { currentModeId: event.currentModeId, availableModes: event.availableModes } });
        break;
      case "acp_current_mode_update":
        dispatch({ type: "CURRENT_MODE_UPDATED", modeId: event.modeId });
        break;
      case "acp_config_option_update":
        dispatch({ type: "CONFIG_OPTIONS_UPDATED", configOptions: event.configOptions });
        break;
      case "acp_finalize_blocks":
        dispatch({ type: "FINALIZE_BLOCKS" });
        break;
      case "acp_run_completed":
        handleRunCompletion(event.stopReason);
        break;
      case "acp_run_failed":
        isAgentProcessingRef.current = false;
        dispatch({ type: "RUN_FAILED", error: event.error, source: "run" });
        break;
      case "acp_connection_error":
        isAgentProcessingRef.current = false;
        dispatch({ type: "RUN_FAILED", error: event.error, source: "connection" });
        break;
      case "acp_environment_event":
        if (event.kind === ENVIRONMENT_OFFER_AVAILABLE_KIND && onEnvironmentOfferAvailable) {
          const payload = event.payload;
          if (payload && typeof payload === "object" && "environmentId" in payload && typeof payload.environmentId === "string") {
            const offer = payload as { environmentId: string; sourceName?: unknown; canonicalSourceUrl?: unknown };
            onEnvironmentOfferAvailable({
              environmentId: offer.environmentId,
              ...(typeof offer.sourceName === "string" ? { sourceName: offer.sourceName } : {}),
              ...(typeof offer.canonicalSourceUrl === "string" ? { canonicalSourceUrl: offer.canonicalSourceUrl } : {}),
            });
          }
        }
        if (event.kind === ENVIRONMENT_OFFER_RESOLVED_KIND && onEnvironmentOfferResolved) {
          const payload = event.payload;
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
    for (const event of replayEvents) applyAcpEvent(event);
    dispatch({ type: "FINALIZE_BLOCKS" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let connectTimer = 0;

    const activeAgent = new RemoteAgent({
      backend: agentBackend,
      session: initialSession ?? undefined,
      onAcpEvent: applyAcpEvent,
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

  const handlePermissionDecision = (optionId?: string) => {
    const activeAgent = agentRef.current;
    const pendingPermission = state.pendingPermission;
    if (!activeAgent || !pendingPermission) return;
    dispatch({ type: "PERMISSION_CLEARED" });
    void activeAgent.respondToPermissionRequest(
      pendingPermission.requestId,
      optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
    );
  };

  const handleModeChange = (modeId: string) => {
    const activeAgent = agentRef.current;
    if (!activeAgent) return;
    void activeAgent.setMode(modeId);
  };

  const handleConfigOptionChange = (configId: string, value: string) => {
    const activeAgent = agentRef.current;
    if (!activeAgent) return;
    void activeAgent.setConfigOption(configId, value);
  };

  const visibleConfigOptions = displayConfigOptions(state.configOptions, Boolean(state.modes));
  const usageLabel = formatUsage(state.usage);

  return (
    <div className="cwa-panel">
      {showAcpSettings && (state.modes || visibleConfigOptions.length > 0) && (
        <div className="cwa-acp-bar">
          {state.modes && state.modes.availableModes.length > 0 && (
            <label className="cwa-acp-control">
              <span>Mode</span>
              <select aria-label="Mode" value={state.modes.currentModeId} onChange={(event) => handleModeChange(event.target.value)}>
                {state.modes.availableModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.name}</option>
                ))}
              </select>
            </label>
          )}
          {visibleConfigOptions.map((option) => (
            <label key={option.id} className="cwa-acp-control">
              <span>{option.name}</span>
              <select aria-label={option.name} value={option.currentValue} onChange={(event) => handleConfigOptionChange(option.id, event.target.value)}>
                {option.options.map((value) => (
                  <option key={value.value} value={value.value}>{optionLabel(option, value)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {state.planEntries.length > 0 && (
        <div className="cwa-plan" aria-label="Agent plan">
          <div className="cwa-plan__label">Plan</div>
          <ol className="cwa-plan__list">
            {state.planEntries.map((entry, index) => (
              <li key={`${entry.content}-${index}`} className={`cwa-plan__item cwa-plan__item--${entry.status}`}>
                <span className="cwa-plan__content">{entry.content}</span>
                <span className="cwa-plan__meta">{entry.priority} · {entry.status.replace("_", " ")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
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
      {state.pendingPermission && (
        <div className="cwa-permission">
          <div className="cwa-permission__header">Permission requested</div>
          <div className="cwa-permission__title">{state.pendingPermission.toolCall.title}</div>
          <div className="cwa-permission__kind">{state.pendingPermission.toolCall.kind}</div>
          <div className="cwa-permission__actions">
            {state.pendingPermission.options.map((option) => (
              <button key={option.optionId} type="button" className="cwa-permission__button" onClick={() => handlePermissionDecision(option.optionId)}>
                {option.name}
              </button>
            ))}
            <button type="button" className="cwa-permission__button cwa-permission__button--secondary" onClick={() => handlePermissionDecision()}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className={`cwa-status-line cwa-status-line--${state.status.status}`}>
        <div className="cwa-status-line__primary">
          <span className="cwa-status-line__dot" />
          <span className="cwa-status-line__label">{state.status.message}</span>
        </div>
        {usageLabel && <span className="cwa-status-line__usage">{usageLabel}</span>}
      </div>
      <ComposeBox onSubmit={handleSubmit} isQueueing={state.isAgentProcessing} disabled={disabled} />
      <BlockModal block={selectedBlock} onClose={() => setSelectedBlock(null)} />
    </div>
  );
}
