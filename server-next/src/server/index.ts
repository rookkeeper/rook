import websocket from "@fastify/websocket";
import dotenv from "dotenv";
import fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentRuntimeProfiles } from "../config/agentProfiles.js";
import { AgentRuntimeManager } from "../runtime/AgentRuntimeManager.js";
import { startRemoteProxy } from "./remoteProxy.js";
import type { JsonObject, JsonRpcFailure, JsonRpcId, JsonRpcMessage, JsonRpcRequest } from "../runtime/types.js";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const loopbackHost = "127.0.0.1";
const port = Number(process.env.ROOK_SERVER_PORT ?? 7665);
const remoteBindIp = process.env.ROOK_BIND_IP ?? process.env.ROOK_TAILSCALE_IP;
const authToken = process.env.ROOK_AUTH_TOKEN?.trim() || "";

function success(id: JsonRpcId, result: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId | null, message: string, code = -32000): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

function isAuthorized(header: string | string[] | undefined): boolean {
  if (!authToken) return true;
  const value = Array.isArray(header) ? header[0] : header;
  return value === `Bearer ${authToken}`;
}

export async function buildServer() {
  const app = fastify({ logger: true });
  const manager = new AgentRuntimeManager(loadAgentRuntimeProfiles(), REPO_ROOT);

  app.addHook("onRequest", async (request, reply) => {
    if (isAuthorized(request.headers.authorization)) return;
    reply.code(401).send({ error: "Unauthorized" });
  });
  app.get("/api/health", async () => ({ ok: true, service: "rook-next" }));

  await app.register(websocket);
  app.get("/api/ws", { websocket: true }, (socket, request) => {
    if (!isAuthorized(request.headers.authorization)) {
      socket.send(JSON.stringify(failure(null, "Unauthorized", -32001)));
      socket.close();
      return;
    }

    const subscriptions = new Map<string, () => void>();
    const send = (message: JsonRpcMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const subscribe = (sessionId: string) => {
      if (subscriptions.has(sessionId)) return;
      subscriptions.set(sessionId, manager.subscribe(sessionId, send));
    };

    socket.on("message", (raw: unknown) => {
      void handleMessage(String(raw), manager, send, subscribe);
    });
    const close = () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    };
    socket.on("close", close);
    socket.on("error", close);
  });

  app.addHook("onClose", async () => manager.close());
  return app;
}

async function handleMessage(
  raw: string,
  manager: AgentRuntimeManager,
  send: (message: JsonRpcMessage) => void,
  subscribe: (sessionId: string) => void,
): Promise<void> {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(raw) as JsonRpcMessage;
  } catch {
    send(failure(null, "Invalid JSON-RPC payload", -32700));
    return;
  }
  if (!isRequest(message)) {
    send(failure("id" in message ? message.id : null, "JSON-RPC request required", -32600));
    return;
  }

  try {
    switch (message.method) {
      case "initialize": {
        send(success(message.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { list: {}, resume: {}, close: {} },
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
          },
          agentInfo: { name: "rook-server-next", title: "Rook server-next", version: "0.1.0" },
          authMethods: [],
          _meta: { runtimeIds: manager.runtimeIds(), defaultRuntimeId: manager.defaultRuntimeId() },
        }));
        return;
      }
      case "session/list": {
        const sessions = manager.listSessions().map((record) => ({
          sessionId: record.sessionId,
          cwd: record.cwd,
          title: record.title,
          updatedAt: record.updatedAt,
          _meta: { runtimeId: record.runtimeId, startedAt: record.startedAt },
        }));
        send(success(message.id, { sessions }));
        return;
      }
      case "session/new": {
        const params = message.params ?? {};
        const meta = asObject(params._meta);
        const runtimeId = typeof meta?.runtimeId === "string" ? meta.runtimeId : manager.defaultRuntimeId();
        if (!runtimeId) throw new Error("No configured runtimes are available");
        const title = typeof meta?.title === "string" && meta.title.trim().length > 0 ? meta.title.trim() : "session";
        const record = await manager.createSession(runtimeId, stripMeta(params), title);
        subscribe(record.sessionId);
        send(success(message.id, { sessionId: record.sessionId }));
        return;
      }
      case "session/load":
      case "session/resume": {
        const sessionId = sessionIdFrom(message.params);
        subscribe(sessionId);
        await manager.requestForSession(sessionId, message.method, stripSessionId(message.params ?? {}));
        send(success(message.id, {}));
        return;
      }
      case "session/prompt":
      case "session/set_mode":
      case "session/set_config_option": {
        const sessionId = sessionIdFrom(message.params);
        subscribe(sessionId);
        const result = await manager.requestForSession(sessionId, message.method, stripSessionId(message.params ?? {}));
        send(success(message.id, result));
        return;
      }
      case "session/cancel": {
        const sessionId = sessionIdFrom(message.params);
        subscribe(sessionId);
        await manager.notifyForSession(sessionId, message.method, stripSessionId(message.params ?? {}));
        return;
      }
      case "session/close": {
        const sessionId = sessionIdFrom(message.params);
        subscribe(sessionId);
        const result = await manager.requestForSession(sessionId, message.method, {});
        send(success(message.id, result));
        return;
      }
      default:
        send(failure(message.id, `Unsupported ACP method: ${message.method}`, -32601));
    }
  } catch (error) {
    send(failure(message.id, error instanceof Error ? error.message : String(error)));
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function sessionIdFrom(params: JsonObject | undefined): string {
  if (typeof params?.sessionId !== "string" || !params.sessionId) throw new Error("Missing sessionId");
  return params.sessionId;
}

function stripSessionId(params: JsonObject): JsonObject {
  const { sessionId: _sessionId, ...rest } = params;
  return rest;
}

function stripMeta(params: JsonObject): JsonObject {
  const { _meta: _meta, ...rest } = params;
  return rest;
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
  const app = await buildServer();
  await app.listen({ host: loopbackHost, port });
  const remoteProxy = remoteBindIp && remoteBindIp !== loopbackHost && remoteBindIp !== "localhost"
    ? await startRemoteProxy(remoteBindIp, port, loopbackHost)
    : null;

  const shutdown = async () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await remoteProxy?.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log(`Rook next listening at http://${loopbackHost}:${port}`);
  if (remoteProxy) console.log(`Rook next remote proxy listening at http://${remoteBindIp}:${port}`);
}
