#!/usr/bin/env node
import process from "node:process";
import { runSessionsCommand } from "./commands/sessions.mjs";
import { runEnvironmentsCommand } from "./commands/environments.mjs";
import { RookCliClient } from "./client.mjs";

export const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  purple: "\x1b[35m",
  blue: "\x1b[34m",
  lightBlue: "\x1b[94m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

export function fatal(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

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
  rook environments
  rook environments --limit <n>

Options:
  --runtime <id>       Configured runtime to use when creating a new session
  --sessionId <id>     Existing session to resume instead of creating a new one
  --server-url <u>     Default: ROOK_SERVER_BASE_URL or http://127.0.0.1:7665
  --auth-token <t>     Bearer token for server auth (default: ROOK_AUTH_TOKEN)
  --title <title>      Session title (only valid with --runtime, not --sessionId)
  --limit <n>          Max entries for sessions/environments (default: 20)
  --join <id>          Environment to join (repeatable)
  --leave <id>         Environment to leave (repeatable)
  --transcript         Print the full session transcript and exit
  -h, --help           Show help

Examples:
  rook exec --runtime MyPiOpenAiAgent --auth-token "\\$ROOK_AUTH_TOKEN" "tell me a joke"
  rook exec --runtime MyPiOpenAiAgent --auth-token "\\$ROOK_AUTH_TOKEN" --title math "12+34"
  rook exec --sessionId <id> --auth-token "\\$ROOK_AUTH_TOKEN" "what did you just say?"
  rook exec --sessionId <id> --auth-token "\\$ROOK_AUTH_TOKEN" --join location:office "hi"
  rook sessions --auth-token "\\$ROOK_AUTH_TOKEN"
  rook environments --auth-token "\\$ROOK_AUTH_TOKEN"
  rook --runtime MyPiOpenAiAgent --auth-token "\\$ROOK_AUTH_TOKEN"
  rook --sessionId <id> --auth-token "\\$ROOK_AUTH_TOKEN"
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

  if (args.join.length > 0 || args.leave.length > 0) {
    if (!args.runtimeId && !args.sessionId) {
      fatal("--join/--leave require --runtime or --sessionId.");
    }
  }

  if (args.sessions) {
    await runSessionsCommand(args);
    return;
  }

  if (args.environments) {
    await runEnvironmentsCommand(args);
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
    join: args.join,
    leave: args.leave,
  });

  await client.run();
}

export function parseArgs(argv) {
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
    environments: false,
    limit: 0,
    join: [],
    leave: [],
  };

  if (argv[0] === "sessions") {
    argv = argv.slice(1);
    args.sessions = true;
  }

  if (argv[0] === "environments") {
    argv = argv.slice(1);
    args.environments = true;
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
      case "--join":
        args.join.push(argv[++index] ?? "");
        break;
      case "--leave":
        args.leave.push(argv[++index] ?? "");
        break;
      default:
        positionals.push(value);
        break;
    }
  }
  return { positionals };
}

const isMain = process.argv[1] && (process.argv[1].endsWith("/src/index.mjs") || process.argv[1].endsWith("\\src\\index.mjs") || process.argv[1].endsWith("/rook") || process.argv[1].endsWith("\\rook"));
if (isMain) {
  main().catch((error) => fatal(error instanceof Error ? error.message : String(error)));
}
