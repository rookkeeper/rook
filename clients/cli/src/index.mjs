#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";
import { WebSocket } from "ws";

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  purple: "\x1b[35m",
  blue: "\x1b[34m",
  lightBlue: "\x1b[94m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

const HELP = `Usage:
  rook --runtime <runtimeId>
  rook --sessionId <sessionId>
  rook --runtime <runtimeId> <prompt>
  rook --sessionId <sessionId> <prompt>
  rook exec --runtime <runtimeId> <prompt>
  rook exec --sessionId <sessionId> <prompt>
  rook exec --last-message-only --runtime <runtimeId> <prompt>
  rook sessions
  rook sessions --limit <n>

Options:
  --runtime <id>       Configured runtime to use when creating a new session
  --sessionId <id>     Existing session to resume instead of creating a new one
  --server-url <u>     Default: ROOK_SERVER_BASE_URL or http://127.0.0.1:7665
  --auth-token <t>     Bearer token for server auth (default: ROOK_AUTH_TOKEN)
  --title <title>      Session title (only valid with --runtime, not --sessionId)
  --limit <n>          Max sessions to return for the sessions command (default: 20)
  --transcript        Print the full session transcript and exit
  -h, --help           Show help

Examples:
  rook exec --runtime MyPiOpenAiAgent --auth-token "\$ROOK_AUTH_TOKEN" "tell me a joke"
  rook exec --runtime MyPiOpenAiAgent --auth-token "\$ROOK_AUTH_TOKEN" --title math "12+34"
  rook exec --sessionId <id> --auth-token "\$ROOK_AUTH_TOKEN" "what did you just say?"
  rook sessions --auth-token "\$ROOK_AUTH_TOKEN"
  rook sessions --limit 5 --auth-token "\$ROOK_AUTH_TOKEN"
  rook --runtime MyPiOpenAiAgent --auth-token "\$ROOK_AUTH_TOKEN"
  rook --sessionId <id> --auth-token "\$ROOK_AUTH_TOKEN"
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  if (args.title && args.sessionId) {
    fatal("--title can only be used with --runtime (creating a new session), not with --sessionId.");
  }

  if (args.sessions) {
    await runSessionsCommand(args);
    return;
  }

  if (!args.runtimeId && !args.sessionId) {
    fatal("Missing required --runtime <runtimeId> or --sessionId <sessionId>.\n\n" + HELP.trim());
  }

  if (args.runtimeId && args.sessionId) {
    fatal("Use either --runtime or --sessionId, not both.");
  }

  const client = new RookCliClient({
    serverUrl: args.serverUrl,
    authToken: args.authToken,
    runtimeId: args.runtimeId,
    sessionId: args.sessionId,
    title: args.title,
    execPrompt: args.execPrompt,
    transcript: args.transcript,
    lastMessageOnly: args.lastMessageOnly,
  });

  await client.run();
}

async function runSessionsCommand(args) {
  // Just fetch the REST endpoint directly — no WebSocket needed.
  const serverUrl = args.serverUrl || process.env.ROOK_SERVER_BASE_URL || "http://127.0.0.1:7665";
  const authToken = args.authToken || process.env.ROOK_AUTH_TOKEN || "";
  const webSocketUrl = serverUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/api/ws";

  const ws = new WebSocket(webSocketUrl, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

  let nextId = 1;
  const pending = new Map();
  const send = (method, params) => {
    const id = String(nextId++);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  ws.on("message", (data) => {
    const frame = JSON.parse(String(data));
    if (frame.id && pending.has(String(frame.id))) {
      const { resolve, reject } = pending.get(String(frame.id));
      pending.delete(String(frame.id));
      if (frame.error) reject(new Error(frame.error.message ?? "Request failed"));
      else resolve(frame.result ?? {});
    }
  });

  try {
    await send("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "rook-cli", title: "Rook CLI", version: "0.1.0" } });
    const result = await send("session/list", {});
    const sessions = result?.sessions ?? [];
    const limit = args.limit || 20;
    const shown = sessions.slice(0, limit);

    if (shown.length === 0) {
      console.log("No sessions.");
    } else {
      for (const session of shown) {
        const id = session.sessionId || session.id || "?";
        const title = session.title || session.name || "(untitled)";
        const runtimeId = session._meta?.runtimeId || session.agent || "?";
        const updated = session.updatedAt || "?";
        console.log(`${id}  ${runtimeId}  ${title}  ${updated}`);
      }
      if (sessions.length > limit) console.log(`... and ${sessions.length - limit} more (use --limit to adjust)`);
    }
  } finally {
    ws.close();
  }
}

class RookCliClient {
  constructor({ serverUrl, authToken, runtimeId, sessionId, title, execPrompt, transcript, lastMessageOnly }) {
    this.serverUrl = serverUrl || process.env.ROOK_SERVER_BASE_URL || "http://127.0.0.1:7665";
    this.authToken = authToken || process.env.ROOK_AUTH_TOKEN || "";
    this.runtimeId = runtimeId;
    this.sessionId = sessionId || null;
    this.title = title || (execPrompt ? "cli-exec" : "cli-chat");
    this.execPrompt = execPrompt;
    this.transcript = transcript;
    this.lastMessageOnly = lastMessageOnly;
    if (this.lastMessageOnly && !this.execPrompt) {
      this.lastMessageOnly = false;
    }
    this.ws = null;
    this.createdSessionId = null;
    this.requestId = 0;
    this.promptId = 0;
    this.pending = new Map();
    this.pendingPromptIds = new Set();
    this.userEchoes = [];
    this.toolInputs = new Map();
    this.toolOutputs = new Map();
    this.currentSection = null;
    this.finalAssistantText = "";
    this.latestAssistantText = "";
    this.rl = null;
    this.closed = false;
    this.execResolve = null;
    this.execReject = null;
    this.turnIdleTimer = null;
    this.turnActive = false;
    this.turnSawActivity = false;
    this.progressTimer = null;
  }

  async run() {
    this.installSignalHandlers();
    if (this.runtimeId) await this.ensureRuntimeExists();
    await this.connect();
    await this.initialize();
    if (this.sessionId) await this.loadExistingSession();
    else await this.createSession();

    if (this.execPrompt) {
      await this.runExecTurn(this.execPrompt);
      this.printSessionId();
      await this.close();
      return;
    }

    if (this.transcript) {
      await this.runTranscriptMode();
      return;
    }

    this.startInteractiveLoop();
  }

  async ensureRuntimeExists() {
    const response = await fetchJson(`${this.serverUrl.replace(/\/$/, "")}/api/agent_runtimes`, this.authToken);
    const runtimes = Array.isArray(response?.runtimes) ? response.runtimes : [];
    if (!runtimes.some((runtime) => runtime?.id === this.runtimeId)) {
      const available = runtimes.map((runtime) => runtime?.id).filter(Boolean).join(", ");
      fatal(`Unknown configured runtime: ${this.runtimeId}${available ? `\nAvailable runtimes: ${available}` : ""}`);
    }
  }

  async connect() {
    const wsUrl = this.serverUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/api/ws";
    const headers = this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};
    this.ws = new WebSocket(wsUrl, { headers });
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("WebSocket closed during connect"));
      };
      const cleanup = () => {
        this.ws.off("open", onOpen);
        this.ws.off("error", onError);
        this.ws.off("close", onClose);
      };
      this.ws.on("open", onOpen);
      this.ws.on("error", onError);
      this.ws.on("close", onClose);
    });

    this.ws.on("message", (data) => this.handleFrame(String(data)));
    this.ws.on("close", () => {
      if (!this.closed) fatal("Connection closed.");
    });
    this.ws.on("error", (error) => {
      if (!this.closed) fatal(`WebSocket error: ${error.message}`);
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "rook-cli", title: "Rook CLI", version: "0.1.0" },
    });
  }

  async createSession() {
    const result = await this.request("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
      _meta: { runtimeId: this.runtimeId, title: this.title },
    });
    this.createdSessionId = result?.sessionId;
    if (!this.createdSessionId) throw new Error("Server returned no sessionId");
    this.sessionId = this.createdSessionId;
    await this.request("session/load", { sessionId: this.sessionId });
    if (!this.lastMessageOnly) printLine(COLORS.gray, `session: ${this.sessionId} (${this.runtimeId})`);
  }

  async loadExistingSession() {
    await this.request("session/load", { sessionId: this.sessionId });
    if (!this.lastMessageOnly && !this.transcript) printLine(COLORS.gray, `session: ${this.sessionId}`);
  }

  async runTranscriptMode() {
    if (!this.sessionId) fatal("--transcript requires --sessionId.");
    await this.loadExistingSession();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    this.printSessionId();
    await this.close();
  }

  async runExecTurn(prompt) {
    const completion = new Promise((resolve, reject) => {
      this.execResolve = resolve;
      this.execReject = reject;
    });
    this.sendPrompt(prompt).catch((error) => {
      const reject = this.execReject;
      this.execResolve = null;
      this.execReject = null;
      reject?.(error);
    });
    const timeout = setTimeout(() => {
      const resolve = this.execResolve;
      this.execResolve = null;
      this.execReject = null;
      resolve?.();
    }, 300_000);
    await completion;
    clearTimeout(timeout);
    if (this.lastMessageOnly) {
      const text = this.latestAssistantText.trim() || this.finalAssistantText.trim();
      if (text) process.stdout.write(`${text}\n`);
    }
  }

  startInteractiveLoop() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    this.rl.setPrompt("");
    this.rl.on("line", async (line) => {
      const text = line.trim();
      if (!text) return;
      this.sendPrompt(text).catch((error) => {
        printLine(COLORS.yellow, `error: ${error.message}`);
      });
    });
    this.rl.on("SIGINT", () => this.stopInteractive());
  }

  async stopInteractive() {
    this.printSessionId();
    await this.close();
  }

  installSignalHandlers() {
    const stop = async () => {
      this.printSessionId();
      await this.close();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.rl?.close();
    this.ws?.close();
    process.exit(0);
  }

  printSessionId() {
    if (this.sessionId) printLine(COLORS.gray, `sessionId: ${this.sessionId}`);
  }

  async sendPrompt(text) {
    if (!this.lastMessageOnly) printLine(COLORS.green, `user: ${text}`);
    this.currentSection = null;
    this.finalAssistantText = "";
    this.latestAssistantText = "";
    this.turnActive = true;
    this.turnSawActivity = false;
    const id = `prompt-${++this.promptId}`;
    this.pendingPromptIds.add(id);
    this.userEchoes.push(text);
    const params = {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    };
    return this.sendRequest(id, "session/prompt", params);
  }

  request(method, params) {
    const id = `rpc-${++this.requestId}`;
    return this.sendRequest(id, method, params);
  }

  sendRequest(id, method, params) {
    const frame = { jsonrpc: "2.0", id, method, params };
    this.ws.send(JSON.stringify(frame));
    return new Promise((resolve, reject) => this.pending.set(String(id), { resolve, reject }));
  }

  handleFrame(text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }

    if (frame.method === "session/update" && frame.params?.update) {
      this.handleUpdate(frame.params.update);
      return;
    }

    if (frame.method === "session/request_permission") {
      const requestId = String(frame.id ?? "permission");
      const title = frame.params?.toolCall?.title ?? "Permission requested";
      if (!this.lastMessageOnly) printLine(COLORS.yellow, `permission: ${title} (auto-cancelled)`);
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "cancelled" } } }));
      return;
    }

    if (frame.id != null) {
      const key = String(frame.id);
      const pending = this.pending.get(key);
      const isPrompt = this.pendingPromptIds.has(key);
      if (pending) {
        this.pending.delete(key);
        if (frame.error) {
          pending.reject(new Error(frame.error.message ?? "Request failed"));
          if (isPrompt) {
            this.pendingPromptIds.delete(key);
            this.handlePromptCompletion(false, frame.error.message ?? "Run failed");
          }
        } else {
          pending.resolve(frame.result ?? {});
          if (isPrompt) {
            this.pendingPromptIds.delete(key);
            this.handlePromptCompletion(true, frame.result?.stopReason ?? "end_turn");
          }
        }
        return;
      }
    }

    if (frame.error && !this.lastMessageOnly) {
      printLine(COLORS.yellow, `error: ${frame.error.message ?? "Server error"}`);
    }
  }

  handleUpdate(update) {
    this.turnSawActivity = true;
    this.bumpTurnIdleTimer();
    const kind = update?.sessionUpdate;
    if (!kind) return;

    switch (kind) {
      case "user_message_chunk": {
        const text = update?.content?.text;
        if (text && this.userEchoes[0] === text) { this.userEchoes.shift(); break; }
        if (text) {
          if (this.currentSection) { process.stdout.write("\n"); this.currentSection = null; }
          printLine(COLORS.green, `user: ${text}`);
        }
        break;
      }
      case "agent_thought_chunk": {
        const text = update?.content?.text;
        if (!text) return;
        if (!this.lastMessageOnly) this.streamSection("thought", COLORS.purple, "thought: ", text);
        break;
      }
      case "agent_message_chunk": {
        const text = update?.content?.text;
        if (!text) return;
        this.finalAssistantText += text;
        if (!this.lastMessageOnly) this.streamSection("assistant", COLORS.red, "assistant: ", text);
        break;
      }
      case "tool_call": {
        if (this.lastMessageOnly) return;
        const title = update?.title ?? "Tool";
        const kindLabel = update?.kind ? ` (${update.kind})` : "";
        printLine(COLORS.blue, `tool: ${title}${kindLabel}`);
        const toolCallId = update?.toolCallId;
        const rawInput = stringify(update?.rawInput);
        if (toolCallId && rawInput) this.toolInputs.set(toolCallId, rawInput);
        if (rawInput) printLine(COLORS.blue, rawInput);
        this.currentSection = null;
        break;
      }
      case "tool_call_update": {
        if (this.lastMessageOnly) return;
        const toolCallId = update?.toolCallId;
        const input = stringify(update?.rawInput);
        if (toolCallId && input && this.toolInputs.get(toolCallId) !== input) {
          this.toolInputs.set(toolCallId, input);
          printLine(COLORS.blue, input);
        }
        const output = contentItemsText(update?.content) ?? stringify(update?.rawOutput);
        if (toolCallId && output && this.toolOutputs.get(toolCallId) !== output) {
          this.toolOutputs.set(toolCallId, output);
          printLine(COLORS.lightBlue, `tool-output: ${output}`);
        }
        this.currentSection = null;
        break;
      }
      case "plan":
      case "usage_update":
      case "current_mode_update":
      case "config_option_update":
        break;
      default:
        break;
    }
  }

  handlePromptCompletion(success, message) {
    if (!this.execPrompt) {
      this.finishTurn(success, message);
      return;
    }
    if (this.turnIdleTimer) clearTimeout(this.turnIdleTimer);
    this.turnIdleTimer = setTimeout(() => this.finishTurn(true, message), this.turnSawActivity ? 500 : 50);
  }

  finishTurn(success, message) {
    if (!this.turnActive && this.pendingPromptIds.size === 0) return;
    this.turnActive = false;
    this.turnSawActivity = false;
    if (this.turnIdleTimer) clearTimeout(this.turnIdleTimer);
    this.turnIdleTimer = null;
    if (this.progressTimer) { clearInterval(this.progressTimer); this.progressTimer = null; }
    if (this.currentSection && !this.lastMessageOnly) process.stdout.write("\n");
    this.currentSection = null;
    this.latestAssistantText = this.finalAssistantText;
    if (!success && !this.lastMessageOnly) {
      printLine(COLORS.yellow, `run-failed: ${message}`);
    }
    if (this.execResolve || this.execReject) {
      const resolve = this.execResolve;
      const reject = this.execReject;
      this.execResolve = null;
      this.execReject = null;
      if (success) resolve?.();
      else reject?.(new Error(message));
    }
    this.pendingPromptIds.clear();
  }

  bumpTurnIdleTimer() {
    if (!this.execPrompt) return;
    if (this.progressTimer && this.turnSawActivity) { clearInterval(this.progressTimer); this.progressTimer = null; }
    if (!this.turnSawActivity && !this.progressTimer) {
      this.progressTimer = setInterval(() => process.stderr.write("."), 3000);
    }
  }

  streamSection(key, color, prefix, text) {
    if (this.currentSection !== key) {
      if (this.currentSection) process.stdout.write("\n");
      process.stdout.write(`${color}${prefix}${text}${COLORS.reset}`);
      this.currentSection = key;
    } else {
      process.stdout.write(`${color}${text}${COLORS.reset}`);
    }
  }
}

function parseArgs(argv) {
  const args = {
    help: false,
    runtimeId: "",
    sessionId: "",
    serverUrl: "",
    authToken: "",
    title: "",
    execPrompt: "",
    lastMessageOnly: false,
    transcript: false,
    sessions: false,
    limit: 0,
  };

  if (argv[0] === "sessions") {
    argv = argv.slice(1);
    args.sessions = true;
  }

  if (argv[0] === "exec") {
    argv = argv.slice(1);
    const rest = [];
    for (let index = 0; index < argv.length; index += 1) {
      const value = argv[index];
      if (value === "--last-message-only") args.lastMessageOnly = true;
      else rest.push(value);
    }
    argv = rest;
    const parsed = parseCommonArgs(argv, args);
    args.execPrompt = parsed.positionals.join(" ").trim();
    if (!args.execPrompt) fatal("Missing exec prompt.");
    return args;
  }

  const parsed = parseCommonArgs(argv, args);
  if (parsed.positionals.length > 0) {
    args.execPrompt = parsed.positionals.join(" ").trim();
  }
  return args;
}

function parseCommonArgs(argv, args) {
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--runtime":
        args.runtimeId = argv[++index] ?? "";
        break;
      case "--sessionId":
        args.sessionId = argv[++index] ?? "";
        break;
      case "--server-url":
        args.serverUrl = argv[++index] ?? "";
        break;
      case "--auth-token":
        args.authToken = argv[++index] ?? "";
        break;
      case "--title":
        args.title = argv[++index] ?? "";
        break;
      case "--transcript":
        args.transcript = true;
        break;
      case "--limit":
        args.limit = parseInt(argv[++index] ?? "20", 10) || 20;
        break;
      default:
        positionals.push(value);
        break;
    }
  }
  return { positionals };
}

async function fetchJson(url, authToken) {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

function contentItemsText(value) {
  if (!Array.isArray(value)) return null;
  const texts = value.map((item) => item?.content?.text ?? item?.text).filter((item) => typeof item === "string" && item.length > 0);
  return texts.length ? texts.join("\n") : null;
}

function stringify(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function printLine(color, text) {
  process.stdout.write(`${color}${text}${COLORS.reset}\n`);
}

function fatal(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error) => fatal(error instanceof Error ? error.message : String(error)));
