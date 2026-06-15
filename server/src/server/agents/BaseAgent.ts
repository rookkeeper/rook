import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { AcpConfigOption, AcpPermissionRequest, AcpPermissionResponseResult, AcpSessionModeState, AcpSessionNewResult, AcpSessionUpdateNotification, JsonRpcFailure, JsonRpcId, JsonRpcMessage, JsonRpcRequest, JsonRpcSuccess } from "../../shared/acp.js";
import { appendSessionRecord, createSessionRecord, type AgentRestartMetadata, type AgentSessionRecord } from "./sessionLog.js";

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type PendingSteeringMessage = {
  text: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

export interface BaseAgentOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  sessionCwd?: string;
  startupTimeoutMs?: number;
  agentName?: string;
}

export interface AgentConstructor<T extends BaseAgent = BaseAgent> {
  new (...args: any[]): T;
  readonly name: string;
  prototype: T;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonRpcErrorMessage(message: JsonRpcFailure): string {
  return message.error.message || `ACP request failed (${message.error.code})`;
}

function asJsonRpcId(value: unknown): JsonRpcId | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

export class BaseAgent {
  protected started = false;
  protected sessionRecord?: AgentSessionRecord;
  protected readonly options: BaseAgentOptions;
  protected restartMetadata?: AgentRestartMetadata;

  private activeRunReject?: (error: Error) => void;
  private sessionName = "default";
  private acpEventSink?: (notification: AcpSessionUpdateNotification) => void;
  private acpPermissionRequestSink?: (request: AcpPermissionRequest) => void;
  private bufferedAcpUpdates: AcpSessionUpdateNotification[] = [];
  private pendingPermissionRequestIds = new Set<JsonRpcId>();
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private requestIndex = 0;
  private stopping = false;
  protected sessionIdValue?: string;
  private suppressUserMessageText?: string;
  private isReplayingSessionLoad = false;
  private workflowActive = false;
  private pendingSteeringMessages: PendingSteeringMessage[] = [];
  private lastStopReasonValue: string | null = null;
  private runQueue: Promise<void> = Promise.resolve();

  constructor(options: BaseAgentOptions, restartMetadata?: AgentRestartMetadata) {
    this.options = options;
    this.restartMetadata = restartMetadata;
  }

  setAcpEventSink(sink: ((notification: AcpSessionUpdateNotification) => void) | undefined): void {
    this.acpEventSink = sink;
    if (!sink || this.bufferedAcpUpdates.length === 0) return;
    for (const update of this.bufferedAcpUpdates.splice(0)) sink(update);
  }

  setAcpPermissionRequestSink(sink: ((request: AcpPermissionRequest) => void) | undefined): void {
    this.acpPermissionRequestSink = sink;
  }

  setSessionName(name: string): void {
    this.sessionName = name.trim() || "default";
  }

  get record(): AgentSessionRecord | undefined {
    return this.sessionRecord;
  }

  get sessionId(): string | undefined {
    return this.sessionIdValue;
  }

  get lastStopReason(): string | null {
    return this.lastStopReasonValue;
  }

  protected get agentName(): string {
    return this.options.agentName ?? this.constructor.name;
  }

  protected get hasActiveWorkflow(): boolean {
    return this.workflowActive;
  }

  protected createSessionRecord(restart: AgentRestartMetadata): AgentSessionRecord {
    return createSessionRecord({ agent: this.agentName, name: this.sessionName, restart });
  }

  async run(userMessage: string): Promise<void> {
    const runTask = async () => {
      let rejectThisRun: (error: Error) => void = () => undefined;
      const stopped = new Promise<never>((_, reject) => {
        rejectThisRun = reject;
        this.activeRunReject = reject;
      });

      const running = (async () => {
        await this.ensureStarted();
        this.lastStopReasonValue = null;
        this.workflowActive = true;
        try {
          await this.runImpl(userMessage);
        } catch (error) {
          this.rejectPendingSteeringMessages(error);
          throw error;
        } finally {
          this.workflowActive = false;
        }
      })();

      try {
        await Promise.race([running, stopped]);
      } finally {
        if (this.activeRunReject === rejectThisRun) this.activeRunReject = undefined;
      }
    };

    const pending = this.runQueue.then(runTask, runTask);
    this.runQueue = pending.then(() => undefined, () => undefined);
    await pending;
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return;

    if (this.restartMetadata) {
      await this.restart(this.restartMetadata);
    } else {
      await this.start();
      this.sessionRecord = await this.registerSession();
      await appendSessionRecord(this.sessionRecord);
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    const error = new Error(`${this.agentName} stopped.`);
    this.activeRunReject?.(error);
    this.activeRunReject = undefined;
    this.rejectPendingSteeringMessages(error);
    await this.stopImpl();
  }

  /**
   * Cancel the in-flight turn without tearing down the session: send the ACP
   * `session/cancel` notification so the subprocess aborts and resolves the
   * pending `session/prompt` with `stopReason: "cancelled"` (handled in
   * `runImpl`). The process stays alive for the next prompt.
   */
  async cancel(): Promise<void> {
    if (!this.process || !this.sessionIdValue) return;
    try {
      this.notify("session/cancel", { sessionId: this.sessionIdValue });
    } catch {
      // Best-effort cancellation.
    }
  }

  async sendSteeringMessage(userMessage: string): Promise<void> {
    await this.ensureStarted();
    const trimmed = userMessage.trim();
    if (!trimmed) return;

    if (this.workflowActive) {
      await new Promise<void>((resolve, reject) => {
        this.pendingSteeringMessages.push({ text: trimmed, resolve, reject });
      });
      return;
    }

    await this.run(trimmed);
  }

  async setMode(modeId: string): Promise<unknown> {
    if (!this.sessionIdValue) throw new Error("ACP agent session is not initialized.");
    return await this.sendRequest("session/set_mode", { sessionId: this.sessionIdValue, modeId });
  }

  async setConfigOption(configId: string, value: string): Promise<unknown> {
    if (!this.sessionIdValue) throw new Error("ACP agent session is not initialized.");
    return await this.sendRequest("session/set_config_option", { sessionId: this.sessionIdValue, configId, value });
  }

  respondToPermissionRequest(message: JsonRpcSuccess | JsonRpcFailure): void {
    const id = asJsonRpcId((message as { id?: unknown }).id);
    if (id === undefined || !this.pendingPermissionRequestIds.has(id) || !this.process?.stdin.writable) return;
    this.pendingPermissionRequestIds.delete(id);
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  protected async start(): Promise<void> {
    await this.startProcess();
    await this.initialize();
  }

  protected async restart(metadata: AgentRestartMetadata): Promise<void> {
    await this.startProcess();
    await this.initialize();

    const sessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;
    const cwd = typeof metadata.cwd === "string" ? metadata.cwd : this.getSessionCwd();
    if (!sessionId) throw new Error("ACP restart metadata is missing sessionId.");
    this.sessionIdValue = sessionId;
    this.isReplayingSessionLoad = true;
    try {
      const result = await this.sendRequestWithTimeout("session/load", this.buildSessionLoadParams(sessionId, cwd), this.options.startupTimeoutMs ?? 15_000);
      this.emitInitialSessionState(result as AcpSessionNewResult);
    } finally {
      this.isReplayingSessionLoad = false;
    }
    this.emitAcpUpdate({ sessionUpdate: "_rookery_assistant_message_completed" });
  }

  protected async registerSession(): Promise<AgentSessionRecord> {
    const cwd = this.getSessionCwd();
    const result = await this.sendRequestWithTimeout("session/new", this.buildSessionNewParams(cwd), this.options.startupTimeoutMs ?? 15_000);
    const sessionId = isObject(result) && typeof result.sessionId === "string" ? result.sessionId : undefined;
    if (!sessionId) throw new Error("ACP session/new did not return a sessionId.");
    this.sessionIdValue = sessionId;
    this.emitInitialSessionState(result as AcpSessionNewResult);

    return this.createSessionRecord({
      sessionId,
      cwd,
    });
  }

  protected buildSessionNewParams(cwd: string): unknown {
    return { cwd, mcpServers: [] };
  }

  protected buildSessionLoadParams(sessionId: string, cwd: string): unknown {
    return { sessionId, cwd, mcpServers: [] };
  }

  protected async runImpl(userMessage: string): Promise<void> {
    const initialStopReason = await this.executePromptTurn(userMessage);
    if (initialStopReason === "cancelled") {
      this.lastStopReasonValue = "cancelled";
      this.rejectPendingSteeringMessages(new Error("ACP prompt was cancelled."));
      this.emitAcpUpdate({ sessionUpdate: "_rookery_run_completed", stopReason: "cancelled" });
      return;
    }

    while (this.pendingSteeringMessages.length > 0) {
      const steering = this.pendingSteeringMessages.shift();
      if (!steering) continue;
      try {
        const stopReason = await this.executePromptTurn(this.formatSteeringMessage(steering.text));
        if (stopReason === "cancelled") {
          const error = new Error("ACP prompt was cancelled while applying a send-now message.");
          this.lastStopReasonValue = "cancelled";
          steering.reject(error);
          this.rejectPendingSteeringMessages(error);
          this.emitAcpUpdate({ sessionUpdate: "_rookery_run_completed", stopReason: "cancelled" });
          return;
        }
        steering.resolve();
      } catch (error) {
        steering.reject(error instanceof Error ? error : new Error(String(error)));
        this.rejectPendingSteeringMessages(error);
        throw error;
      }
    }

    this.lastStopReasonValue = initialStopReason;
    this.emitAcpUpdate({ sessionUpdate: "_rookery_run_completed", stopReason: initialStopReason });
  }

  protected formatSteeringMessage(userMessage: string): string {
    return userMessage;
  }

  protected async executePromptTurn(userMessage: string): Promise<string> {
    if (!this.sessionIdValue) throw new Error("ACP agent session is not initialized.");

    this.emitUserMessageChunk(userMessage);

    const result = await this.sendRequest("session/prompt", {
      sessionId: this.sessionIdValue,
      prompt: [{ type: "text", text: userMessage }],
    });

    return isObject(result) && typeof result.stopReason === "string" ? result.stopReason : "end_turn";
  }

  protected emitUserMessageChunk(userMessage: string): void {
    this.suppressUserMessageText = userMessage;
    this.emitAcpUpdate({ sessionUpdate: "user_message_chunk", content: { type: "text", text: userMessage } });
  }

  protected async stopImpl(): Promise<void> {
    if (!this.process) return;
    this.stopping = true;

    if (this.sessionIdValue) {
      try {
        this.notify("session/cancel", { sessionId: this.sessionIdValue });
      } catch {
        // Ignore best-effort cancellation errors.
      }
    }

    this.process.kill("SIGTERM");
    this.process = null;
    this.startPromise = null;
    this.pendingRequests.clear();
  }

  protected rejectPendingSteeringMessages(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    while (this.pendingSteeringMessages.length > 0) {
      this.pendingSteeringMessages.shift()?.reject(normalized);
    }
  }

  protected getSessionCwd(): string {
    const metadataCwd = typeof this.restartMetadata?.cwd === "string" ? this.restartMetadata.cwd : undefined;
    return metadataCwd ?? this.options.sessionCwd ?? this.options.cwd ?? process.cwd();
  }

  protected async startProcess(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd ?? process.cwd(),
        env: { ...process.env, ...(this.options.env ?? {}) },
        stdio: "pipe",
      });

      this.process = child;
      this.attachJsonlReader(child.stdout, (line) => this.handleStdoutLine(line));
      this.attachJsonlReader(child.stderr, (line) => this.handleStderrLine(line));

      child.once("spawn", () => resolve());
      child.once("error", (error) => {
        this.emitAcpUpdate({ sessionUpdate: "_rookery_connection_error", error: error.message });
        reject(error);
      });

      child.on("exit", (code, signal) => {
        if (this.stopping) return;
        const message = `ACP agent process exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`;
        for (const pending of this.pendingRequests.values()) pending.reject(new Error(message));
        this.pendingRequests.clear();
        this.emitAcpUpdate({ sessionUpdate: "_rookery_connection_error", error: message });
      });
    });

    return this.startPromise;
  }

  protected async initialize(): Promise<void> {
    await this.sendRequestWithTimeout("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        _meta: { "terminal-auth": true },
      },
      clientInfo: {
        name: "rookery",
        title: "Rookery",
        version: "0.1.0",
      },
    }, this.options.startupTimeoutMs ?? 15_000);
  }

  protected sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error("ACP agent process is not writable."));
    }

    const id = `acp-${++this.requestIndex}`;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
    this.process.stdin.write(`${JSON.stringify(request)}\n`);
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  protected async sendRequestWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const pending = this.sendRequest(method, params);
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ACP ${method}.`)), timeoutMs)),
    ]);
  }

  protected notify(method: string, params?: unknown): void {
    if (!this.process?.stdin.writable) return;
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`);
  }

  protected shouldIgnoreServerMessage(message: JsonRpcMessage): boolean {
    return this.isPiAcpStartupInfo(message);
  }

  protected handleStdoutLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emitAcpUpdate({ sessionUpdate: "_rookery_protocol_error", error: `ACP agent emitted non-JSON line: ${line}` });
      return;
    }

    const id = asJsonRpcId((message as { id?: unknown }).id);
    if (id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.pendingRequests.get(id);
      if (!pending) return;
      this.pendingRequests.delete(id);
      if ("error" in message) pending.reject(new Error(jsonRpcErrorMessage(message)));
      else pending.resolve((message as JsonRpcSuccess).result);
      return;
    }

    if ("method" in message && message.method === "session/update") {
      if (this.shouldIgnoreServerMessage(message)) return;

      const update = (message as AcpSessionUpdateNotification).params?.update;
      const isOwnUserEcho =
        update?.sessionUpdate === "user_message_chunk" &&
        (update as { content?: { text?: unknown } }).content?.text === this.suppressUserMessageText;
      if (!isOwnUserEcho) {
        this.forwardAcpUpdate(message as AcpSessionUpdateNotification);
      }
      return;
    }

    if ("method" in message && id !== undefined && message.method === "session/request_permission") {
      this.pendingPermissionRequestIds.add(id);
      if (this.acpPermissionRequestSink) {
        this.acpPermissionRequestSink(message as AcpPermissionRequest);
      } else if (this.process?.stdin.writable) {
        const response: JsonRpcSuccess<AcpPermissionResponseResult> = {
          jsonrpc: "2.0",
          id,
          result: { outcome: { outcome: "cancelled" } },
        };
        this.pendingPermissionRequestIds.delete(id);
        this.process.stdin.write(`${JSON.stringify(response)}\n`);
      }
      return;
    }

    if ("method" in message && id !== undefined) {
      this.emitAcpUpdate({ sessionUpdate: "_rookery_protocol_error", error: `Unsupported ACP server request: ${message.method}` });
      if (this.process?.stdin.writable) {
        const response: JsonRpcFailure = {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unsupported ACP server request: ${message.method}` },
        };
        this.process.stdin.write(`${JSON.stringify(response)}\n`);
      }
    }
  }

  protected handleStderrLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.emitAcpUpdate({ sessionUpdate: "_rookery_status_changed", status: "busy", message: trimmed });
  }

  protected attachJsonlReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim()) onLine(line);
      }
    });
    stream.on("end", () => {
      const trailing = (buffer + decoder.end()).trim();
      if (trailing) onLine(trailing);
    });
    stream.on("error", (error) => {
      this.emitAcpUpdate({ sessionUpdate: "_rookery_connection_error", error: errorMessage(error) });
    });
  }

  private forwardAcpUpdate(notification: AcpSessionUpdateNotification): void {
    if (this.acpEventSink) {
      this.acpEventSink(notification);
      return;
    }
    this.bufferedAcpUpdates.push(notification);
  }

  protected emitInitialSessionState(result: AcpSessionNewResult): void {
    if (result.modes) {
      this.emitModesState(result.modes);
      this.emitAcpUpdate({ sessionUpdate: "current_mode_update", modeId: result.modes.currentModeId });
    }
    if (Array.isArray(result.configOptions) && result.configOptions.length > 0) {
      this.emitConfigOptions(result.configOptions);
    }
  }

  protected emitModesState(modes: AcpSessionModeState): void {
    this.emitAcpUpdate({ sessionUpdate: "_rookery_modes_state", modes });
  }

  protected emitConfigOptions(configOptions: AcpConfigOption[]): void {
    this.emitAcpUpdate({ sessionUpdate: "config_option_update", configOptions });
  }

  /** Emit a server-synthesized ACP session/update notification directly. */
  protected emitAcpUpdate(update: Record<string, unknown>): void {
    if (!this.sessionIdValue) return;
    this.forwardAcpUpdate({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: this.sessionIdValue, update },
    } as unknown as AcpSessionUpdateNotification);
  }

  private isPiAcpStartupInfo(message: JsonRpcMessage): boolean {
    if (!this.isReplayingSessionLoad && !this.started) {
      // fall through to text sniffing below
    }
    if (!("method" in message) || message.method !== "session/update") return false;
    const params = message.params as { update?: { sessionUpdate?: unknown; content?: { text?: unknown } } } | undefined;
    if (params?.update?.sessionUpdate !== "agent_message_chunk") return false;
    const text = params.update.content?.text;
    return typeof text === "string" && text.startsWith("pi v") && text.includes("Skills");
  }
}
