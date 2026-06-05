import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SessionEvent, SessionEventMessage } from "../shared/realtime.js";
import { REPO_ROOT } from "./paths.js";

export type PersistedSessionEvent = SessionEventMessage;

const DEFAULT_SESSION_EVENTS_ROOT = path.resolve(REPO_ROOT, ".var", "agent-station", "session-events");

let sessionEventsRoot = DEFAULT_SESSION_EVENTS_ROOT;

export function setSessionEventsRoot(nextRoot: string): void {
  sessionEventsRoot = path.resolve(nextRoot);
}

export function getSessionEventsRoot(): string {
  return sessionEventsRoot;
}

function eventLogPath(sessionId: string): string {
  return path.join(getSessionEventsRoot(), `${sessionId}.jsonl`);
}

async function appendEvent(sessionId: string, event: PersistedSessionEvent): Promise<void> {
  const filePath = eventLogPath(sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

async function readEventLog(sessionId: string): Promise<PersistedSessionEvent[]> {
  try {
    const contents = await readFile(eventLogPath(sessionId), "utf8");
    return contents
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersistedSessionEvent)
      .filter((event) => event.type === "session_event");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class SessionEventStore {
  private appendQueueBySession = new Map<string, Promise<void>>();

  append(sessionId: string, event: PersistedSessionEvent): Promise<void> {
    const pending = this.appendQueueBySession.get(sessionId) ?? Promise.resolve();
    const next = pending.then(() => appendEvent(sessionId, event));
    this.appendQueueBySession.set(sessionId, next.catch(() => undefined));
    return next;
  }

  async read(sessionId: string, fromSequence = 0): Promise<PersistedSessionEvent[]> {
    await (this.appendQueueBySession.get(sessionId) ?? Promise.resolve());
    const events = await readEventLog(sessionId);
    return events.filter((event) => event.sequence > fromSequence);
  }

  async readSessionEvents(sessionId: string, fromSequence = 0): Promise<SessionEvent[]> {
    const events = await this.read(sessionId, fromSequence);
    return events.map((event) => event.event);
  }

  async getLatestSequence(sessionId: string): Promise<number> {
    const events = await this.read(sessionId);
    return events.at(-1)?.sequence ?? 0;
  }
}
