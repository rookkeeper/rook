import { AgentBackend, AgentDefinition, AgentSessionSummary } from "./agent";
import type { SessionEvent, OutboundRealtimeMessage } from "../shared/realtime";

export type RemoteSessionEvent = SessionEvent;

export async function fetchAgentDefinitions(): Promise<AgentDefinition[]> {
  const response = await fetch("/api/agents");
  if (!response.ok) throw new Error(`Failed to load agents with HTTP ${response.status}`);
  const payload = await response.json() as { agents: AgentDefinition[] };
  return payload.agents;
}

export async function fetchAgentSessions(agent: AgentBackend): Promise<AgentSessionSummary[]> {
  const response = await fetch(`/api/agent/sessions?agent=${encodeURIComponent(agent)}`);
  if (!response.ok) throw new Error(`Failed to load sessions with HTTP ${response.status}`);
  const payload = await response.json() as { sessions: AgentSessionSummary[] };
  return payload.sessions;
}

export async function fetchMostRecentSession(): Promise<AgentSessionSummary | null> {
  const response = await fetch("/api/agent/session/recent");
  if (!response.ok) throw new Error(`Failed to load recent session with HTTP ${response.status}`);
  const payload = await response.json() as { session: AgentSessionSummary | null };
  return payload.session;
}

import type { EnvironmentDecision, EnvironmentPreview } from "../shared/environment";

export async function fetchEnvironmentPreview(environmentId: string): Promise<EnvironmentPreview> {
  const response = await fetch(`/api/environments/preview?environmentId=${encodeURIComponent(environmentId)}`);
  if (!response.ok) throw new Error(`Failed to load environment preview with HTTP ${response.status}`);
  return await response.json() as EnvironmentPreview;
}

/** Record a 2×2 decision for an environment (global; the server applies it to every open session). */
export async function decideEnvironment(environmentId: string, decision: EnvironmentDecision): Promise<void> {
  const response = await fetch("/api/environments/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ environmentId, decision }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to record environment decision with HTTP ${response.status}`);
  }
}

export interface RemoteAgentOptions {
  startEndpoint?: string;
  wsEndpoint?: string;
  backend?: AgentBackend;
  session?: AgentSessionSummary;
  sessionName?: string;
  includeReplayEvents?: boolean;
  restartExisting?: boolean;
  onSessionEvent?: (event: SessionEvent) => void;
}

export interface RemoteAgentStartResult {
  ok: boolean;
  agent: AgentBackend;
  session: AgentSessionSummary;
  replayEvents?: RemoteSessionEvent[];
}

type PendingRun = { resolve: () => void; reject: (error: Error) => void };

function websocketUrl(endpoint: string, sessionId: string, fromSequence?: number): string {
  const base = endpoint.includes("://")
    ? new URL(endpoint)
    : new URL(endpoint, window.location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.searchParams.set("sessionId", sessionId);
  if (typeof fromSequence === "number" && fromSequence > 0) base.searchParams.set("fromSequence", String(fromSequence));
  return base.toString();
}

export class RemoteAgent {
  private startEndpoint: string;
  private wsEndpoint: string;
  private backend: AgentBackend;
  private session?: AgentSessionSummary;
  private sessionName?: string;
  private includeReplayEvents?: boolean;
  private restartExisting?: boolean;
  private onSessionEvent?: (event: SessionEvent) => void;
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private lastSequence = 0;
  private pendingRuns: PendingRun[] = [];
  private requestCounter = 0;
  private closed = false;

  constructor(options: RemoteAgentOptions = {}) {
    this.startEndpoint = options.startEndpoint ?? "/api/agent/start";
    this.wsEndpoint = options.wsEndpoint ?? "/api/ws";
    this.backend = options.backend ?? "PiAgent";
    this.session = options.session;
    this.sessionName = options.sessionName;
    this.includeReplayEvents = options.includeReplayEvents;
    this.restartExisting = options.restartExisting;
    this.onSessionEvent = options.onSessionEvent;
  }

  async start(): Promise<RemoteAgentStartResult> {
    const response = await fetch(this.startEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent: this.backend,
        ...(this.session ? { session: this.session } : {}),
        ...(this.sessionName ? { sessionName: this.sessionName } : {}),
        ...(this.includeReplayEvents ? { includeReplayEvents: true } : {}),
        ...(this.restartExisting ? { restartExisting: true } : {}),
      }),
    });

    if (!response.ok) {
      const error = `Remote agent start failed with HTTP ${response.status}`;
      this.emitLocalEvent({ type: "connection_error", error });
      throw new Error(error);
    }

    const result = await response.json() as RemoteAgentStartResult;
    this.session = result.session;
    return result;
  }

  async connect(): Promise<void> {
    if (this.closed) this.closed = false;
    if (!this.session) await this.start();
    if (!this.session) throw new Error("Remote agent has no session.");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    const url = websocketUrl(this.wsEndpoint, this.session.id, this.lastSequence || undefined);

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.connectPromise = null;
        resolve();
      }, { once: true });

      socket.addEventListener("message", (event) => {
        try {
          this.handleMessage(JSON.parse(String(event.data)) as OutboundRealtimeMessage);
        } catch (error) {
          this.emitLocalEvent({ type: "protocol_error", error: `Failed to parse websocket payload: ${String(error)}` });
        }
      });

      socket.addEventListener("error", () => {
        const error = new Error("Remote agent websocket error.");
        if (this.connectPromise) {
          this.connectPromise = null;
          reject(error);
        }
        this.emitLocalEvent({ type: "connection_error", error: error.message });
      });

      socket.addEventListener("close", () => {
        this.socket = null;
        if (this.connectPromise) {
          this.connectPromise = null;
          reject(new Error("Remote agent websocket closed before connecting."));
          return;
        }
        if (!this.closed) {
          const error = new Error("Remote agent websocket closed.");
          while (this.pendingRuns.length > 0) this.pendingRuns.shift()?.reject(error);
          this.emitLocalEvent({ type: "connection_error", error: error.message });
        }
      }, { once: true });
    });

    return this.connectPromise;
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  async run(userMessage: string): Promise<void> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const error = new Error("Remote agent websocket is not open.");
      this.emitLocalEvent({ type: "run_failed", error: error.message });
      throw error;
    }

    const requestId = `user-event-${++this.requestCounter}`;
    const run = new Promise<void>((resolve, reject) => {
      this.pendingRuns.push({ resolve, reject });
    });

    socket.send(JSON.stringify({
      type: "user_event",
      requestId,
      event: { kind: "text_message", text: userMessage },
    }));

    return run;
  }

  private emitLocalEvent(event: SessionEvent): void {
    this.onSessionEvent?.(event);
  }

  private resolvePendingRun(): void {
    this.pendingRuns.shift()?.resolve();
  }

  private rejectPendingRun(error: string): void {
    const pending = this.pendingRuns.shift();
    if (!pending) return;
    pending.reject(new Error(error));
  }

  private handleMessage(message: OutboundRealtimeMessage): void {
    switch (message.type) {
      case "session_event":
        this.lastSequence = Math.max(this.lastSequence, message.sequence);
        this.onSessionEvent?.(message.event);
        if (message.event.type === "run_completed" || message.event.type === "run_failed") {
          this.resolvePendingRun();
        }
        break;
      case "ack":
        break;
      case "error":
        this.emitLocalEvent({ type: "connection_error", error: message.error });
        this.rejectPendingRun(message.error);
        break;
    }
  }
}
