import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AgentRuntimeProfile } from "../config/agentProfiles.js";
import type { JsonObject, JsonRpcFailure, JsonRpcId, JsonRpcMessage, JsonRpcRequest } from "./types.js";

export type RuntimeNotification = (message: JsonRpcMessage) => void;

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export class AgentRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private decoder = new StringDecoder("utf8");
  private buffered = "";
  private requestIndex = 0;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private started: Promise<void> | null = null;
  private listeners = new Set<RuntimeNotification>();
  private lastStartError: Error | null = null;

  constructor(
    readonly profile: AgentRuntimeProfile,
    private readonly repoRoot: string,
  ) {}

  async initialize(): Promise<void> {
    if (this.started) return this.started;
    this.started = this.start().catch((error) => {
      this.started = null;
      this.lastStartError = error instanceof Error ? error : new Error(String(error));
      throw this.lastStartError;
    });
    return this.started;
  }

  onNotification(listener: RuntimeNotification): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(method: string, params: JsonObject = {}): Promise<unknown> {
    await this.initialize();
    const id = `server-next-${++this.requestIndex}`;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  async notify(method: string, params: JsonObject = {}): Promise<void> {
    await this.initialize();
    this.write({ jsonrpc: "2.0", method, params });
  }

  sessionParams(params: JsonObject, method = "session/new"): JsonObject {
    if (this.profile.type !== "claude" || (method !== "session/new" && method !== "session/load" && method !== "session/resume")) return params;
    const options = claudeCodeOptions(this.profile.args ?? []);
    return Object.keys(options).length === 0 ? params : { ...params, _meta: { claudeCode: { options } } };
  }

  async close(): Promise<void> {
    this.child?.kill();
    this.child = null;
    this.started = null;
    for (const pending of this.pending.values()) pending.reject(new Error("Runtime closed"));
    this.pending.clear();
  }

  private async start(): Promise<void> {
    const command = this.runtimeCommand();
    const child = spawn(command.command, command.args, {
      cwd: this.profile.cwd ? path.resolve(this.repoRoot, this.profile.cwd) : this.repoRoot,
      env: { ...process.env, ...(command.env ?? {}) },
      stdio: "pipe",
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.readLines(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) console.error(`[server-next:${this.profile.id}:stderr] ${text}`);
    });
    child.on("exit", (code, signal) => {
      this.child = null;
      this.started = null;
      const error = new Error(`Runtime ${this.profile.id} exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`);
      this.lastStartError = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    child.on("error", (error) => {
      this.child = null;
      this.started = null;
      this.lastStartError = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    await this.requestRaw("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "rook-server-next", title: "Rook server-next", version: "0.1.0" },
    });
  }

  private runtimeCommand(): { command: string; args: string[]; env?: Record<string, string> } {
    if (this.profile.type === "pi") {
      const piAcp = path.join(this.repoRoot, "server", "node_modules", "pi-acp", "dist", "index.js");
      return {
        command: "node",
        args: [piAcp],
        env: { ...(this.profile.env ?? {}), PI_ACP_PI_COMMAND: this.piLauncher() },
      };
    }
    if (this.profile.type === "claude") {
      const claudeAcp = path.join(this.repoRoot, "server", "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js");
      return {
        command: "node",
        args: [claudeAcp],
        env: { ...(this.profile.env ?? {}), CLAUDE_CODE_EXECUTABLE: this.profile.command?.trim() || "claude" },
      };
    }
    if (this.profile.type === "cursor") {
      return {
        command: this.profile.command?.trim() || "agent",
        args: ["acp"],
        env: this.profile.env,
      };
    }
    return { command: this.profile.command?.trim() || "node", args: this.profile.args ?? [], env: this.profile.env };
  }

  private piLauncher(): string {
    const generatedDir = path.join(this.repoRoot, ".var", "rook-next", "generated", "pi-launchers");
    mkdirSync(generatedDir, { recursive: true });
    const spec = JSON.stringify({ command: this.profile.command?.trim() || "pi", args: this.profile.args ?? [] });
    const digest = createHash("sha256").update(spec).digest("hex").slice(0, 12);
    const launcherPath = path.join(generatedDir, `pi-${digest}.mjs`);
    if (!pathExists(launcherPath)) {
      writeFileSync(launcherPath, `#!/usr/bin/env node
import { spawn } from "node:child_process";
const child = spawn(${JSON.stringify(this.profile.command?.trim() || "pi")}, [...${JSON.stringify(this.profile.args ?? [])}, ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
child.on("exit", (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 0));
child.on("error", (error) => { process.stderr.write(String(error) + "\\n"); process.exit(1); });
`, "utf8");
      chmodSync(launcherPath, 0o755);
    }
    return launcherPath;
  }

  private requestRaw(method: string, params: JsonObject): Promise<unknown> {
    const id = `server-next-${++this.requestIndex}`;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(message: JsonRpcMessage): void {
    const stdin = this.child?.stdin;
    if (!stdin || !stdin.writable || stdin.destroyed || stdin.writableEnded) {
      throw this.lastStartError ?? new Error(`Runtime ${this.profile.id} is not writable`);
    }
    try {
      stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
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
    if ("id" in message && message.id !== null && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if ("error" in message) pending.reject(new Error((message as JsonRpcFailure).error.message));
      else pending.resolve((message as { result: unknown }).result);
      return;
    }
    if ("method" in message && "id" in message) {
      this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported ACP server request: ${message.method}` } });
      return;
    }
    for (const listener of this.listeners) listener(message);
  }
}

function pathExists(value: string): boolean {
  return existsSync(value);
}

function claudeCodeOptions(args: string[]): JsonObject {
  const options: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--agent" && value) {
      options.agent = value;
      index += 1;
    } else if (flag === "--agents" && value) {
      try {
        options.agents = JSON.parse(value) as JsonObject;
        index += 1;
      } catch {
        throw new Error("Claude profile --agents value must be valid JSON.");
      }
    }
  }
  return options;
}
