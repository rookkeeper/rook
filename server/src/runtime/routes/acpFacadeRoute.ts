import type { FastifyInstance } from "fastify";
import type { JsonObject, JsonRpcMessage, RuntimeNotification } from "../SessionRuntime.js";
import type { AgentRuntimeManager } from "../services/AgentRuntimeManager.js";
import type { ServerAuth } from "../../infrastructure/auth.js";
import { boundedClientMessage } from "../clientMessage.js";

/** One session-bound ACP JSON-RPC WebSocket facade. */
export async function registerAcpFacadeRoute(app: FastifyInstance, runtimes: AgentRuntimeManager, auth: ServerAuth): Promise<void> {
  app.get("/api/ws", { websocket: true }, (socket, request) => {
    const authorization = auth.authorizeRequest(request.raw);
    if (!authorization.ok) {
      socket.send(JSON.stringify(failure(null, authorization.error, -32001)));
      socket.close();
      return;
    }
    const subscriptions = new Map<string, () => void>();
    let environmentOffers = false;
    let boundSessionId = queryBoundSessionId(request.raw.url);
    const send: RuntimeNotification = (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(boundedClientMessage(message)));
    };
    const subscribe = (sessionId: string) => {
      if (!subscriptions.has(sessionId)) subscriptions.set(sessionId, runtimes.subscribe(sessionId, send, { environmentOffers }));
    };
    if (boundSessionId) subscribe(boundSessionId);

    socket.on("message", (raw: unknown) => {
      void handleMessage(String(raw), runtimes, send, subscribe, (supported) => { environmentOffers = supported; }, {
        boundSessionId: () => boundSessionId,
        bindSessionId: (sessionId) => {
          if (!boundSessionId) {
            boundSessionId = sessionId;
            subscribe(sessionId);
            return;
          }
          if (boundSessionId !== sessionId) throw new Error(`WebSocket is bound to session ${boundSessionId}`);
        },
      });
    });
    const close = () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    };
    socket.on("close", close);
    socket.on("error", close);
  });
}

async function handleMessage(
  raw: string,
  runtimes: AgentRuntimeManager,
  send: RuntimeNotification,
  subscribe: (sessionId: string) => void,
  setEnvironmentOffers: (supported: boolean) => void,
  binding: { boundSessionId(): string | undefined; bindSessionId(sessionId: string): void },
): Promise<void> {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(raw) as JsonRpcMessage;
  } catch {
    send(failure(null, "Invalid JSON-RPC payload", -32700));
    return;
  }
  if ("result" in message || "error" in message) {
    if (!runtimes.respondToRuntime(message)) send(failure(typeof message.id === "string" || typeof message.id === "number" ? message.id : null, "Unknown runtime request", -32600));
    return;
  }
  if (typeof message.method !== "string") {
    send(failure(null, "JSON-RPC method required", -32600));
    return;
  }

  const requestId = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  const isRequest = requestId !== null;
  const allowNotification = message.method === "session/cancel";
  if (!isRequest && !allowNotification) {
    send(failure(null, "JSON-RPC request required", -32600));
    return;
  }

  try {
    switch (message.method) {
      case "initialize": {
        const clientMeta = object(object(message.params)?.clientCapabilities)?._meta;
        const extension = object(clientMeta)?.["com.rookkeeper"];
        const environmentOffers = object(extension)?.environmentOffers === true;
        setEnvironmentOffers(environmentOffers);
        send(success(requestId!, {
          protocolVersion: 1,
          agentInfo: { name: "rook", title: "Rook", version: "0.1.0" },
          agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} }, promptCapabilities: { image: runtimes.runtimeIds().some((runtimeId) => runtimes.supportsImagePrompts(runtimeId)), audio: false, embeddedContext: false } },
          authMethods: [],
          _meta: { runtimeIds: runtimes.runtimeIds(), defaultRuntimeId: runtimes.defaultRuntimeId(), "com.rookkeeper": { environmentOffers: { offerNotification: true, resolveRequest: true } } },
        }));
        return;
      }
      case "_com.rookkeeper/environment_offer_resolve": {
        const params = object(message.params) ?? {};
        const sessionId = requiredBoundSessionId(params, binding);
        const environmentId = typeof params.environmentId === "string" ? params.environmentId : "";
        const bundleHash = typeof params.bundleHash === "string" ? params.bundleHash : "";
        const decision = params.decision;
        if (!environmentId || !bundleHash || (decision !== "accept" && decision !== "approve" && decision !== "ignore" && decision !== "reject")) throw new Error("Invalid environment offer resolution.");
        await runtimes.resolveEnvironmentOffer(sessionId, environmentId, bundleHash, decision);
        send(success(requestId!, { ok: true }));
        return;
      }
      case "session/new": {
        if (binding.boundSessionId()) throw new Error("session/new is not available on a session-bound websocket.");
        const params = object(message.params) ?? {};
        const meta = object(params._meta);
        const runtimeId = typeof meta?.runtimeId === "string" ? meta.runtimeId : runtimes.defaultRuntimeId();
        if (!runtimeId) throw new Error("No configured runtimes are available");
        const title = typeof meta?.title === "string" && meta.title.trim() ? meta.title.trim() : "session";
        const record = await runtimes.createSession(runtimeId, withoutMeta(params), title);
        binding.bindSessionId(record.sessionId);
        send(success(requestId!, {
          sessionId: record.sessionId,
          promptCapabilities: { image: runtimes.supportsImagePrompts(record.runtimeId) },
        }));
        return;
      }
      case "session/load":
      case "session/prompt":
      case "session/set_mode":
      case "session/set_config_option": {
        const params = object(message.params) ?? {};
        const sessionId = requiredBoundSessionId(params, binding);
        subscribe(sessionId);
        if (message.method === "session/prompt" && hasImagePrompt(params.prompt)) {
          validateImagePrompt(params.prompt);
          const capabilities = await runtimes.sessionPromptCapabilities(sessionId);
          if (!capabilities.image) throw new Error("The selected runtime does not support image prompts.");
        }
        let result = await runtimes.requestForSession(sessionId, message.method, withoutSessionId(params), {
          ...(message.method === "session/load" ? { privateReplayListener: send } : {}),
        });
        const resultObject = object(result);
        if (message.method === "session/load" && resultObject) {
          result = { ...resultObject, promptCapabilities: await runtimes.sessionPromptCapabilities(sessionId) };
        }
        send(success(requestId!, result));
        return;
      }
      case "session/cancel": {
        const params = object(message.params) ?? {};
        const sessionId = requiredBoundSessionId(params, binding);
        subscribe(sessionId);
        await runtimes.cancelSession(sessionId, withoutSessionId(params));
        if (isRequest) send(success(requestId!, { ok: true }));
        return;
      }
      case "session/close": {
        const sessionId = requiredBoundSessionId(object(message.params) ?? {}, binding);
        subscribe(sessionId);
        send(success(requestId!, await runtimes.deleteSession(sessionId)));
        return;
      }
      default:
        send(failure(requestId, `Unsupported ACP method: ${message.method}`, -32601));
    }
  } catch (error) {
    send(failure(requestId, error instanceof Error ? error.message : String(error)));
  }
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

function hasImagePrompt(value: unknown): boolean {
  return Array.isArray(value) && value.some((block) => object(block)?.type === "image");
}

function validateImagePrompt(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("Prompt must be an array of content blocks.");
  for (const block of value) {
    const image = object(block);
    if (image?.type !== "image") continue;
    if (typeof image.mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType.toLowerCase())) {
      throw new Error("Unsupported image MIME type.");
    }
    if (typeof image.data !== "string" || image.data.length === 0 || image.data.length > MAX_IMAGE_BASE64_LENGTH || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
      throw new Error("Invalid or oversized image data.");
    }
    const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
    const byteLength = Math.floor(image.data.length * 3 / 4) - padding;
    if (byteLength > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 12 MB limit.");
  }
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}
function requiredSessionId(params: JsonObject): string {
  if (typeof params.sessionId !== "string" || !params.sessionId) throw new Error("Missing sessionId");
  return params.sessionId;
}
function requiredBoundSessionId(params: JsonObject, binding: { boundSessionId(): string | undefined; bindSessionId(sessionId: string): void }): string {
  const sessionId = requiredSessionId(params);
  binding.bindSessionId(sessionId);
  return sessionId;
}
function withoutSessionId(params: JsonObject): JsonObject {
  const { sessionId: _sessionId, ...rest } = params;
  return rest;
}
function withoutMeta(params: JsonObject): JsonObject {
  const { _meta: _meta, ...rest } = params;
  return rest;
}
function queryBoundSessionId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    const sessionId = parsed.searchParams.get("sessionId")?.trim();
    return sessionId || undefined;
  } catch {
    return undefined;
  }
}
function success(id: string | number, result: unknown): JsonRpcMessage { return { jsonrpc: "2.0", id, result }; }
function failure(id: string | number | null, message: string, code = -32000): JsonRpcMessage { return { jsonrpc: "2.0", id, error: { code, message } }; }
