import { describe, expect, it } from "vitest";
import { BaseAgent } from "../agents/BaseAgent.js";
import type { AgentSessionRecord } from "../agents/sessionLog.js";
import { SessionRoom } from "./SessionRoom.js";
import { ENVIRONMENT_OFFER_AVAILABLE_KIND } from "../../shared/environment.js";

class TestAgent extends BaseAgent {
  constructor() {
    super({ command: "node", args: ["noop"], cwd: process.cwd(), sessionCwd: process.cwd(), agentName: "TestAgent" });
  }

  override async ensureStarted(): Promise<void> {
    this.started = true;
    this.sessionRecord ??= {
      id: "s1",
      agent: "TestAgent",
      name: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
      restart: {},
    } satisfies AgentSessionRecord;
  }

  override async run(_userMessage: string): Promise<void> {
    await this.ensureStarted();
    await this.runImpl();
  }

  override async stop(): Promise<void> {}

  protected override async runImpl(): Promise<void> {}
}

describe("SessionRoom", () => {
  function createRoom(agent: BaseAgent) {
    const room = new SessionRoom("s1", {
      session: {
        id: "s1",
        agent: "TestAgent",
        name: "default",
        createdAt: "2026-01-01T00:00:00.000Z",
        restart: {},
      },
      agentId: "TestAgent",
      agent,
    });
    room.attachRuntimeEventSink();
    return room;
  }

  it("replays unresolved environment offers to late-joining subscribers", () => {
    const room = createRoom(new TestAgent());
    room.onEnvironmentOffered("web:wikipedia", { sourceName: "Wikipedia" });

    const seen: Array<{ type: string; sequence?: number; event?: unknown }> = [];
    const unsubscribe = room.subscribe((event) => {
      seen.push({
        type: event.type,
        ...(typeof (event as { sequence?: number }).sequence === "number" ? { sequence: (event as { sequence: number }).sequence } : {}),
        ...("event" in event ? { event: event.event } : {}),
      });
    });
    unsubscribe();

    expect(seen).toEqual([
      {
        type: "session_event",
        sequence: 0,
        event: { type: "environment_event", kind: ENVIRONMENT_OFFER_AVAILABLE_KIND, payload: { environmentId: "web:wikipedia", sourceName: "Wikipedia" } },
      },
    ]);
  });

  it("does not replay environment offers after they are resolved", () => {
    const room = createRoom(new TestAgent());
    room.onEnvironmentOffered("web:wikipedia", { sourceName: "Wikipedia" });
    room.onEnvironmentResolved("web:wikipedia", "approved");

    const seen: Array<{ type: string; sequence?: number; event?: unknown }> = [];
    const unsubscribe = room.subscribe((event) => {
      seen.push({
        type: event.type,
        ...(typeof (event as { sequence?: number }).sequence === "number" ? { sequence: (event as { sequence: number }).sequence } : {}),
        ...("event" in event ? { event: event.event } : {}),
      });
    });
    unsubscribe();

    expect(seen).toEqual([]);
  });

  it("publishes run_failed directly to current subscribers when an agent run rejects", async () => {
    class RejectingAgent extends TestAgent {
      protected override async runImpl(): Promise<void> {
        throw new Error("boom");
      }
    }

    const room = createRoom(new RejectingAgent());
    const seen: Array<{ type: string; sequence?: number; event?: unknown }> = [];
    const unsubscribe = room.subscribe((event) => {
      seen.push({
        type: event.type,
        ...(typeof (event as { sequence?: number }).sequence === "number" ? { sequence: (event as { sequence: number }).sequence } : {}),
        ...("event" in event ? { event: event.event } : {}),
      });
    });

    await room.run("hello");
    unsubscribe();

    expect(seen).toEqual([
      { type: "session_event", sequence: 1, event: { type: "run_failed", error: "boom" } },
    ]);
  });
});
