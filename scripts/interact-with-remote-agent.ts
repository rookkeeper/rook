/**
 * Exercise the remote-agent bridge without the web UI.
 *
 * Run from the repo root (no need to cd into agent-server-client):
 *
 *   ./scripts/interact-with-remote-agent.sh [options] <prompt>
 *   npm run agent:cli -- [options] <prompt>
 *
 * One-time setup if tsx is missing:
 *
 *   cd agent-server-client && npm install
 *
 * The .sh wrapper locates agent-server-client's tsx and tsconfig; this file
 * starts a local Fastify server on a random port and streams session events.
 *
 * Options:
 *   --agent <id>           Agent backend (default: MyPiAgent). Use MockAgent for a quick test.
 *   --session '<json>'     Continue an existing session record (AgentSessionSummary JSON).
 *   --restart              Restart the existing session in place.
 *   --replay               Include HTTP replay events on start (also needs --no-replay off).
 *   --omit-deltas          Hide text_delta, thinking_delta, tool_input_delta, tool_output_delta.
 *   --omit <types>         Comma-separated SessionEvent types to hide (flag may repeat).
 *   --only <types>         Whitelist: only print these SessionEvent types.
 *   --no-session           Do not print the session record line.
 *   --no-replay            Do not print replay lines even when --replay is set.
 *   -h, --help             Print usage (same event types as below).
 *
 * SessionEvent types (for --omit / --only; --omit-deltas hides the four *delta types):
 *   status_changed
 *   user_message
 *   assistant_message_started
 *   assistant_message_completed
 *   assistant_message_error
 *   text_delta
 *   thinking_delta
 *   tool_call_started
 *   tool_input_delta
 *   tool_call_ready
 *   tool_running
 *   tool_output_delta
 *   tool_completed
 *   tool_error
 *   run_completed
 *   run_failed
 *   protocol_error
 *   connection_error
 *   environment_event
 *
 * Output (JSONL on stdout):
 *   { "type": "session", "event": ... }           session after start (--no-session to skip)
 *   { "type": "replay", "event": ... }            prior events when --replay (--no-replay to skip)
 *   { "type": "session_event", "event": ... }     live/replayed SessionEvent payloads
 *
 * Quick:
 *   ./scripts/interact-with-remote-agent.sh --agent MockAgent --omit-deltas "hello"
 *
 * Full example (resume a session, restart its runtime, replay prior events, filter noisy types):
 *
 *   ./scripts/interact-with-remote-agent.sh \
 *     --agent MyPiAgent \
 *     --session '{"id":"8f2c1a40-9b3e-4d12-8c01-2a9f0e7d31b4","agent":"MyPiAgent","name":"vault-chat","createdAt":"2026-06-02T18:30:00.000Z","restart":{"cwd":"/Users/me/vault"}}' \
 *     --restart \
 *     --replay \
 *     --omit-deltas \
 *     --omit status_changed,environment_event \
 *     "Summarize our thread and list open tasks"
 *
 *   npm run agent:cli -- \
 *     --agent MyPiAgent \
 *     --session '{"id":"8f2c1a40-9b3e-4d12-8c01-2a9f0e7d31b4","agent":"MyPiAgent","name":"vault-chat","createdAt":"2026-06-02T18:30:00.000Z","restart":{"cwd":"/Users/me/vault"}}' \
 *     --restart --replay --omit-deltas --omit status_changed,environment_event \
 *     "Summarize our thread and list open tasks"
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentSessionSummary } from "../agent-server-client/src/shared/agent.js";
import type { SessionEvent, SessionEventType } from "../agent-server-client/src/shared/realtime.js";
import { SESSION_EVENT_TYPES } from "../agent-server-client/src/shared/realtime.js";
import { RemoteAgent } from "../agent-server-client/src/client/remoteAgent.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CLIENT_ROOT = path.join(REPO_ROOT, "agent-server-client");

const DELTA_EVENT_TYPES: SessionEventType[] = [
  "text_delta",
  "thinking_delta",
  "tool_input_delta",
  "tool_output_delta",
];

export type EventFilter = {
  only?: Set<SessionEventType>;
  omit: Set<SessionEventType>;
  showSession: boolean;
  showReplay: boolean;
};

function usage(): never {
  console.log(`Usage:
  ./scripts/interact-with-remote-agent.sh [options] <prompt>
  npm run agent:cli -- [options] <prompt>

Options:
  --agent <id>           Agent backend (default: MyPiAgent)
  --session '<json>'     Continue an existing session record
  --restart              Restart existing session in place
  --replay               Emit HTTP replay events on start
  --omit-deltas          Hide text/thinking/tool *delta events (common noise)
  --omit <types>         Comma-separated event types to hide (repeatable)
  --only <types>         Comma-separated event types to show (hides all others)
  --no-session           Do not print the session record line
  --no-replay            Do not print replay lines (even with --replay)
  -h, --help

Event types: ${SESSION_EVENT_TYPES.join(", ")}

Output is JSONL on stdout. Examples:
  ./scripts/interact-with-remote-agent.sh --agent MockAgent --omit-deltas "hello"
  ./scripts/interact-with-remote-agent.sh --only run_completed,run_failed,protocol_error "hello"`);
  process.exit(2);
}

function parseEventTypes(value: string): SessionEventType[] {
  const types = value.split(",").map((part) => part.trim()).filter(Boolean);
  const invalid = types.filter((type) => !SESSION_EVENT_TYPES.includes(type as SessionEventType));
  if (invalid.length > 0) {
    console.error(`Unknown event type(s): ${invalid.join(", ")}`);
    usage();
  }
  return types as SessionEventType[];
}

function parseArgs(argv: string[]): {
  agent: string;
  session?: AgentSessionSummary;
  prompt: string;
  restart: boolean;
  replay: boolean;
  filter: EventFilter;
} {
  let agent = "MyPiAgent";
  let session: AgentSessionSummary | undefined;
  let restart = false;
  let replay = false;
  let omitDeltas = false;
  const omit = new Set<SessionEventType>();
  let only: Set<SessionEventType> | undefined;
  let showSession = true;
  let showReplay = true;
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent") {
      const value = argv[++i];
      if (!value) usage();
      agent = value;
    } else if (arg === "--session") {
      const value = argv[++i];
      if (!value) usage();
      session = JSON.parse(value) as AgentSessionSummary;
    } else if (arg === "--restart") {
      restart = true;
    } else if (arg === "--replay") {
      replay = true;
    } else if (arg === "--omit-deltas") {
      omitDeltas = true;
    } else if (arg === "--omit") {
      const value = argv[++i];
      if (!value) usage();
      for (const type of parseEventTypes(value)) omit.add(type);
    } else if (arg === "--only") {
      const value = argv[++i];
      if (!value) usage();
      only = new Set(parseEventTypes(value));
    } else if (arg === "--no-session") {
      showSession = false;
    } else if (arg === "--no-replay") {
      showReplay = false;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      promptParts.push(arg);
    }
  }

  if (omitDeltas) {
    for (const type of DELTA_EVENT_TYPES) omit.add(type);
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) usage();

  return {
    agent,
    session,
    prompt,
    restart,
    replay,
    filter: { only, omit, showSession, showReplay },
  };
}

function shouldEmitSessionEvent(event: SessionEvent, filter: EventFilter): boolean {
  if (filter.only) return filter.only.has(event.type);
  return !filter.omit.has(event.type);
}

function createEventLogger(filter: EventFilter) {
  return (event: SessionEvent) => {
    if (!shouldEmitSessionEvent(event, filter)) return;
    console.log(JSON.stringify({ type: "session_event", event }));
  };
}

async function main() {
  const { agent, session, prompt, restart, replay, filter } = parseArgs(process.argv.slice(2));

  const serverEntry = pathToFileURL(path.join(CLIENT_ROOT, "src/server/index.js")).href;
  const { buildServer } = await import(serverEntry);
  const app = await buildServer({ enableClient: false, logger: false });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine server address.");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const logSessionEvent = createEventLogger(filter);

    const remoteAgent = new RemoteAgent({
      backend: agent,
      session,
      startEndpoint: `${baseUrl}/api/agent/start`,
      wsEndpoint: `${baseUrl}/api/ws`,
      includeReplayEvents: replay,
      restartExisting: restart,
      onSessionEvent: logSessionEvent,
    });

    const startResult = await remoteAgent.start();
    if (filter.showSession) {
      console.log(JSON.stringify({ type: "session", event: startResult.session }));
    }
    if (filter.showReplay && startResult.replayEvents) {
      for (const replayEvent of startResult.replayEvents) {
        if (!shouldEmitSessionEvent(replayEvent, filter)) continue;
        console.log(JSON.stringify({ type: "replay", event: replayEvent }));
      }
    }
    await remoteAgent.run(prompt);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
