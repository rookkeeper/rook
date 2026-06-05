import type { AgentToolCallStartedEvent, AgentToolInputDeltaEvent, AgentToolCallReadyEvent } from "./agent";

export const PARENT_MESSAGE_TOOL_NAME = "message_parent";

export type ParentMessagePoster = (message: unknown) => void;

type ParentMessageToolDraft = {
  toolName: string;
  input: string;
  sent: boolean;
};

export type ParentMessageToolState = Map<string, ParentMessageToolDraft>;

export function createParentMessageToolState(): ParentMessageToolState {
  return new Map();
}

export function recordParentMessageToolStart(state: ParentMessageToolState, event: AgentToolCallStartedEvent): void {
  if (event.toolName !== PARENT_MESSAGE_TOOL_NAME) return;
  state.set(event.toolCallId, { toolName: event.toolName, input: event.rawInput ?? "", sent: false });
}

export function recordParentMessageToolInputDelta(state: ParentMessageToolState, event: AgentToolInputDeltaEvent): void {
  const draft = state.get(event.toolCallId);
  if (draft) {
    draft.input += event.delta;
    return;
  }
  if (event.toolName === PARENT_MESSAGE_TOOL_NAME) {
    state.set(event.toolCallId, { toolName: event.toolName, input: event.delta, sent: false });
  }
}

function parseParentMessagePayload(input: string): unknown {
  const parsed = JSON.parse(input) as unknown;
  if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
    return (parsed as { message: unknown }).message;
  }
  return parsed;
}

export function maybePostParentMessageToolCall(
  state: ParentMessageToolState,
  event: AgentToolCallReadyEvent,
  postParentMessage: ParentMessagePoster | null | undefined,
): void {
  const draft = state.get(event.toolCallId);
  if (!draft || draft.sent || draft.toolName !== PARENT_MESSAGE_TOOL_NAME || !postParentMessage) return;

  draft.sent = true;

  try {
    postParentMessage(parseParentMessagePayload(draft.input));
  } catch {
    // The server-side tool intentionally returns success regardless. Mirroring that,
    // client-side relay failures are non-fatal and should not interrupt the chat UI.
  }
}
