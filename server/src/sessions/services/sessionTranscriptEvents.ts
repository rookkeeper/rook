import type { JsonObject, JsonRpcMessage } from "../../runtime/SessionRuntime.js";

export interface NormalizedTranscriptEvent extends Record<string, unknown> {
  kind: string;
}

export function normalizedEventsFromRuntimeMessage(message: JsonRpcMessage): NormalizedTranscriptEvent[] {
  const method = typeof message.method === "string" ? message.method : undefined;
  if (method !== "session/update") return [];
  const params = object(message.params);
  const update = object(params?.update);
  const sessionUpdate = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : undefined;
  if (!sessionUpdate) return [];

  switch (sessionUpdate) {
    case "user_message_chunk": {
      const text = contentText(update?.content);
      return text ? [{ kind: "user_message_chunk", text }] : [];
    }
    case "agent_message_chunk": {
      const text = contentText(update?.content);
      return text ? [{ kind: "agent_message_chunk", text }] : [];
    }
    case "agent_thought_chunk": {
      const text = contentText(update?.content);
      return text ? [{ kind: "agent_thought_chunk", text }] : [];
    }
    case "tool_call": {
      const toolCallId = typeof update?.toolCallId === "string" ? update.toolCallId : undefined;
      if (!toolCallId) return [];
      return [{
        kind: "tool_call",
        toolCallId,
        title: typeof update?.title === "string" ? update.title : "Tool",
        toolKind: typeof update?.kind === "string" ? update.kind : "",
        status: typeof update?.status === "string" ? update.status : "pending",
        // pi-acp represents bash commands as ACP terminal calls: the command is
        // carried in the title and terminal_info, rather than rawInput.
        rawInput: update?.rawInput ?? terminalCommandInput(update),
      }];
    }
    case "tool_call_update": {
      const toolCallId = typeof update?.toolCallId === "string" ? update.toolCallId : undefined;
      if (!toolCallId) return [];
      return [{
        kind: "tool_call_update",
        toolCallId,
        status: typeof update?.status === "string" ? update.status : "",
        toolName: typeof update?.toolName === "string" ? update.toolName : null,
        rawOutput: update?.rawOutput ?? terminalOutputData(update) ?? null,
        outputDelta: terminalOutputData(update) ?? null,
      }];
    }
    case "plan_update": {
      const entries = Array.isArray(update?.entries) ? update.entries : [];
      return [{ kind: "plan_update", entries }];
    }
    case "usage_update": {
      return [{ kind: "usage_update", used: update?.used ?? null, size: update?.size ?? null, cost: update?.cost ?? null }];
    }
    default:
      return [];
  }
}

export function runCompletedEvent(stopReason: string): NormalizedTranscriptEvent {
  return { kind: "run_completed", stopReason };
}

export function runFailedEvent(message: string): NormalizedTranscriptEvent {
  return { kind: "run_failed", message };
}

const CONTENT_KINDS = new Set(["user_message_chunk", "agent_message_chunk", "agent_thought_chunk", "tool_call"]);

/**
 * Whether a transcript holds conversation worth preserving. Run, plan, and
 * usage markers are server bookkeeping: they can exist for a session that was
 * never prompted successfully, so they do not count as content.
 */
export function transcriptHasContent(events: Array<Record<string, unknown>>): boolean {
  return events.some((event) => typeof event.kind === "string" && CONTENT_KINDS.has(event.kind));
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function contentText(content: unknown): string | undefined {
  const value = object(content);
  return typeof value?.text === "string" ? value.text : undefined;
}

function terminalCommandInput(update: JsonObject | undefined): JsonObject | null {
  const meta = object(update?._meta);
  const terminalInfo = object(meta?.terminal_info);
  if (typeof terminalInfo?.terminal_id !== "string" || typeof update?.title !== "string") return null;
  return { command: update.title };
}

function terminalOutputData(update: JsonObject | undefined): string | undefined {
  const meta = object(update?._meta);
  const terminalOutput = object(meta?.terminal_output);
  return typeof terminalOutput?.data === "string" ? terminalOutput.data : undefined;
}
