import type { SessionEvent, SessionEventMessage, OutboundRealtimeMessage } from "../../shared/realtime.js";
import type { SessionEventStore } from "../sessionEvents.js";
import type { RoomSubscriber } from "./SessionRoom.js";

export class RoomEventStream {
  private subscribers = new Set<RoomSubscriber>();
  private sequence = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;

  constructor(
    private readonly sessionId: string,
    private readonly eventStore: SessionEventStore,
  ) {
    this.ready = this.initialize();
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  async replay(fromSequence = 0): Promise<OutboundRealtimeMessage[]> {
    await this.ready;
    return this.eventStore.read(this.sessionId, fromSequence);
  }

  subscribe(subscriber: RoomSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async subscribeWithReplay(subscriber: RoomSubscriber, fromSequence = 0): Promise<() => void> {
    return this.enqueueOperation(async () => {
      await this.ready;
      const events = await this.eventStore.read(this.sessionId, fromSequence);
      for (const event of events) subscriber(event);
      this.subscribers.add(subscriber);
      return () => {
        this.subscribers.delete(subscriber);
      };
    });
  }

  async publish(sessionEvent: SessionEvent): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.ready;
      this.sequence += 1;
      const event: SessionEventMessage = {
        type: "session_event",
        sessionId: this.sessionId,
        sequence: this.sequence,
        event: sessionEvent,
      };
      await this.eventStore.append(this.sessionId, event);
      this.emit(event);
    });
  }

  async broadcast(sessionEvent: SessionEvent): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.ready;
      this.emit({
        type: "session_event",
        sessionId: this.sessionId,
        sequence: this.sequence,
        event: sessionEvent,
      });
    });
  }

  private async initialize(): Promise<void> {
    this.sequence = await this.eventStore.getLatestSequence(this.sessionId);
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
