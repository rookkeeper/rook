import { SessionRoom, type RoomRuntime } from "./SessionRoom.js";

export class SessionRoomManager {
  private rooms = new Map<string, SessionRoom>();

  constructor(
    private readonly options: { idleTimeoutMs?: number; onRoomRemoved?: (sessionId: string) => void } = {},
  ) {}

  get(sessionId: string): SessionRoom | undefined {
    return this.rooms.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.rooms.has(sessionId);
  }

  subscriberCount(sessionId: string): number {
    return this.rooms.get(sessionId)?.subscriberCount ?? 0;
  }

  async upsert(runtime: RoomRuntime): Promise<SessionRoom> {
    const existing = this.rooms.get(runtime.session.id);
    if (existing) {
      existing.setRuntime(runtime);
      existing.attachRuntimeEventSink();
      return existing;
    }

    const room = new SessionRoom(runtime.session.id, runtime, {
      idleTimeoutMs: this.options.idleTimeoutMs,
      onIdle: async () => {
        const current = this.rooms.get(runtime.session.id);
        if (current !== room) return;
        this.rooms.delete(runtime.session.id);
        this.options.onRoomRemoved?.(runtime.session.id);
        await room.stop();
      },
    });
    room.attachRuntimeEventSink();
    this.rooms.set(runtime.session.id, room);
    return room;
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.rooms.keys()];
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    for (const sessionId of sessionIds) this.options.onRoomRemoved?.(sessionId);
    await Promise.all(rooms.map((room) => room.stop()));
  }
}
