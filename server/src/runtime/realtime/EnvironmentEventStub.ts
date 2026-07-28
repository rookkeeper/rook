import type { EnvironmentEventPayload } from "../../shared/realtime.js";

export interface EnvironmentEventPublisher {
  publish(sessionId: string, kind: string, payload?: unknown): Promise<void>;
}

/**
 * Stub for future environment signals.
 */
export class EnvironmentEventStub implements EnvironmentEventPublisher {
  constructor(private readonly emit: (sessionId: string, event: EnvironmentEventPayload) => Promise<void>) {}

  async publish(sessionId: string, kind: string, payload?: unknown): Promise<void> {
    await this.emit(sessionId, { kind, payload });
  }
}
