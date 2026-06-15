import type { AcpClientEvent } from "../lib/acpClientTypes";
import {
  ENVIRONMENT_OFFER_AVAILABLE_KIND,
  ENVIRONMENT_OFFER_RESOLVED_KIND,
  type EnvironmentOfferAvailablePayload,
  type EnvironmentOfferResolvedPayload,
} from "../lib/environment";
import type { ChatSessionAction, PermissionRequestState, UsageState } from "./chatSessionState";

export interface ApplyAcpEventHandlers {
  dispatch: (action: ChatSessionAction) => void;
  onRunCompleted: (stopReason: string) => void;
  onRunFailed: (error: string, source: "run" | "connection") => void;
  onPermissionStateChange: (permission: PermissionRequestState | null) => void;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
}

export function applyAcpEvent(event: AcpClientEvent, handlers: ApplyAcpEventHandlers): void {
  switch (event.type) {
    case "acp_status_changed":
      handlers.dispatch({ type: "STATUS_CHANGED", status: event.status, message: event.message });
      break;
    case "acp_user_message":
      handlers.dispatch({ type: "USER_MESSAGE", text: event.text });
      break;
    case "acp_user_message_chunk":
      handlers.dispatch({ type: "USER_MESSAGE_CHUNK", text: event.text, messageId: event.messageId });
      break;
    case "acp_agent_message_chunk":
      handlers.dispatch({ type: "AGENT_MESSAGE_CHUNK", text: event.text });
      break;
    case "acp_agent_thought_chunk":
      handlers.dispatch({ type: "AGENT_THOUGHT_CHUNK", text: event.text });
      break;
    case "acp_tool_call_started":
      handlers.dispatch({ type: "TOOL_CALL_STARTED", toolCallId: event.toolCallId, toolName: event.title, rawInput: event.rawInput });
      break;
    case "acp_tool_input_delta":
      handlers.dispatch({ type: "TOOL_INPUT_DELTA", toolCallId: event.toolCallId, delta: event.delta });
      break;
    case "acp_tool_call_update":
      applyToolCallUpdate(event, handlers.dispatch);
      break;
    case "acp_permission_request": {
      const permission = { requestId: event.requestId, toolCall: event.toolCall, options: event.options } satisfies PermissionRequestState;
      handlers.dispatch({ type: "PERMISSION_REQUESTED", ...permission });
      handlers.onPermissionStateChange(permission);
      break;
    }
    case "acp_plan_update":
      handlers.dispatch({ type: "PLAN_UPDATED", entries: event.entries });
      break;
    case "acp_usage_update": {
      const usage: UsageState = { used: event.used, size: event.size, ...(event.cost !== undefined ? { cost: event.cost } : {}) };
      handlers.dispatch({ type: "USAGE_UPDATED", usage });
      break;
    }
    case "acp_modes_state":
      handlers.dispatch({ type: "MODES_UPDATED", modes: { currentModeId: event.currentModeId, availableModes: event.availableModes } });
      break;
    case "acp_current_mode_update":
      handlers.dispatch({ type: "CURRENT_MODE_UPDATED", modeId: event.modeId });
      break;
    case "acp_config_option_update":
      handlers.dispatch({ type: "CONFIG_OPTIONS_UPDATED", configOptions: event.configOptions });
      break;
    case "acp_finalize_blocks":
      handlers.dispatch({ type: "FINALIZE_BLOCKS" });
      break;
    case "acp_run_completed":
      handlers.onRunCompleted(event.stopReason);
      break;
    case "acp_run_failed":
      handlers.onRunFailed(event.error, "run");
      break;
    case "acp_connection_error":
      handlers.onRunFailed(event.error, "connection");
      break;
    case "acp_environment_event":
      applyEnvironmentEvent(event.kind, event.payload, handlers);
      break;
  }
}

function applyToolCallUpdate(
  event: Extract<AcpClientEvent, { type: "acp_tool_call_update" }>,
  dispatch: ApplyAcpEventHandlers["dispatch"],
): void {
  if (event.status === "in_progress") {
    const output = event.output;
    if (typeof output === "string") {
      dispatch({ type: "TOOL_OUTPUT_DELTA", toolCallId: event.toolCallId, toolName: event.toolName, delta: output });
    } else {
      dispatch({ type: "TOOL_RUNNING", toolCallId: event.toolCallId });
    }
    return;
  }

  if (event.status === "completed") {
    dispatch({ type: "TOOL_COMPLETED", toolCallId: event.toolCallId, toolName: event.toolName ?? "tool", output: event.output ?? "" });
    return;
  }

  if (event.status === "failed" || event.status === "cancelled") {
    dispatch({ type: "TOOL_ERROR", toolCallId: event.toolCallId, toolName: event.toolName ?? "tool", error: event.output ?? event.status });
  }
}

function applyEnvironmentEvent(kind: string, payload: unknown, handlers: ApplyAcpEventHandlers): void {
  if (kind === ENVIRONMENT_OFFER_AVAILABLE_KIND && handlers.onEnvironmentOfferAvailable) {
    const offer = parseEnvironmentOfferAvailable(payload);
    if (offer) handlers.onEnvironmentOfferAvailable(offer);
  }

  if (kind === ENVIRONMENT_OFFER_RESOLVED_KIND && handlers.onEnvironmentOfferResolved) {
    const resolved = parseEnvironmentOfferResolved(payload);
    if (resolved) handlers.onEnvironmentOfferResolved(resolved);
  }
}

function parseEnvironmentOfferAvailable(payload: unknown): EnvironmentOfferAvailablePayload | null {
  if (!payload || typeof payload !== "object" || !("environmentId" in payload) || typeof payload.environmentId !== "string") return null;
  const offer = payload as { environmentId: string; sourceName?: unknown; canonicalSourceUrl?: unknown };
  return {
    environmentId: offer.environmentId,
    ...(typeof offer.sourceName === "string" ? { sourceName: offer.sourceName } : {}),
    ...(typeof offer.canonicalSourceUrl === "string" ? { canonicalSourceUrl: offer.canonicalSourceUrl } : {}),
  };
}

function parseEnvironmentOfferResolved(payload: unknown): EnvironmentOfferResolvedPayload | null {
  if (!payload || typeof payload !== "object" || !("environmentId" in payload) || typeof payload.environmentId !== "string" || !("decision" in payload)) return null;
  const resolved = payload as { environmentId: string; decision?: unknown };
  const decision = resolved.decision;
  if (decision !== "approved" && decision !== "dismissed" && decision !== "unavailable") return null;
  return { environmentId: resolved.environmentId, decision };
}
