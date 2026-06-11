import type { SessionEvent, SessionEventMessage, OutboundRealtimeMessage } from "../../shared/realtime.js";
import type { AcpSessionUpdateNotification } from "../../shared/acp.js";
import type { RoomSubscriber } from "./SessionRoom.js";

export class RoomEventStream {
  private subscribers = new Set<RoomSubscriber>();
  private sequence = 0;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly sessionId: string) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  subscribe(subscriber: RoomSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async publish(sessionEvent: SessionEvent): Promise<void> {
    await this.enqueueOperation(async () => {
      this.sequence += 1;
      const event: SessionEventMessage = {
        type: "session_event",
        sessionId: this.sessionId,
        sequence: this.sequence,
        event: sessionEvent,
      };
      this.emit(event);
    });
  }

  async broadcast(sessionEvent: SessionEvent): Promise<void> {
    await this.enqueueOperation(async () => {
      this.emit({
        type: "session_event",
        sessionId: this.sessionId,
        sequence: this.sequence,
        event: sessionEvent,
      });
    });
  }

  /** Publish a raw ACP session/update notification, bypassing the SessionEvent translation layer. */
  async publishAcpUpdate(notification: AcpSessionUpdateNotification): Promise<void> {
    await this.enqueueOperation(async () => {
      this.emit({ type: "acp_update", notification });
    });
  }

  private emit(event: OutboundRealtimeMessage): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}
