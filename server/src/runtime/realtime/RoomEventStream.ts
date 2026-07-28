import type { AcpPermissionRequest, AcpSessionUpdateNotification } from "../../shared/acp.js";
import type { AcpOutboundMessage } from "../../shared/realtime.js";

export type RoomSubscriber = (event: AcpOutboundMessage) => void;

function replayKeyForMessage(message: AcpSessionUpdateNotification | AcpPermissionRequest): string | null {
  if (message.method !== "session/update") return null;
  const sessionUpdate = message.params?.update?.sessionUpdate;
  switch (sessionUpdate) {
    case "plan":
    case "usage_update":
    case "current_mode_update":
    case "config_option_update":
    case "_rookery_modes_state":
      return sessionUpdate;
    default:
      return null;
  }
}

export class RoomEventStream {
  private subscribers = new Set<RoomSubscriber>();
  private operationQueue: Promise<void> = Promise.resolve();
  private replayableMessages = new Map<string, AcpOutboundMessage>();

  constructor(private readonly sessionId: string) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  subscribe(subscriber: RoomSubscriber): () => void {
    this.subscribers.add(subscriber);
    for (const message of this.replayableMessages.values()) subscriber(message);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async publishAcpUpdate(notification: AcpSessionUpdateNotification): Promise<void> {
    await this.publishMessage(notification);
  }

  async publishAcpRequest(request: AcpPermissionRequest): Promise<void> {
    await this.publishMessage(request);
  }

  private async publishMessage(message: AcpSessionUpdateNotification | AcpPermissionRequest): Promise<void> {
    await this.enqueueOperation(async () => {
      const outbound: AcpOutboundMessage = { type: "acp_message", message };
      const replayKey = replayKeyForMessage(message);
      if (replayKey) this.replayableMessages.set(replayKey, outbound);
      this.emit(outbound);
    });
  }

  private emit(event: AcpOutboundMessage): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}
