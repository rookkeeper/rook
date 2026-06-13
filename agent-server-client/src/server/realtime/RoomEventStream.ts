import type { AcpSessionUpdateNotification } from "../../shared/acp.js";
import type { AcpUpdateMessage } from "../../shared/realtime.js";

export type RoomSubscriber = (event: AcpUpdateMessage) => void;

export class RoomEventStream {
  private subscribers = new Set<RoomSubscriber>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly sessionId: string) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  subscribe(subscriber: RoomSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async publishAcpUpdate(notification: AcpSessionUpdateNotification): Promise<void> {
    await this.enqueueOperation(async () => {
      this.emit({ type: "acp_update", notification });
    });
  }

  private emit(event: AcpUpdateMessage): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}
