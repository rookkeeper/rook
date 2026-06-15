import type { AgentRunStatus } from "../lib/agent";
import type { AcpConfigOption, AcpPermissionOption, AcpPermissionToolCall, AcpPlanEntry, AcpSessionMode } from "../lib/acp";
import type { Block, ToolBlock } from "../lib/types";

export type StatusState = { status: AgentRunStatus | "queued"; message: string };
export type QueuedMessage = {
  id: string;
  text: string;
  draftText: string;
  isEditing: boolean;
};
export type ModesState = { currentModeId: string; availableModes: AcpSessionMode[] };
export type PermissionRequestState = {
  requestId: string;
  toolCall: AcpPermissionToolCall;
  options: AcpPermissionOption[];
};
export type UsageState = { used: number; size: number; cost?: { amount: number; currency: string } | null };

export type ChatSessionState = {
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

export type ChatSessionAction =
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

export function createInitialChatSessionState(): ChatSessionState {
  return {
    blocks: [],
    isAgentProcessing: false,
    status: { status: "idle", message: "Ready" },
    queuedMessages: [],
    pendingPermission: null,
    planEntries: [],
    usage: null,
    modes: null,
    configOptions: [],
  };
}

export function finalizeStreamingBlocks(blocks: Block[]): Block[] {
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

export function reduceChatSession(state: ChatSessionState, action: ChatSessionAction): ChatSessionState {
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
