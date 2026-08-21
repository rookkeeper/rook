import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { AgentRuntimeProfile } from "../infrastructure/config/agentRuntimes.js";

export type JsonObject = Record<string, unknown>;
export type JsonRpcId = string | number;
export type JsonRpcMessage = Record<string, unknown>;
export type RuntimeNotification = (message: JsonRpcMessage) => void;

/** A response-level ACP error, distinct from startup, transport, and timeout failures. */
export class RuntimeRequestError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(error: JsonObject) {
    super(typeof error.message === "string" ? error.message : "ACP request failed");
    this.name = "RuntimeRequestError";
    this.code = typeof error.code === "number" ? error.code : undefined;
    this.data = error.data;
  }
}

export interface SessionRuntimeConfiguration {
  enteredEnvironmentIds: string[];
  skillPaths: string[];
  extensionPaths: string[];
  /** Disposable agent workspace used as the runtime process working directory. */
  workspaceRoot?: string;
  appendSystemPrompt?: string;
}

export interface SessionRuntimeOptions {
  /** Maximum time allowed to terminate the owned process group. */
  shutdownTimeoutMs?: number;
}

export interface RuntimeLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export type RuntimeLaunchPlanner = (
  profile: AgentRuntimeProfile,
  repoRoot: string,
  configuration: SessionRuntimeConfiguration,
) => RuntimeLaunchPlan;

type PendingRequest = { resolve(value: unknown): void; reject(error: Error): void };

/**
 * Generic ACP stdio transport for one public session. Provider differences
 * belong in a composed RuntimeIntegration; after initialization every runtime
 * is just ACP JSON-RPC.
 */
export class SessionRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private started: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private childExit: Promise<void> | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly listeners = new Set<RuntimeNotification>();
  private readonly decoder = new StringDecoder("utf8");
  private buffered = "";
  private requestIndex = 0;
  private readonly shutdownTimeoutMs: number;

  constructor(
    readonly profile: AgentRuntimeProfile,
    private readonly repoRoot: string,
    private readonly launchPlanner: RuntimeLaunchPlanner,
    readonly configuration: SessionRuntimeConfiguration = emptyConfiguration(),
    private readonly logger: { info: (obj: Record<string, unknown>, msg?: string) => void; error?: (obj: Record<string, unknown>, msg?: string) => void } = console,
    options: SessionRuntimeOptions = {},
  ) {
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1_000;
  }

  get isAlive(): boolean {
    return this.child !== null;
  }

  get isStarted(): boolean {
    return this.child !== null || this.started !== null;
  }

  /** Builds an unstarted replacement carrying new session-only environment state. */
  replacement(configuration: SessionRuntimeConfiguration): SessionRuntime {
    return new SessionRuntime(this.profile, this.repoRoot, this.launchPlanner, configuration, this.logger, { shutdownTimeoutMs: this.shutdownTimeoutMs });
  }

  async initialize(): Promise<void> {
    if (this.closing) throw new Error(`Runtime ${this.profile.id} is closed`);
    if (this.started) return this.started;
    this.started = this.start().catch((error) => {
      this.started = null;
      throw error;
    });
    return this.started;
  }

  onNotification(listener: RuntimeNotification): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(method: string, params: JsonObject = {}): Promise<unknown> {
    await this.initialize();
    return this.requestRaw(method, params);
  }

  async notify(method: string, params: JsonObject = {}): Promise<void> {
    await this.initialize();
    this.write({ jsonrpc: "2.0", method, params });
  }

  /** Relay a JSON-RPC response to an ACP request initiated by the runtime. */
  respond(message: JsonRpcMessage): void {
    this.write(message);
  }

  /**
   * Terminates the complete runtime process group. ACP adapters such as the
   * Pi adapter commonly spawn a second provider process, so killing only the
   * direct Node adapter would orphan the provider after Rook exits.
   */
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.closeOwnedProcess();
    return this.closing;
  }

  private async closeOwnedProcess(): Promise<void> {
    const error = new Error(`Runtime ${this.profile.id} closed`);
    const child = this.child;
    this.child = null;
    this.started = null;
    this.rejectPending(error);
    if (!child) return;

    signalProcessGroup(child, "SIGTERM");
    await waitForExit(this.childExit, this.shutdownTimeoutMs);
    signalProcessGroup(child, "SIGKILL");
    await waitForExit(this.childExit, this.shutdownTimeoutMs);
  }

  private async start(): Promise<void> {
    const plan = this.launchPlanner(this.profile, this.repoRoot, this.configuration);
    const startedAt = performance.now();
    this.timingLog("runtime_start_begin", {
      runtimeId: this.profile.id,
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
    });
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...(plan.env ?? {}) },
      stdio: "pipe",
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.childExit = new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("exit", settle);
      child.once("error", settle);
    });
    child.stdout.on("data", (chunk: Buffer) => this.readLines(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.logger.error?.({ runtimeId: this.profile.id, text }, "runtime stderr");
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      this.started = null;
      this.rejectPending(new Error(`Runtime ${this.profile.id} exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`));
      // If an adapter dies without Rook initiating close, reap any provider
      // descendants that inherited its process group.
      signalProcessGroup(child, "SIGKILL");
    });
    child.on("error", (error) => {
      if (this.child === child) this.child = null;
      this.started = null;
      this.rejectPending(error);
    });

    if (this.closing) {
      signalProcessGroup(child, "SIGTERM");
      throw new Error(`Runtime ${this.profile.id} closed during startup`);
    }
    await this.requestRaw("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "rook-server", title: "Rook", version: "0.1.0" },
    });
    this.timingLog("runtime_start_complete", {
      runtimeId: this.profile.id,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  }

  private requestRaw(method: string, params: JsonObject): Promise<unknown> {
    const id = `rook-runtime-${++this.requestIndex}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: JsonRpcMessage): void {
    const stdin = this.child?.stdin;
    if (!stdin || !stdin.writable || stdin.destroyed || stdin.writableEnded) {
      throw new Error(`Runtime ${this.profile.id} is not writable`);
    }
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private readLines(chunk: Buffer): void {
    this.buffered += this.decoder.write(chunk);
    let lineEnd: number;
    while ((lineEnd = this.buffered.indexOf("\n")) >= 0) {
      const line = this.buffered.slice(0, lineEnd).trim();
      this.buffered = this.buffered.slice(lineEnd + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    const id = message.id;
    if ((typeof id === "string" || typeof id === "number") && ("result" in message || "error" in message)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if ("error" in message) {
        const error = typeof message.error === "object" && message.error !== null && !Array.isArray(message.error)
          ? message.error as JsonObject
          : {};
        pending.reject(new RuntimeRequestError(error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private timingLog(event: string, details: Record<string, unknown>): void {
    if (process.env.ROOK_SESSION_TIMING_LOGS !== "1") return;
    this.logger.info({ component: "SessionRuntime", event, ...details }, "session timing");
  }
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // The group may already have exited; fall back to the direct child below.
  }
  try {
    child.kill(signal);
  } catch {
    // The process is already gone.
  }
}

async function waitForExit(exit: Promise<void> | null, timeoutMs: number): Promise<void> {
  if (!exit) return;
  await Promise.race([exit, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

function emptyConfiguration(): SessionRuntimeConfiguration {
  return { enteredEnvironmentIds: [], skillPaths: [], extensionPaths: [] };
}
