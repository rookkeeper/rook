import { useState, type FormEvent } from "react";
import type { AgentDefinition } from "../agent";

const DEFAULT_SESSION_NAME = "default";

export interface EnvironmentSkillSummary {
  source: string;
  skillNames: string[];
}

export interface AgentSelectionScreenProps {
  agents: AgentDefinition[];
  startingAgent: string | null;
  startupError: string | null;
  environmentSkills?: EnvironmentSkillSummary[];
  onNewSession: (agentId: string, sessionName: string) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}

export function AgentSelectionScreen({
  agents,
  startingAgent,
  startupError,
  environmentSkills = [],
  onNewSession,
  onContinueSession,
}: AgentSelectionScreenProps) {
  const [newSessionAgent, setNewSessionAgent] = useState<AgentDefinition | null>(null);

  const createSession = (sessionName: string) => {
    if (!newSessionAgent) return;
    onNewSession(newSessionAgent.id, sessionName);
    setNewSessionAgent(null);
  };

  return (
    <div className="cwa-agent-selection" aria-label="Choose an agent">
      <div className="cwa-agent-selection__intro">
        <h2>Choose your agent</h2>
        <p>Start a new session or continue an existing one.</p>
      </div>
      {environmentSkills.length > 0 && <EnvironmentSkillsNotice environmentSkills={environmentSkills} />}
      <AgentTree
        agents={agents}
        startingAgent={startingAgent}
        onNewSession={setNewSessionAgent}
        onContinueSession={onContinueSession}
      />
      {startupError && <div className="cwa-agent-selection__error" role="alert">{startupError}</div>}
      {newSessionAgent && (
        <NewSessionDialog
          agent={newSessionAgent}
          disabled={startingAgent !== null}
          onCreate={createSession}
          onCancel={() => setNewSessionAgent(null)}
        />
      )}
    </div>
  );
}

function EnvironmentSkillsNotice({ environmentSkills }: { environmentSkills: EnvironmentSkillSummary[] }) {
  return (
    <section className="cwa-environment-skills-notice" aria-label="Environment skills to add">
      <div className="cwa-environment-skills-notice__heading">Approved environment skills will be added to sessions</div>
      <p>You can continue existing sessions; currently approved environment skills are included when resuming.</p>
      <ul>
        {environmentSkills.map((injection, index) => (
          <li key={`${injection.source}-${index}`}>
            <span className="cwa-environment-skills-notice__source">{injection.source}</span>
            <span>{injection.skillNames.length > 0 ? injection.skillNames.join(", ") : "No SKILL.md files detected"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewSessionDialog({
  agent,
  disabled,
  onCreate,
  onCancel,
}: {
  agent: AgentDefinition;
  disabled: boolean;
  onCreate: (sessionName: string) => void;
  onCancel: () => void;
}) {
  const [sessionName, setSessionName] = useState(DEFAULT_SESSION_NAME);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    onCreate(sessionName.trim() || DEFAULT_SESSION_NAME);
  };

  return (
    <div className="cwa-session-name-dialog__backdrop" role="presentation">
      <form className="cwa-session-name-dialog" role="dialog" aria-modal="true" aria-labelledby="session-name-title" onSubmit={submit}>
        <div>
          <h3 id="session-name-title">Name this session</h3>
          <p>Create a new {agent.id} session.</p>
        </div>
        <label className="cwa-session-name-dialog__field">
          <span>Session name</span>
          <input
            autoFocus
            value={sessionName}
            onChange={(event) => setSessionName(event.target.value)}
            disabled={disabled}
          />
        </label>
        <div className="cwa-session-name-dialog__actions">
          <button type="button" onClick={onCancel} disabled={disabled}>Cancel</button>
          <button type="submit" disabled={disabled}>{disabled ? "Creating…" : "Create agent"}</button>
        </div>
      </form>
    </div>
  );
}

function childAgents(parentId: string | null, agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter((agent) => agent.parentId === parentId);
}

function AgentTree({
  agents,
  startingAgent,
  onNewSession,
  onContinueSession,
}: {
  agents: AgentDefinition[];
  startingAgent: string | null;
  onNewSession: (agent: AgentDefinition) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}) {
  return (
    <div className="cwa-agent-tree">
      <AgentRows
        agents={agents}
        parentId={null}
        startingAgent={startingAgent}
        onNewSession={onNewSession}
        onContinueSession={onContinueSession}
      />
    </div>
  );
}

function AgentRows({
  agents,
  parentId,
  depth = 0,
  startingAgent,
  onNewSession,
  onContinueSession,
}: {
  agents: AgentDefinition[];
  parentId: string | null;
  depth?: number;
  startingAgent: string | null;
  onNewSession: (agent: AgentDefinition) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}) {
  return (
    <>
      {childAgents(parentId, agents).map((agent) => {
        const children = childAgents(agent.id, agents);
        return (
          <div key={agent.id} className="cwa-agent-tree__item">
            <AgentRow
              agent={agent}
              depth={depth}
              startingAgent={startingAgent}
              onNewSession={onNewSession}
              onContinueSession={onContinueSession}
            />
            {children.length > 0 && (
              <AgentRows
                agents={agents}
                parentId={agent.id}
                depth={depth + 1}
                startingAgent={startingAgent}
                onNewSession={onNewSession}
                onContinueSession={onContinueSession}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function AgentRow({
  agent,
  depth,
  startingAgent,
  onNewSession,
  onContinueSession,
}: {
  agent: AgentDefinition;
  depth: number;
  startingAgent: string | null;
  onNewSession: (agent: AgentDefinition) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}) {
  return (
    <div className="cwa-agent-row" style={{ paddingLeft: `${Math.max(0, depth - 1) * 24}px` }}>
      <div className="cwa-agent-row__label">
        {depth > 0 && <span className="cwa-agent-row__branch">└─</span>}
        <span className="cwa-agent-row__name">{agent.id}</span>
      </div>
      <div className="cwa-agent-row__actions">
        <button type="button" onClick={() => onNewSession(agent)} disabled={startingAgent !== null}>
          {startingAgent === agent.id ? "Starting…" : "New"}
        </button>
        <button
          type="button"
          onClick={() => onContinueSession(agent)}
          disabled={startingAgent !== null}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
