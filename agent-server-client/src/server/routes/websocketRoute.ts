import type { FastifyInstance } from "fastify";
import type { AcpPromptRequest, JsonRpcFailure, JsonRpcMessage, JsonRpcSuccess } from "../../shared/acp.js";
import type { SessionRoomManager } from "../realtime/SessionRoomManager.js";
import { translateSessionEventMessageToAcp } from "../realtime/sessionEventToAcp.js";
import { errorMessage } from "../serverHelpers.js";

function jsonRpcError(message: string, id: string | number | null = null, code = -32000): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function jsonRpcSuccess(id: string | number, result: Record<string, unknown>): JsonRpcSuccess<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function isPromptRequest(message: JsonRpcMessage): message is AcpPromptRequest {
  return "id" in message && "method" in message && message.method === "session/prompt";
}

function isCancelMessage(message: JsonRpcMessage): boolean {
  return "method" in message && message.method === "session/cancel";
}

export async function registerWebsocketRoute(app: FastifyInstance, roomManager: SessionRoomManager): Promise<void> {
  app.get<{ Querystring: { sessionId?: string } }>("/api/ws", { websocket: true }, (socket, request) => {
    const sessionId = typeof request.query.sessionId === "string" ? request.query.sessionId.trim() : "";
    if (!sessionId) {
      socket.send(JSON.stringify(jsonRpcError("Missing sessionId")));
      socket.close();
      return;
    }

    const room = roomManager.get(sessionId);
    if (!room) {
      socket.send(JSON.stringify(jsonRpcError("Unknown or inactive session")));
      socket.close();
      return;
    }

    const send = (payload: unknown) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(payload));
    };

    let unsubscribe: () => void = () => {};
    let closed = false;
    const onRoomEvent = (event: { type: string;[key: string]: unknown }) => {
      try {
        if (event.type === "acp_update") {
          send(event.notification);
          return;
        }
        if (event.type !== "session_event") return;
        for (const message of translateSessionEventMessageToAcp(event as never)) send(message);
      } catch {
        unsubscribe();
        socket.close();
      }
    };

    unsubscribe = room.subscribe(onRoomEvent as never);
    void (async () => {
      try {
        if (!room.hasStarted) await room.ensureStarted();
        if (closed) unsubscribe();
      } catch (error) {
        send(jsonRpcError(errorMessage(error)));
        socket.close();
      }
    })();

    socket.on("message", (raw: unknown) => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(String(raw)) as JsonRpcMessage;
      } catch (error) {
        send(jsonRpcError(`Invalid websocket payload: ${errorMessage(error)}`));
        return;
      }

      if (isCancelMessage(message)) {
        // Cancel the in-flight turn; the pending prompt resolves with a
        // "cancelled" error, keeping the session alive. No response (it's a
        // JSON-RPC notification).
        void room.cancel().catch(() => {});
        return;
      }

      if (!isPromptRequest(message)) {
        const id = "id" in message ? message.id : null;
        send(jsonRpcError("Unsupported message type", id === undefined ? null : id));
        return;
      }

      const promptText = (message.params?.prompt ?? [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n\n")
        .trim();

      if (message.params?.sessionId !== sessionId) {
        send(jsonRpcError("sessionId does not match websocket session", message.id));
        return;
      }
      if (!promptText) {
        send(jsonRpcError("Missing text prompt", message.id));
        return;
      }

      void room.run(promptText)
        .then((result) => {
          if (!result.ok) {
            send(jsonRpcError(result.error, message.id));
            return;
          }
          send(jsonRpcSuccess(message.id, { stopReason: "end_turn" }));
        })
        .catch((error) => {
          send(jsonRpcError(errorMessage(error), message.id));
        });
    });

    socket.on("close", () => {
      closed = true;
      unsubscribe();
    });
    socket.on("error", () => {
      closed = true;
      unsubscribe();
    });
  });
}
