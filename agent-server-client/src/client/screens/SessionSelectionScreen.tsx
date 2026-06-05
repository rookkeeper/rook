import type { AgentDefinition, AgentSessionSummary } from "../agent";

export interface SessionSelectionScreenProps {
  agent: AgentDefinition;
  sessions: AgentSessionSummary[];
  loadingSessions: boolean;
  startingAgent: string | null;
  startupError: string | null;
  onSelectSession: (agentId: string, session: AgentSessionSummary) => void;
  onBack: () => void;
}

export function SessionSelectionScreen({
  agent,
  sessions,
  loadingSessions,
  startingAgent,
  startupError,
  onSelectSession,
  onBack,
}: SessionSelectionScreenProps) {
  return (
    <div className="cwa-session-selection" aria-label="Continue session">
      <div className="cwa-session-selection__intro">
        <h2>Continue {agent.id}</h2>
        <p>Select a previous session.</p>
      </div>
      <button type="button" className="cwa-session-selection__back" onClick={onBack}>
        Back
      </button>
      <SessionList
        agentId={agent.id}
        sessions={sessions}
        loadingSessions={loadingSessions}
        startingAgent={startingAgent}
        onSelectSession={onSelectSession}
      />
      {startupError && <div className="cwa-session-selection__error" role="alert">{startupError}</div>}
    </div>
  );
}

function SessionList({
  agentId,
  sessions,
  loadingSessions,
  startingAgent,
  onSelectSession,
}: {
  agentId: string;
  sessions: AgentSessionSummary[];
  loadingSessions: boolean;
  startingAgent: string | null;
  onSelectSession: (agentId: string, session: AgentSessionSummary) => void;
}) {
  return (
    <div className="cwa-session-list">
      {loadingSessions && <div className="cwa-session-list__empty">Loading sessions…</div>}
      {!loadingSessions && sessions.length === 0 && <div className="cwa-session-list__empty">No saved sessions yet.</div>}
      {sessions.map((session) => {
        const isRunning = session.running === true;
        const rowClassName = `cwa-session-row${isRunning ? " cwa-session-row--running" : " cwa-session-row--stopped"}`;
        return (
          <button
            key={session.id}
            type="button"
            className={rowClassName}
            onClick={() => onSelectSession(agentId, session)}
            disabled={startingAgent !== null}
          >
            <span className="cwa-session-row__main">
              <span className="cwa-session-row__name">{session.name ?? "default"}</span>
              <span className="cwa-session-row__created">{new Date(session.createdAt).toLocaleString()}</span>
            </span>
            <span className={`cwa-session-row__pill ${isRunning ? "cwa-session-row__running" : "cwa-session-row__stopped"}`}>
              {isRunning ? `${session.connectedClients ?? 0} connected` : "Stopped"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
