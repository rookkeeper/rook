import type { FastifyInstance } from "fastify";
import type { UserEventMessage } from "../../shared/realtime.js";
import type { SessionRoomManager } from "../realtime/SessionRoomManager.js";
import { createWsError, errorMessage, parseFromSequence } from "../serverHelpers.js";

export async function registerWebsocketRoute(app: FastifyInstance, roomManager: SessionRoomManager): Promise<void> {
  app.get<{ Querystring: { sessionId?: string; fromSequence?: string } }>("/api/ws", { websocket: true }, (socket, request) => {
    const sessionId = typeof request.query.sessionId === "string" ? request.query.sessionId.trim() : "";
    const fromSequence = parseFromSequence(request.query.fromSequence);
    if (!sessionId) {
      socket.send(createWsError("Missing sessionId"));
      socket.close();
      return;
    }
    if (fromSequence === null) {
      socket.send(createWsError("Invalid fromSequence"));
      socket.close();
      return;
    }

    const room = roomManager.get(sessionId);
    if (!room) {
      socket.send(createWsError("Unknown or inactive session"));
      socket.close();
      return;
    }

    const send = (payload: unknown) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(payload));
    };

    let unsubscribe: () => void = () => {};
    let closed = false;
    void room.subscribeWithReplay((event) => {
      try {
        send(event);
      } catch {
        unsubscribe();
        socket.close();
      }
    }, fromSequence)
      .then((nextUnsubscribe) => {
        unsubscribe = nextUnsubscribe;
        if (closed) unsubscribe();
      })
      .catch((error) => {
        send({ type: "error", error: errorMessage(error) });
        socket.close();
      });

    socket.on("message", (raw: unknown) => {
      let message: UserEventMessage;
      try {
        message = JSON.parse(String(raw)) as UserEventMessage;
      } catch (error) {
        send({ type: "error", error: `Invalid websocket payload: ${errorMessage(error)}` });
        return;
      }

      if (message.type !== "user_event") {
        send({ type: "error", requestId: message.requestId, error: "Unsupported message type" });
        return;
      }
      if (message.event.kind !== "text_message") {
        send({ type: "error", requestId: message.requestId, error: "Unsupported user_event kind" });
        return;
      }

      const text = message.event.text.trim();
      if (!text) {
        send({ type: "error", requestId: message.requestId, error: "Missing text" });
        return;
      }

      send({ type: "ack", ...(message.requestId ? { requestId: message.requestId } : {}) });
      void room.run(text);
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
