import type { SessionEvent, SessionEventMessage } from "../shared/realtime.js";

export type PersistedSessionEvent = SessionEventMessage;

export class SessionEventStore {
  private eventsBySession = new Map<string, PersistedSessionEvent[]>();

  async reset(sessionId: string): Promise<void> {
    this.eventsBySession.delete(sessionId);
  }

  async append(sessionId: string, event: PersistedSessionEvent): Promise<void> {
    const existing = this.eventsBySession.get(sessionId) ?? [];
    existing.push(event);
    this.eventsBySession.set(sessionId, existing);
  }

  async read(sessionId: string, fromSequence = 0): Promise<PersistedSessionEvent[]> {
    return (this.eventsBySession.get(sessionId) ?? []).filter((event) => event.sequence > fromSequence);
  }

  async readSessionEvents(sessionId: string, fromSequence = 0): Promise<SessionEvent[]> {
    const events = await this.read(sessionId, fromSequence);
    return events.map((event) => event.event);
  }

  async getLatestSequence(sessionId: string): Promise<number> {
    return (this.eventsBySession.get(sessionId) ?? []).at(-1)?.sequence ?? 0;
  }
}
