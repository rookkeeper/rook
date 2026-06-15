import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import type { AgentBackend, AgentSessionSummary, AgentRunStatus } from "../lib/agent";
import type { AcpClientEvent } from "../lib/acpClientTypes";
import type { AcpConfigOption, AcpPermissionOption, AcpPermissionToolCall, AcpPlanEntry, AcpSessionMode } from "../lib/acp";
import {
  ENVIRONMENT_OFFER_AVAILABLE_KIND,
  ENVIRONMENT_OFFER_RESOLVED_KIND,
  type EnvironmentOfferAvailablePayload,
  type EnvironmentOfferResolvedPayload,
} from "../lib/environment";
import type { Block, ToolBlock } from "../lib/types";
import { RemoteAgent } from "../lib/remoteAgent";
import { tokens } from "../theme";
import { MessageThread } from "./MessageThread";
import { ComposeBox } from "./ComposeBox";
import { QueueDisplay } from "./QueueDisplay";
import { StatusLine } from "./StatusLine";
import { PlanDisplay } from "./PlanDisplay";
import { PermissionPrompt } from "./PermissionPrompt";
import { BlockModal } from "./BlockModal";
import { AppButton } from "./AppButton";

type StatusState = { status: AgentRunStatus | "queued"; message: string };
type QueuedMessage = {
  id: string;
  text: string;
  draftText: string;
  isEditing: boolean;
};
type ModesState = { currentModeId: string; availableModes: AcpSessionMode[] };
type PermissionRequestState = {
  requestId: string;
  toolCall: AcpPermissionToolCall;
  options: AcpPermissionOption[];
};
type UsageState = { used: number; size: number; cost?: { amount: number; currency: string } | null };

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
};

type Action =
  | { type: "STATUS_CHANGED"; status: AgentRunStatus; message?: string }
  | { type: "USER_MESSAGE_QUEUED"; message: QueuedMessage }
  | { type: "USER_MESSAGE_DEQUEUED"; id: string }
  | { type: "QUEUED_MESSAGE_EDIT_STARTED"; id: string }
  | { type: "QUEUED_MESSAGE_EDIT_CHANGED"; id: string; text: string }
  | { type: "QUEUED_MESSAGE_EDIT_CANCELLED"; id: string }
  | { type: "QUEUED_MESSAGE_EDIT_SAVED"; id: string }
  | { type: "QUEUED_MESSAGE_RESTORED"; message: QueuedMessage; index: number }
  | { type: "USER_MESSAGE"; text: string }
  | { type: "USER_MESSAGE_CHUNK"; text: string; messageId?: string }
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

function findLastToolBlockIndex(blocks: Block[], toolCallId: string): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b?.type === "toolBlock" && b.id === toolCallId) return i;
  }
  return -1;
}

function updateLastToolBlock(blocks: Block[], toolCallId: string, updateFn: (block: ToolBlock) => ToolBlock): Block[] {
  const next = [...blocks];
  const idx = findLastToolBlockIndex(next, toolCallId);
  if (idx === -1) return blocks;
  next[idx] = updateFn(next[idx] as ToolBlock);
  return next;
}

function queueStatusMessage(count: number): string {
  return `${count} queued message${count === 1 ? "" : "s"}`;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "STATUS_CHANGED":
      return {
        ...state,
        status: { status: action.status, message: action.message ?? action.status },
        isAgentProcessing: action.status !== "idle" && action.status !== "error",
      };
    case "USER_MESSAGE_QUEUED": {
      const queuedMessages = [...state.queuedMessages, action.message];
      return {
        ...state,
        status: { status: "queued", message: queueStatusMessage(queuedMessages.length) },
        queuedMessages,
      };
    }
    case "USER_MESSAGE_DEQUEUED": {
      const queuedMessages = state.queuedMessages.filter((m) => m.id !== action.id);
      return {
        ...state,
        status: queuedMessages.length > 0 ? { status: "queued", message: queueStatusMessage(queuedMessages.length) } : state.status,
        queuedMessages,
      };
    }
    case "QUEUED_MESSAGE_EDIT_STARTED":
      return {
        ...state,
        queuedMessages: state.queuedMessages.map((m) => m.id === action.id ? { ...m, isEditing: true, draftText: m.text } : m),
      };
    case "QUEUED_MESSAGE_EDIT_CHANGED":
      return {
        ...state,
        queuedMessages: state.queuedMessages.map((m) => m.id === action.id ? { ...m, draftText: action.text } : m),
      };
    case "QUEUED_MESSAGE_EDIT_CANCELLED":
      return {
        ...state,
        queuedMessages: state.queuedMessages.map((m) => m.id === action.id ? { ...m, isEditing: false, draftText: m.text } : m),
      };
    case "QUEUED_MESSAGE_EDIT_SAVED":
      return {
        ...state,
        queuedMessages: state.queuedMessages.map((m) => m.id === action.id ? { ...m, text: m.draftText.trim(), draftText: m.draftText.trim(), isEditing: false } : m),
      };
    case "QUEUED_MESSAGE_RESTORED": {
      const queuedMessages = [...state.queuedMessages];
      queuedMessages.splice(action.index, 0, action.message);
      return {
        ...state,
        status: { status: "queued", message: queueStatusMessage(queuedMessages.length) },
        queuedMessages,
      };
    }
    case "USER_MESSAGE":
      return {
        ...state,
        blocks: [...finalizeStreamingBlocks(state.blocks), { type: "text", role: "user", text: action.text, isStreaming: false } as Block],
      };
    case "USER_MESSAGE_CHUNK": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.type === "text" && last.role === "user" && !last.isStreaming) return state;
      if (last && last.type === "text" && last.role === "user" && last.isStreaming) {
        const blocks = [...state.blocks];
        blocks[blocks.length - 1] = { ...last, text: last.text + action.text };
        return { ...state, blocks };
      }
      return {
        ...state,
        blocks: [...finalizeStreamingBlocks(state.blocks), { type: "text", role: "user", text: action.text, isStreaming: true } as Block],
      };
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
        blocks: [...finalizeStreamingBlocks(state.blocks), { type: "text", role: "assistant", text: action.text, isStreaming: true } as Block],
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
        blocks: [...finalizeStreamingBlocks(state.blocks), { type: "thinking", thinking: action.text, isStreaming: true } as Block],
      };
    }
    case "TOOL_CALL_STARTED": {
      const exists = state.blocks.some((b) => b.type === "toolBlock" && b.id === action.toolCallId);
      if (exists) return state;
      const normalizedInput = (action.rawInput && action.rawInput !== "{}") ? action.rawInput : undefined;
      return {
        ...state,
        blocks: [
          ...finalizeStreamingBlocks(state.blocks),
          {
            type: "toolBlock",
            id: action.toolCallId,
            name: action.toolName,
            status: normalizedInput ? "input_streaming" : "ready",
            arguments: normalizedInput ?? "",
            argumentsStreaming: false,
            result: null,
            isError: false,
          } as Block,
        ],
      };
    }
    case "TOOL_INPUT_DELTA": {
      const blocks = [...state.blocks];
      const idx = findLastToolBlockIndex(blocks, action.toolCallId);
      if (idx !== -1) {
        const existing = blocks[idx] as ToolBlock;
        blocks[idx] = { ...existing, status: "input_streaming", arguments: action.delta, argumentsStreaming: true };
        return { ...state, blocks };
      }
      return {
        ...state,
        blocks: [
          ...finalizeStreamingBlocks(state.blocks),
          {
            type: "toolBlock",
            id: action.toolCallId,
            name: action.toolName ?? "tool",
            status: "input_streaming",
            arguments: action.delta,
            argumentsStreaming: true,
            result: null,
            isError: false,
          } as Block,
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
          ...b, status: "running",
          result: `${b.result ?? ""}${action.delta}`,
          isError: false,
          argumentsStreaming: false,
        })),
      };
    case "TOOL_COMPLETED":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.toolCallId, (b) => ({
          ...b, status: "completed", result: action.output, isError: false, argumentsStreaming: false,
        })),
      };
    case "TOOL_ERROR":
      return {
        ...state,
        blocks: updateLastToolBlock(state.blocks, action.toolCallId, (b) => ({
          ...b, status: "error", result: action.error, isError: true, argumentsStreaming: false,
        })),
      };
    case "PERMISSION_REQUESTED":
      return { ...state, pendingPermission: { requestId: action.requestId, toolCall: action.toolCall, options: action.options } };
    case "PERMISSION_CLEARED":
      return { ...state, pendingPermission: null };
    case "PLAN_UPDATED":
      return { ...state, planEntries: action.entries };
    case "USAGE_UPDATED":
      return { ...state, usage: action.usage };
    case "MODES_UPDATED":
      return { ...state, modes: action.modes };
    case "CURRENT_MODE_UPDATED":
      return { ...state, modes: state.modes ? { ...state.modes, currentModeId: action.modeId } : state.modes };
    case "CONFIG_OPTIONS_UPDATED":
      return { ...state, configOptions: action.configOptions };
    case "FINALIZE_BLOCKS":
      return { ...state, blocks: finalizeStreamingBlocks(state.blocks) };
    case "RUN_COMPLETED":
      return {
        ...state,
        isAgentProcessing: false,
        pendingPermission: null,
        status: state.queuedMessages.length > 0
          ? { status: "queued", message: queueStatusMessage(state.queuedMessages.length) }
          : { status: "idle", message: "Ready" },
        blocks: finalizeStreamingBlocks(state.blocks),
      };
    case "RUN_FAILED":
      return {
        ...state,
        isAgentProcessing: false,
        pendingPermission: null,
        status: { status: "error", message: action.error },
        blocks: [...finalizeStreamingBlocks(state.blocks), { type: "error", source: action.source ?? "run", message: action.error } as Block],
      };
    default:
      return state;
  }
}

function displayConfigOptions(configOptions: AcpConfigOption[], hasModes: boolean): AcpConfigOption[] {
  return configOptions.filter((option) => !(hasModes && option.category === "mode"));
}

function optionLabel(option: AcpConfigOption, value: AcpConfigOption["options"][number]): string {
  if (option.category === "model" && value.description) return `${value.name} — ${value.description}`;
  return value.name;
}

const webSelectStyle: CSSProperties = {
  width: "100%",
  maxWidth: 520,
  borderRadius: 10,
  border: `1px solid ${tokens.colors.modifierBorder}`,
  background: tokens.colors.backgroundTertiary,
  color: tokens.colors.textNormal,
  padding: "10px 12px",
  fontSize: 16,
};

function formatUsage(usage: UsageState | null): string | null {
  if (!usage) return null;
  const pct = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0;
  const base = `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens (${pct}%)`;
  if (!usage.cost) return base;
  return `${base} \u00b7 ${usage.cost.amount.toFixed(3)} ${usage.cost.currency}`;
}

interface ChatPanelProps {
  agentBackend: AgentBackend;
  initialSession: AgentSessionSummary;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
  showSettings?: boolean;
}

export function ChatPanel({
  agentBackend, initialSession, onEnvironmentOfferAvailable, onEnvironmentOfferResolved, showSettings = false,
}: ChatPanelProps) {
  const [state, setState] = useState<State>({
    blocks: [],
    isAgentProcessing: false,
    status: { status: "idle", message: "Ready" },
    queuedMessages: [],
    pendingPermission: null,
    planEntries: [],
    usage: null,
    modes: null,
    configOptions: [],
  });
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const agentRef = useRef<RemoteAgent | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const isAgentProcessingRef = useRef(false);
  const messageIdRef = useRef(0);
  const pendingPermissionRef = useRef<PermissionRequestState | null>(null);

  const startAgentRun = useCallback((text: string) => {
    isAgentProcessingRef.current = true;
    agentRef.current?.run(text);
  }, []);

  const handleRunCompletion = useCallback((stopReason: string) => {
    setState((prev) => reducer(prev, { type: "RUN_COMPLETED", stopReason }));
    const next = queueRef.current.shift();
    if (next) {
      setState((prev) => reducer(prev, { type: "USER_MESSAGE_DEQUEUED", id: next.id }));
      window.setTimeout(() => startAgentRun(next.text), 120);
    } else {
      isAgentProcessingRef.current = false;
    }
  }, [startAgentRun]);

  const applyAcpEvent = useCallback((event: AcpClientEvent) => {
    switch (event.type) {
      case "acp_status_changed":
        setState((prev) => reducer(prev, { type: "STATUS_CHANGED", status: event.status, message: event.message }));
        break;
      case "acp_user_message":
        setState((prev) => reducer(prev, { type: "USER_MESSAGE", text: event.text }));
        break;
      case "acp_user_message_chunk":
        setState((prev) => reducer(prev, { type: "USER_MESSAGE_CHUNK", text: event.text, messageId: event.messageId }));
        break;
      case "acp_agent_message_chunk":
        setState((prev) => reducer(prev, { type: "AGENT_MESSAGE_CHUNK", text: event.text }));
        break;
      case "acp_agent_thought_chunk":
        setState((prev) => reducer(prev, { type: "AGENT_THOUGHT_CHUNK", text: event.text }));
        break;
      case "acp_tool_call_started":
        setState((prev) => reducer(prev, { type: "TOOL_CALL_STARTED", toolCallId: event.toolCallId, toolName: event.title, rawInput: event.rawInput }));
        break;
      case "acp_tool_input_delta":
        setState((prev) => reducer(prev, { type: "TOOL_INPUT_DELTA", toolCallId: event.toolCallId, delta: event.delta }));
        break;
      case "acp_tool_call_update":
        if (event.status === "in_progress") {
          const output = event.output;
          if (typeof output === "string") {
            setState((prev) => reducer(prev, { type: "TOOL_OUTPUT_DELTA", toolCallId: event.toolCallId, toolName: event.toolName, delta: output }));
          } else {
            setState((prev) => reducer(prev, { type: "TOOL_RUNNING", toolCallId: event.toolCallId }));
          }
        } else if (event.status === "completed") {
          setState((prev) => reducer(prev, { type: "TOOL_COMPLETED", toolCallId: event.toolCallId, toolName: event.toolName ?? "tool", output: event.output ?? "" }));
        } else if (event.status === "failed" || event.status === "cancelled") {
          setState((prev) => reducer(prev, { type: "TOOL_ERROR", toolCallId: event.toolCallId, toolName: event.toolName ?? "tool", error: event.output ?? event.status }));
        }
        break;
      case "acp_permission_request":
        setState((prev) => reducer(prev, { type: "PERMISSION_REQUESTED", requestId: event.requestId, toolCall: event.toolCall, options: event.options }));
        pendingPermissionRef.current = { requestId: event.requestId, toolCall: event.toolCall, options: event.options };
        break;
      case "acp_plan_update":
        setState((prev) => reducer(prev, { type: "PLAN_UPDATED", entries: event.entries }));
        break;
      case "acp_usage_update":
        setState((prev) => reducer(prev, { type: "USAGE_UPDATED", usage: { used: event.used, size: event.size, ...(event.cost !== undefined ? { cost: event.cost } : {}) } }));
        break;
      case "acp_modes_state":
        setState((prev) => reducer(prev, { type: "MODES_UPDATED", modes: { currentModeId: event.currentModeId, availableModes: event.availableModes } }));
        break;
      case "acp_current_mode_update":
        setState((prev) => reducer(prev, { type: "CURRENT_MODE_UPDATED", modeId: event.modeId }));
        break;
      case "acp_config_option_update":
        setState((prev) => reducer(prev, { type: "CONFIG_OPTIONS_UPDATED", configOptions: event.configOptions }));
        break;
      case "acp_finalize_blocks":
        setState((prev) => reducer(prev, { type: "FINALIZE_BLOCKS" }));
        break;
      case "acp_run_completed":
        handleRunCompletion(event.stopReason);
        break;
      case "acp_run_failed":
        isAgentProcessingRef.current = false;
        setState((prev) => reducer(prev, { type: "RUN_FAILED", error: event.error, source: "run" }));
        break;
      case "acp_connection_error":
        isAgentProcessingRef.current = false;
        setState((prev) => reducer(prev, { type: "RUN_FAILED", error: event.error, source: "connection" }));
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
          if (payload && typeof payload === "object" && "environmentId" in payload && typeof payload.environmentId === "string" && "decision" in payload) {
            const resolved = payload as { environmentId: string; decision?: unknown };
            const decision = resolved.decision;
            if (decision === "approved" || decision === "dismissed" || decision === "unavailable") {
              onEnvironmentOfferResolved({ environmentId: resolved.environmentId, decision });
            }
          }
        }
        break;
    }
  }, [handleRunCompletion, onEnvironmentOfferAvailable, onEnvironmentOfferResolved]);

  useEffect(() => {
    const agent = new RemoteAgent({ backend: agentBackend, session: initialSession, onAcpEvent: applyAcpEvent });
    agentRef.current = agent;
    const timer = window.setTimeout(() => { void agent.connect().catch(() => undefined); }, 0);
    return () => {
      window.clearTimeout(timer);
      if (agentRef.current === agent) agentRef.current = null;
      agent.close();
    };
  }, [agentBackend, initialSession, applyAcpEvent]);

  const createQueuedMessage = (text: string): QueuedMessage => {
    messageIdRef.current += 1;
    const trimmed = text.trim();
    return {
      id: `queued-${messageIdRef.current}`,
      text: trimmed,
      draftText: trimmed,
      isEditing: false,
    };
  };

  const handleSubmit = (text: string) => {
    if (isAgentProcessingRef.current) {
      const msg = createQueuedMessage(text);
      queueRef.current.push(msg);
      setState((prev) => reducer(prev, { type: "USER_MESSAGE_QUEUED", message: msg }));
      return;
    }
    startAgentRun(text);
  };

  const handleStop = () => {
    void agentRef.current?.cancel();
  };

  const handleModeChange = (modeId: string) => {
    void agentRef.current?.setMode(modeId);
  };

  const handleConfigOptionChange = (configId: string, value: string) => {
    void agentRef.current?.setConfigOption(configId, value);
  };

  const handlePermissionDecision = (optionId?: string) => {
    const pending = pendingPermissionRef.current;
    if (!pending) return;
    setState((prev) => reducer(prev, { type: "PERMISSION_CLEARED" }));
    pendingPermissionRef.current = null;
    void agentRef.current?.respondToPermissionRequest(
      pending.requestId,
      optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
    );
  };

  const handleQueueSendNow = (id: string) => {
    const queueIndex = queueRef.current.findIndex((m) => m.id === id);
    if (queueIndex === -1) return;
    const [msg] = queueRef.current.splice(queueIndex, 1);
    setState((prev) => reducer(prev, { type: "USER_MESSAGE_DEQUEUED", id }));
    void agentRef.current?.sendSteeringMessage(msg.text).catch((error) => {
      const restored = { ...msg, isEditing: false, draftText: msg.text };
      queueRef.current.splice(Math.min(queueIndex, queueRef.current.length), 0, restored);
      setState((prev) => {
        const next = reducer(prev, { type: "QUEUED_MESSAGE_RESTORED", message: restored, index: Math.min(queueIndex, prev.queuedMessages.length) });
        return reducer(next, { type: "RUN_FAILED", error: error instanceof Error ? error.message : String(error), source: "run" });
      });
    });
  };

  const handleQueueDelete = (id: string) => {
    queueRef.current = queueRef.current.filter((m) => m.id !== id);
    setState((prev) => reducer(prev, { type: "USER_MESSAGE_DEQUEUED", id }));
  };

  const handleQueueEditStart = (id: string) => {
    setState((prev) => reducer(prev, { type: "QUEUED_MESSAGE_EDIT_STARTED", id }));
  };

  const handleQueueEditChange = (id: string, text: string) => {
    queueRef.current = queueRef.current.map((m) => m.id === id ? { ...m, draftText: text } : m);
    setState((prev) => reducer(prev, { type: "QUEUED_MESSAGE_EDIT_CHANGED", id, text }));
  };

  const handleQueueEditCancel = (id: string) => {
    queueRef.current = queueRef.current.map((m) => m.id === id ? { ...m, draftText: m.text, isEditing: false } : m);
    setState((prev) => reducer(prev, { type: "QUEUED_MESSAGE_EDIT_CANCELLED", id }));
  };

  const handleQueueSaveEdit = (id: string) => {
    queueRef.current = queueRef.current.map((m) => m.id === id ? { ...m, text: m.draftText.trim(), draftText: m.draftText.trim(), isEditing: false } : m);
    setState((prev) => reducer(prev, { type: "QUEUED_MESSAGE_EDIT_SAVED", id }));
  };

  const visibleConfigOptions = displayConfigOptions(state.configOptions, Boolean(state.modes));
  const usageLabel = formatUsage(state.usage);

  return (
    <View style={styles.panel}>
      {showSettings && (
        <View style={styles.settingsBar}>
          {state.modes && state.modes.availableModes.length > 0 && (
            <View style={styles.settingGroup}>
              <Text style={styles.settingLabel}>Mode</Text>
              {Platform.OS === "web" ? (
                <select
                  aria-label="Mode"
                  value={state.modes.currentModeId}
                  onChange={(event) => handleModeChange(event.target.value)}
                  style={webSelectStyle}
                >
                  {state.modes.availableModes.map((mode) => (
                    <option key={mode.id} value={mode.id}>{mode.name}</option>
                  ))}
                </select>
              ) : (
                <View style={styles.settingOptions}>
                  {state.modes.availableModes.map((mode) => (
                    <AppButton
                      key={mode.id}
                      label={mode.name}
                      kind={mode.id === state.modes?.currentModeId ? "primary" : "secondary"}
                      onPress={() => handleModeChange(mode.id)}
                      compact
                    />
                  ))}
                </View>
              )}
            </View>
          )}
          {visibleConfigOptions.map((option) => (
            <View key={option.id} style={styles.settingGroup}>
              <Text style={styles.settingLabel}>{option.name}</Text>
              {Platform.OS === "web" ? (
                <select
                  aria-label={option.name}
                  value={option.currentValue}
                  onChange={(event) => handleConfigOptionChange(option.id, event.target.value)}
                  style={webSelectStyle}
                >
                  {option.options.map((value) => (
                    <option key={value.value} value={value.value}>{optionLabel(option, value)}</option>
                  ))}
                </select>
              ) : (
                <View style={styles.settingOptions}>
                  {option.options.map((value) => (
                    <AppButton
                      key={value.value}
                      label={value.name}
                      kind={value.value === option.currentValue ? "primary" : "secondary"}
                      onPress={() => handleConfigOptionChange(option.id, value.value)}
                      compact
                    />
                  ))}
                </View>
              )}
            </View>
          ))}
          {!state.modes && state.configOptions.length === 0 && (
            <Text style={styles.settingEmpty}>No ACP settings reported yet.</Text>
          )}
        </View>
      )}
      <PlanDisplay entries={state.planEntries} />
      <MessageThread
        blocks={state.blocks}
        isStreaming={state.isAgentProcessing}
        onOpenBlock={setSelectedBlock}
      />
      <View style={styles.bottomRail}>
        <QueueDisplay
          messages={state.queuedMessages}
          onEditStart={handleQueueEditStart}
          onEditChange={handleQueueEditChange}
          onEditCancel={handleQueueEditCancel}
          onEditSave={handleQueueSaveEdit}
          onSendNow={handleQueueSendNow}
          onDelete={handleQueueDelete}
        />
        {state.pendingPermission && (
          <PermissionPrompt
            toolCall={state.pendingPermission.toolCall}
            options={state.pendingPermission.options}
            onDecide={handlePermissionDecision}
          />
        )}
        <StatusLine status={state.status.status} message={state.status.message} usageLabel={usageLabel} />
        <ComposeBox
          isAgentProcessing={state.isAgentProcessing}
          onSubmit={handleSubmit}
          onStop={handleStop}
        />
      </View>
      <BlockModal block={selectedBlock} onClose={() => setSelectedBlock(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: tokens.colors.backgroundSecondary,
  },
  settingsBar: {
    padding: tokens.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.modifierBorder,
    backgroundColor: tokens.colors.headerBg,
    gap: tokens.spacing.sm,
  },
  settingGroup: {
    gap: tokens.spacing.xxs,
  },
  settingLabel: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
  },
  settingOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  bottomRail: {
    backgroundColor: tokens.colors.backgroundSecondary,
  },
  settingEmpty: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
});
