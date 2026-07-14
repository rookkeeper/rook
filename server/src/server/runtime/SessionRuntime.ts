import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { AgentRuntimeProfile } from "../config/agentRuntimes.js";

export type JsonObject = Record<string, unknown>;
export type JsonRpcId = string | number;
export type JsonRpcMessage = Record<string, unknown>;
export type RuntimeNotification = (message: JsonRpcMessage) => void;

export interface SessionRuntimeConfiguration {
  enteredEnvironmentIds: string[];
  skillPaths: string[];
  extensionPaths: string[];
  appendSystemPrompt?: string;
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
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly listeners = new Set<RuntimeNotification>();
  private readonly decoder = new StringDecoder("utf8");
  private buffered = "";
  private requestIndex = 0;

  constructor(
    readonly profile: AgentRuntimeProfile,
    private readonly repoRoot: string,
    private readonly launchPlanner: RuntimeLaunchPlanner,
    readonly configuration: SessionRuntimeConfiguration = emptyConfiguration(),
  ) {}

  /** Builds an unstarted replacement carrying new session-only environment state. */
  replacement(configuration: SessionRuntimeConfiguration): SessionRuntime {
    return new SessionRuntime(this.profile, this.repoRoot, this.launchPlanner, configuration);
  }

  async initialize(): Promise<void> {
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

  async close(): Promise<void> {
    const error = new Error(`Runtime ${this.profile.id} closed`);
    this.child?.kill();
    this.child = null;
    this.started = null;
    this.rejectPending(error);
  }

  private async start(): Promise<void> {
    const plan = this.launchPlanner(this.profile, this.repoRoot, this.configuration);
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...(plan.env ?? {}) },
      stdio: "pipe",
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.readLines(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) console.error(`[rook:${this.profile.id}:stderr] ${text}`);
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      this.started = null;
      this.rejectPending(new Error(`Runtime ${this.profile.id} exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`));
    });
    child.on("error", (error) => {
      if (this.child === child) this.child = null;
      this.started = null;
      this.rejectPending(error);
    });

    await this.requestRaw("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "rook-server", title: "Rook", version: "0.1.0" },
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
        const error = message.error as { message?: unknown };
        pending.reject(new Error(typeof error?.message === "string" ? error.message : "ACP request failed"));
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
}

function emptyConfiguration(): SessionRuntimeConfiguration {
  return { enteredEnvironmentIds: [], skillPaths: [], extensionPaths: [] };
}
