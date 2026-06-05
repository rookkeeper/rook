import type { SessionEvent } from "../../shared/realtime.js";
import { AgentRestartMetadata, AgentSessionRecord, appendSessionRecord, createSessionRecord } from "./sessionLog.js";

export interface AgentConstructor<T extends BaseAgent = BaseAgent> {
  new (...args: any[]): T;
  readonly name: string;
  prototype: T;
}

/**
 * Server-side agent base class.
 *
 * The public methods on this class are application lifecycle methods. They know
 * about Agent Station concerns like session-log persistence and how an active
 * HTTP stream should be notified when a runtime is stopped. Subclasses should
 * not normally override them.
 *
 * Subclasses implement only the protected hooks that know about the underlying
 * agent/provider:
 * - `start()` creates a brand-new live session.
 * - `restart(metadata)` resumes a live session from persisted metadata.
 * - `registerSession()` returns the JSON-serializable record for future resume.
 * - `runImpl(message)` handles one user message after start/restart.
 * - `stopImpl()` releases provider-specific resources such as child processes,
 *   sockets, pending provider requests, etc.
 *
 * Stopping is split in two on purpose:
 * - `stop()` is concrete and owned by BaseAgent. If a user message is currently
 *   running, it rejects that `run()` call. The server catches that rejection and
 *   sends `onRunFailed` to the RemoteAgent before closing the response stream.
 * - `stopImpl()` is implemented by subclasses and should only deal with the
 *   provider itself. It should not need to know how RemoteAgent is signaled.
 */
export abstract class BaseAgent {
  protected started = false;
  protected sessionRecord?: AgentSessionRecord;
  private activeRunReject?: (error: Error) => void;
  private sessionName = "default";
  private eventSink?: (event: SessionEvent) => void;

  constructor(protected restartMetadata?: AgentRestartMetadata) {}

  setEventSink(eventSink: ((event: SessionEvent) => void) | undefined): void {
    this.eventSink = eventSink;
  }

  setSessionName(name: string): void {
    this.sessionName = name.trim() || "default";
  }

  get record(): AgentSessionRecord | undefined {
    return this.sessionRecord;
  }

  protected get agentName(): string {
    return this.constructor.name;
  }

  protected createSessionRecord(restart: AgentRestartMetadata): AgentSessionRecord {
    return createSessionRecord({ agent: this.agentName, name: this.sessionName, restart });
  }

  protected emitSessionEvent(event: SessionEvent): void {
    this.eventSink?.(event);
  }

  async run(userMessage: string): Promise<void> {
    let rejectThisRun: (error: Error) => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => {
      rejectThisRun = reject;
      this.activeRunReject = reject;
    });

    const running = (async () => {
      await this.ensureStarted();
      await this.runImpl(userMessage);
    })();

    try {
      await Promise.race([running, stopped]);
    } finally {
      if (this.activeRunReject === rejectThisRun) this.activeRunReject = undefined;
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return;

    if (this.restartMetadata) {
      await this.restart(this.restartMetadata);
    } else {
      await this.start();
      this.sessionRecord = await this.registerSession();
      await appendSessionRecord(this.sessionRecord);
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    this.activeRunReject?.(new Error(`${this.agentName} stopped.`));
    this.activeRunReject = undefined;
    await this.stopImpl();
  }

  protected abstract start(): Promise<void>;
  protected abstract restart(metadata: AgentRestartMetadata): Promise<void>;
  protected abstract registerSession(): Promise<AgentSessionRecord>;
  protected abstract runImpl(userMessage: string): Promise<void>;
  protected abstract stopImpl(): Promise<void>;
}
