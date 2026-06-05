import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaseAgent } from "../agents/BaseAgent.js";
import type { AgentSessionRecord } from "../agents/sessionLog.js";
import { getSessionEventsRoot, SessionEventStore, setSessionEventsRoot } from "../sessionEvents.js";
import { SessionRoom } from "./SessionRoom.js";
import { ENVIRONMENT_OFFER_AVAILABLE_KIND } from "../../shared/environment.js";

class TestAgent extends BaseAgent {
  protected async start(): Promise<void> {}
  protected async restart(): Promise<void> {}
  protected async registerSession(): Promise<AgentSessionRecord> {
    return {
      id: "s1",
      agent: "TestAgent",
      name: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
      restart: {},
    };
  }
  protected async runImpl(): Promise<void> {}
  protected async stopImpl(): Promise<void> {}
}

describe("SessionRoom", () => {
  let sessionEventsRoot = "";
  const originalSessionEventsRoot = getSessionEventsRoot();

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
    }, new SessionEventStore());
    room.attachRuntimeEventSink();
    return room;
  }

  afterEach(async () => {
    setSessionEventsRoot(originalSessionEventsRoot);
    if (sessionEventsRoot) await rm(sessionEventsRoot, { recursive: true, force: true });
    sessionEventsRoot = "";
  });

  it("does not miss events published while a subscriber is joining with replay", async () => {
    sessionEventsRoot = await mkdtemp(path.join(os.tmpdir(), "agent-station-session-room-"));
    setSessionEventsRoot(sessionEventsRoot);

    const room = createRoom(new TestAgent());

    await room.publishEnvironmentEvent({ kind: "replay" });

    const seen: Array<{ type: string; sequence?: number; event?: unknown }> = [];
    const subscribePromise = room.subscribeWithReplay((event) => {
      seen.push({
        type: event.type,
        ...(typeof (event as { sequence?: number }).sequence === "number" ? { sequence: (event as { sequence: number }).sequence } : {}),
        ...("event" in event ? { event: event.event } : {}),
      });
    });
    const publishPromise = room.publishEnvironmentEvent({ kind: "live" });

    const unsubscribe = await subscribePromise;
    await publishPromise;
    unsubscribe();

    expect(seen).toEqual([
      { type: "session_event", sequence: 1, event: { type: "environment_event", kind: "replay" } },
      { type: "session_event", sequence: 2, event: { type: "environment_event", kind: "live" } },
    ]);
  });

  it("replays unresolved environment offers to late-joining subscribers", async () => {
    sessionEventsRoot = await mkdtemp(path.join(os.tmpdir(), "agent-station-session-room-"));
    setSessionEventsRoot(sessionEventsRoot);

    const room = createRoom(new TestAgent());
    room.onEnvironmentOffered("web:wikipedia", { sourceName: "Wikipedia" });

    const seen: Array<{ type: string; sequence?: number; event?: unknown }> = [];
    const unsubscribe = await room.subscribeWithReplay((event) => {
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

  it("does not replay environment offers after they are resolved", async () => {
    sessionEventsRoot = await mkdtemp(path.join(os.tmpdir(), "agent-station-session-room-"));
    setSessionEventsRoot(sessionEventsRoot);

    const room = createRoom(new TestAgent());
    room.onEnvironmentOffered("web:wikipedia", { sourceName: "Wikipedia" });
    room.onEnvironmentResolved("web:wikipedia", "approved");

    const seen: Array<{ type: string; sequence?: number; event?: unknown }> = [];
    const unsubscribe = await room.subscribeWithReplay((event) => {
      seen.push({
        type: event.type,
        ...(typeof (event as { sequence?: number }).sequence === "number" ? { sequence: (event as { sequence: number }).sequence } : {}),
        ...("event" in event ? { event: event.event } : {}),
      });
    });
    unsubscribe();

    expect(seen).toEqual([]);
  });

  it("publishes run_failed directly when an agent run rejects", async () => {
    sessionEventsRoot = await mkdtemp(path.join(os.tmpdir(), "agent-station-session-room-"));
    setSessionEventsRoot(sessionEventsRoot);

    class RejectingAgent extends TestAgent {
      protected override async runImpl(): Promise<void> {
        throw new Error("boom");
      }
    }

    const room = createRoom(new RejectingAgent());

    await room.run("hello");

    await expect(room.replay()).resolves.toEqual([
      { type: "session_event", sessionId: "s1", sequence: 1, event: { type: "run_failed", error: "boom" } },
    ]);
  });
});
