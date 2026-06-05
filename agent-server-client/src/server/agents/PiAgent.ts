import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { BaseAgent } from "./BaseAgent.js";
import { AgentRestartMetadata, AgentSessionRecord } from "./sessionLog.js";

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
};

export interface PiAgentOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  startupTimeoutMs?: number;
  skillPaths?: string[];
  extensionPaths?: string[];
  agentName?: string;
}

export interface PiSessionState {
  sessionId?: string;
  sessionFile?: string;
  model?: JsonObject | null;
  isStreaming?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
}

const DEFAULT_ARGS = ["--mode", "rpc"];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isObject(value)) return stringifyUnknown(value);

  const content = value.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isObject(item) && typeof item.text === "string") return item.text;
        return stringifyUnknown(item);
      })
      .join("\n");
  }

  if (typeof value.error === "string") return value.error;
  if (typeof value.message === "string") return value.message;
  return stringifyUnknown(value);
}

function getMessageId(message: unknown): string | undefined {
  if (!isObject(message)) return undefined;
  if (typeof message.id === "string") return message.id;
  if (typeof message.entryId === "string") return message.entryId;
  if (typeof message.timestamp === "number") return `message-${message.timestamp}`;
  return undefined;
}

function getAssistantMessageMetadata(message: unknown): { model?: string; provider?: string } {
  if (!isObject(message)) return {};
  return {
    model: typeof message.model === "string" ? message.model : undefined,
    provider: typeof message.provider === "string" ? message.provider : undefined,
  };
}

function getToolCallName(toolCall: unknown, fallback = "tool"): string {
  if (isObject(toolCall) && typeof toolCall.name === "string") return toolCall.name;
  return fallback;
}

function getToolCallArgs(toolCall: unknown): unknown {
  if (!isObject(toolCall)) return undefined;
  if ("arguments" in toolCall) return toolCall.arguments;
  if ("args" in toolCall) return toolCall.args;
  return undefined;
}

function getContentToolCall(content: unknown, contentIndex: number): JsonObject | undefined {
  if (!Array.isArray(content)) return undefined;
  const item = content[contentIndex];
  if (isObject(item) && item.type === "toolCall") return item;
  return undefined;
}

function getToolCallFromAssistantEvent(assistantEvent: JsonObject, message: unknown, contentIndex: number): JsonObject | undefined {
  if (isObject(assistantEvent.toolCall)) return assistantEvent.toolCall;

  const partial = assistantEvent.partial;
  if (isObject(partial)) {
    const partialToolCall = getContentToolCall(partial.content, contentIndex);
    if (partialToolCall) return partialToolCall;
  }

  if (isObject(message)) return getContentToolCall(message.content, contentIndex);
  return undefined;
}

function getRequiredToolCallId(toolCall: unknown): string | undefined {
  return isObject(toolCall) && typeof toolCall.id === "string" ? toolCall.id : undefined;
}

function toolDraftKey(messageId: string | undefined, contentIndex: number): string {
  return `${messageId ?? "unknown-message"}:${contentIndex}`;
}

export class PiAgent extends BaseAgent {
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIndex = 0;
  private runResolve: (() => void) | null = null;
  private runReject: ((error: Error) => void) | null = null;
  private currentRunCompleted = false;
  private currentAssistantMessageId: string | undefined;
  private lastAssistantText = "";
  private producedAssistantContent = false;
  private stopping = false;
  private sessionState: PiSessionState = {};
  private toolCallDrafts = new Map<string, { toolCallId: string; toolName: string; rawInput: string }>();

  constructor(private options: PiAgentOptions = {}, restartMetadata?: AgentRestartMetadata) {
    super(restartMetadata);
  }

  protected get agentName(): string {
    return this.options.agentName ?? super.agentName;
  }

  get sessionId(): string | undefined {
    return this.sessionState.sessionId;
  }

  get state(): PiSessionState {
    return { ...this.sessionState };
  }

  protected getSkillPaths(metadata?: AgentRestartMetadata): string[] {
    const metadataSkillPaths = Array.isArray(metadata?.skillPaths)
      ? metadata.skillPaths.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    const optionSkillPaths = this.options.skillPaths?.filter((value) => value.length > 0) ?? [];
    return [...new Set([...metadataSkillPaths, ...optionSkillPaths])];
  }

  protected getExtensionPaths(): string[] {
    return [...new Set(this.options.extensionPaths?.filter((value) => value.length > 0) ?? [])];
  }

  protected getPiArgs(metadata?: AgentRestartMetadata): string[] {
    const args = [...(this.options.args ?? DEFAULT_ARGS)];
    for (const extensionPath of this.getExtensionPaths()) args.push("-e", extensionPath);
    for (const skillPath of this.getSkillPaths(metadata)) args.push("--skill", skillPath);
    const session = metadata?.sessionFile ?? metadata?.sessionId;
    if (typeof session === "string" && session.length > 0) args.push("--session", session);
    return args;
  }

  protected async start(): Promise<void> {
    await this.startProcess();
  }

  protected async restart(metadata: AgentRestartMetadata): Promise<void> {
    await this.startProcess(metadata);
    const response = await this.sendCommandWithTimeout("get_state", {}, this.options.startupTimeoutMs ?? 15_000);
    if (response.success === false) throw new Error(String(response.error ?? "get_state failed"));
    if (isObject(response.data)) this.applySessionState(response.data);
  }

  private async startProcess(metadata?: AgentRestartMetadata): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const command = this.options.command ?? "pi";
      const args = this.getPiArgs(metadata);
      const cwd = this.options.cwd ?? process.cwd();

      const child = spawn(command, args, { cwd, stdio: "pipe" });
      this.process = child;
      this.attachJsonlReader(child.stdout, (line) => this.handleStdoutLine(line));
      this.attachJsonlReader(child.stderr, (line) => this.handleStderrLine(line));

      child.on("error", (error) => {
        this.emitSessionEvent({ type: "connection_error", error: error.message });
        reject(error);
      });

      child.on("exit", (code, signal) => {
        if (this.stopping) return;
        const message = `Pi RPC process exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`;
        if (this.runReject) this.runReject(new Error(message));
        this.emitSessionEvent({ type: "connection_error", error: message });
      });

      resolve();
    });

    return this.startPromise;
  }

  protected async registerSession(): Promise<AgentSessionRecord> {
    const response = await this.sendCommandWithTimeout("get_state", {}, this.options.startupTimeoutMs ?? 15_000);
    if (response.success === false) throw new Error(String(response.error ?? "get_state failed"));
    if (isObject(response.data)) this.applySessionState(response.data);

    return this.createSessionRecord({
      sessionId: this.sessionState.sessionId,
      sessionFile: this.sessionState.sessionFile,
      skillPaths: this.getSkillPaths(),
    });
  }

  protected async runImpl(userMessage: string): Promise<void> {

    this.currentRunCompleted = false;
    this.lastAssistantText = "";
    this.producedAssistantContent = false;
    this.toolCallDrafts.clear();
    this.emitSessionEvent({ type: "user_message", text: userMessage, queued: false });

    const response = await this.sendCommand("prompt", { message: userMessage });
    if (response.success === false) {
      const error = new Error(String(response.error ?? "Pi prompt was rejected."));
      this.emitSessionEvent({ type: "run_failed", error: error.message });
      throw error;
    }

    return new Promise<void>((resolve, reject) => {
      this.runResolve = resolve;
      this.runReject = reject;
    });
  }

  protected async stopImpl(): Promise<void> {
    this.rejectRun(new Error("Pi agent stopped."));
    if (!this.process) return;
    this.stopping = true;
    this.process.kill("SIGTERM");
    this.process = null;
    this.startPromise = null;
  }

  protected sendCommand(type: string, payload: JsonObject = {}): Promise<JsonObject> {
    if (!this.process?.stdin.writable) return Promise.reject(new Error("Pi RPC process is not writable."));

    this.requestIndex += 1;
    const id = `pi-${Date.now()}-${this.requestIndex}`;
    const command = { id, type, ...payload };

    return new Promise<JsonObject>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process?.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  private sendCommandWithTimeout(type: string, payload: JsonObject, timeoutMs: number): Promise<JsonObject> {
    return new Promise<JsonObject>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Pi RPC ${type} response.`)), timeoutMs);
      this.sendCommand(type, payload)
        .then((response) => {
          clearTimeout(timeout);
          resolve(response);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private attachJsonlReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    stream.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;

        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.trim()) onLine(line);
      }
    });

    stream.on("end", () => {
      buffer += decoder.end();
      if (buffer.trim()) onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    });
  }

  private handleStdoutLine(line: string): void {
    let event: JsonObject;
    try {
      event = JSON.parse(line) as JsonObject;
    } catch (error) {
      this.emitSessionEvent({ type: "protocol_error", error: `Failed to parse Pi JSONL: ${String(error)}` });
      return;
    }

    if (event.type === "response" && typeof event.id === "string") {
      const pending = this.pendingRequests.get(event.id);
      if (pending) {
        this.pendingRequests.delete(event.id);
        pending.resolve(event);
      }
      return;
    }

    this.handleEvent(event);
  }

  private handleStderrLine(line: string): void {
    // Pi should emit protocol data on stdout. Keep stderr as connection diagnostics.
    if (line.trim()) this.emitSessionEvent({ type: "environment_event", kind: "pi_stderr", payload: { line } });
  }

  private applySessionState(data: JsonObject): void {
    this.sessionState = {
      sessionId: typeof data.sessionId === "string" ? data.sessionId : this.sessionState.sessionId,
      sessionFile: typeof data.sessionFile === "string" ? data.sessionFile : this.sessionState.sessionFile,
      model: isObject(data.model) ? data.model : null,
      isStreaming: typeof data.isStreaming === "boolean" ? data.isStreaming : undefined,
      messageCount: typeof data.messageCount === "number" ? data.messageCount : undefined,
      pendingMessageCount: typeof data.pendingMessageCount === "number" ? data.pendingMessageCount : undefined,
    };
  }

  private handleEvent(event: JsonObject): void {
    switch (event.type) {
      case "agent_start":
        this.emitSessionEvent({ type: "status_changed", status: "busy", message: "Pi agent is working" });
        break;
      case "agent_end":
        this.finishRun();
        break;
      case "turn_start":
        this.emitSessionEvent({ type: "status_changed", status: "busy", message: "Pi turn started" });
        break;
      case "turn_end":
        break;
      case "message_start":
        this.handleMessageStart(event);
        break;
      case "message_update":
        this.handleMessageUpdate(event);
        break;
      case "message_end":
        this.handleMessageEnd(event);
        break;
      case "tool_execution_start":
        this.handleToolExecutionStart(event);
        break;
      case "tool_execution_update":
        this.handleToolExecutionUpdate(event);
        break;
      case "tool_execution_end":
        this.handleToolExecutionEnd(event);
        break;
      case "queue_update":
        this.emitSessionEvent({ type: "status_changed", status: "queued", message: "Pi queue updated" });
        break;
      case "compaction_start":
        this.emitSessionEvent({ type: "status_changed", status: "thinking", message: "Compacting context…" });
        break;
      case "compaction_end":
        if (event.errorMessage) this.emitSessionEvent({ type: "run_failed", error: String(event.errorMessage) });
        break;
      case "auto_retry_start":
        this.emitSessionEvent({ type: "status_changed", status: "retrying", message: String(event.errorMessage ?? "Retrying") });
        break;
      case "auto_retry_end":
        if (event.success === false) this.emitSessionEvent({ type: "run_failed", error: String(event.finalError ?? "Auto retry failed") });
        break;
      case "extension_error":
        this.emitSessionEvent({ type: "run_failed", error: String(event.error ?? "Pi extension error") });
        break;
      case "extension_ui_request":
        this.emitSessionEvent({ type: "environment_event", kind: "pi_extension_ui_request", payload: event });
        break;
      default:
        this.emitSessionEvent({ type: "environment_event", kind: "pi_unknown_event", payload: event });
    }
  }

  private handleMessageStart(event: JsonObject): void {
    const message = event.message;
    if (isObject(message) && message.role !== "assistant") return;

    const id = getMessageId(message) ?? `assistant-${Date.now()}`;
    this.currentAssistantMessageId = id;
    const metadata = getAssistantMessageMetadata(message);
    this.emitSessionEvent({ type: "assistant_message_started", id, ...metadata });
  }

  private handleMessageUpdate(event: JsonObject): void {
    const assistantEvent = event.assistantMessageEvent;
    if (!isObject(assistantEvent)) return;

    const messageId = getMessageId(event.message) ?? this.currentAssistantMessageId;
    if (messageId) this.currentAssistantMessageId = messageId;

    const contentIndex = typeof assistantEvent.contentIndex === "number" ? assistantEvent.contentIndex : 0;

    // Track whether this turn produced any assistant content. A turn that ends with
    // none usually means Pi failed silently (e.g. an invalid/expired auth token),
    // which we surface as an explicit error in finishRun rather than a clean completion.
    if (
      assistantEvent.type === "text_start"
      || assistantEvent.type === "text_delta"
      || assistantEvent.type === "thinking_start"
      || assistantEvent.type === "thinking_delta"
      || assistantEvent.type === "toolcall_start"
      || assistantEvent.type === "toolcall_delta"
    ) {
      this.producedAssistantContent = true;
    }

    switch (assistantEvent.type) {
      case "text_start":
        this.emitSessionEvent({ type: "status_changed", status: "streaming", message: "Pi is responding" });
        break;
      case "text_delta":
        this.lastAssistantText += typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
        this.emitSessionEvent({ type: "text_delta", delta: String(assistantEvent.delta ?? "") });
        break;
      case "text_end":
        if (typeof assistantEvent.content === "string") this.lastAssistantText = assistantEvent.content;
        break;
      case "thinking_start":
        this.emitSessionEvent({ type: "status_changed", status: "thinking", message: "Pi is thinking" });
        break;
      case "thinking_delta":
        this.emitSessionEvent({ type: "thinking_delta", delta: String(assistantEvent.delta ?? "") });
        break;
      case "thinking_end":
        break;
      case "toolcall_start": {
        const toolCall = getToolCallFromAssistantEvent(assistantEvent, event.message, contentIndex);
        const toolCallId = getRequiredToolCallId(toolCall);
        if (!toolCallId) {
          this.emitSessionEvent({ type: "protocol_error", error: "Pi toolcall_start did not include a canonical toolCall id." });
          break;
        }

        const toolName = getToolCallName(toolCall, "tool");
        const draft = { toolCallId, toolName, rawInput: "" };
        this.toolCallDrafts.set(toolDraftKey(messageId, contentIndex), draft);
        this.emitSessionEvent({ type: "tool_call_started", toolCallId, toolName, rawInput: "" });
        break;
      }
      case "toolcall_delta": {
        const key = toolDraftKey(messageId, contentIndex);
        const draft = this.toolCallDrafts.get(key);
        if (!draft) {
          this.emitSessionEvent({ type: "protocol_error", error: "Pi toolcall_delta arrived before a toolcall_start with a canonical toolCall id." });
          break;
        }

        const delta = String(assistantEvent.delta ?? "");
        draft.rawInput += delta;
        this.emitSessionEvent({ type: "tool_input_delta", toolCallId: draft.toolCallId, toolName: draft.toolName, delta });
        break;
      }
      case "toolcall_end": {
        const key = toolDraftKey(messageId, contentIndex);
        const draft = this.toolCallDrafts.get(key);
        const toolCall = getToolCallFromAssistantEvent(assistantEvent, event.message, contentIndex);
        const toolCallId = getRequiredToolCallId(toolCall);
        if (!toolCallId) {
          this.emitSessionEvent({ type: "protocol_error", error: "Pi toolcall_end did not include a canonical toolCall id." });
          break;
        }
        if (!draft) {
          this.emitSessionEvent({ type: "protocol_error", error: `Pi toolcall_end for ${toolCallId} arrived without a matching toolcall_start.` });
          break;
        }
        if (draft.toolCallId !== toolCallId) {
          this.emitSessionEvent({ type: "protocol_error", error: `Pi toolCall id changed between start (${draft.toolCallId}) and end (${toolCallId}).` });
          break;
        }

        const toolName = getToolCallName(toolCall, draft.toolName);
        const args = getToolCallArgs(toolCall);
        draft.toolName = toolName;

        this.emitSessionEvent({ type: "tool_call_ready", toolCallId, toolName });
        if (args !== undefined && draft.rawInput === "") {
          this.emitSessionEvent({ type: "tool_input_delta", toolCallId, toolName, delta: stringifyUnknown(args) });
        }
        this.toolCallDrafts.delete(key);
        break;
      }
      case "done":
        break;
      case "error": {
        const error = stringifyUnknown(assistantEvent.error ?? assistantEvent.reason ?? "Assistant error");
        this.emitSessionEvent({ type: "assistant_message_error", error });
        this.emitSessionEvent({ type: "run_failed", error });
        this.rejectRun(new Error(error));
        break;
      }
      default:
        this.emitSessionEvent({ type: "environment_event", kind: "pi_unknown_message_update", payload: event });
    }
  }

  private handleMessageEnd(event: JsonObject): void {
    if (isObject(event.message) && event.message.role !== "assistant") return;
    const id = getMessageId(event.message) ?? this.currentAssistantMessageId;
    this.emitSessionEvent({ type: "assistant_message_completed", id });
  }

  private handleToolExecutionStart(event: JsonObject): void {
    if (typeof event.toolCallId !== "string") {
      this.emitSessionEvent({ type: "protocol_error", error: "Pi tool_execution_start did not include toolCallId." });
      return;
    }

    const toolCallId = event.toolCallId;
    const toolName = String(event.toolName ?? "tool");
    this.emitSessionEvent({ type: "status_changed", status: "using_tool", message: `Using ${toolName}` });
    this.emitSessionEvent({ type: "tool_running", toolCallId });
  }

  private handleToolExecutionUpdate(event: JsonObject): void {
    if (typeof event.toolCallId !== "string") {
      this.emitSessionEvent({ type: "protocol_error", error: "Pi tool_execution_update did not include toolCallId." });
      return;
    }

    this.emitSessionEvent({
      type: "tool_output_delta",
      toolCallId: event.toolCallId,
      toolName: typeof event.toolName === "string" ? event.toolName : undefined,
      delta: extractText(event.partialResult),
    });
  }

  private handleToolExecutionEnd(event: JsonObject): void {
    if (typeof event.toolCallId !== "string") {
      this.emitSessionEvent({ type: "protocol_error", error: "Pi tool_execution_end did not include toolCallId." });
      return;
    }

    const toolCallId = event.toolCallId;
    const toolName = String(event.toolName ?? "tool");
    const output = extractText(event.result);

    if (event.isError === true) {
      this.emitSessionEvent({ type: "tool_error", toolCallId, toolName, error: output });
    } else {
      this.emitSessionEvent({ type: "tool_completed", toolCallId, toolName, output });
    }
  }

  private finishRun(): void {
    if (this.currentRunCompleted) return;
    this.currentRunCompleted = true;

    if (!this.producedAssistantContent) {
      const error = "Pi returned an empty response. This usually means the `pi` CLI could not authenticate — its sign-in token may be expired. Run `pi` in a terminal to sign in again, then retry.";
      this.emitSessionEvent({ type: "assistant_message_error", error });
      this.emitSessionEvent({ type: "run_failed", error });
      this.emitSessionEvent({ type: "status_changed", status: "idle", message: "Ready" });
      this.runResolve?.();
      this.runResolve = null;
      this.runReject = null;
      return;
    }

    this.emitSessionEvent({ type: "run_completed" });
    this.emitSessionEvent({ type: "status_changed", status: "idle", message: "Ready" });
    this.runResolve?.();
    this.runResolve = null;
    this.runReject = null;
  }

  private rejectRun(error: Error): void {
    if (this.currentRunCompleted) return;
    this.currentRunCompleted = true;
    this.runReject?.(error);
    this.runResolve = null;
    this.runReject = null;
  }
}
