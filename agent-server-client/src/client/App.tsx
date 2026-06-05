import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentBackend, AgentDefinition, AgentSessionSummary } from "./agent";
import {
  fetchAgentDefinitions,
  fetchAgentSessions,
  fetchMostRecentSession,
  decideEnvironment,
  RemoteAgent,
} from "./remoteAgent";
import { EnvironmentApprovalModal } from "./components/EnvironmentApprovalModal";
import { AgentSelectionScreen } from "./screens/AgentSelectionScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { SessionSelectionScreen } from "./screens/SessionSelectionScreen";
import type {
  EnvironmentDecision,
  EnvironmentOfferAvailablePayload,
  EnvironmentOfferResolvedPayload,
} from "../shared/environment";

type AppScreen =
  | { type: "agent-selection" }
  | { type: "session-selection"; agent: AgentDefinition }
  | { type: "chat"; agentId: AgentBackend; session: AgentSessionSummary; viewKey: number };

function screenLabel(screen: AppScreen, agents: AgentDefinition[]): string {
  if (screen.type !== "chat") return "Choose agent";
  const agentName = agents.find((agent) => agent.id === screen.agentId)?.id ?? screen.agentId;
  const sessionName = screen.session.name?.trim();
  return sessionName && sessionName !== "default" ? `${agentName} · ${sessionName}` : agentName;
}

export function App() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [screen, setScreen] = useState<AppScreen>({ type: "agent-selection" });
  const [startingAgent, setStartingAgent] = useState<AgentBackend | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [environmentOffer, setEnvironmentOffer] = useState<EnvironmentOfferAvailablePayload | null>(null);
  const [acceptedEnvironmentSummaries, setAcceptedEnvironmentSummaries] = useState<{ source: string; skillNames: string[] }[]>([]);
  const initialResumeAttemptedRef = useRef(false);
  const chatViewKeyRef = useRef(0);

  const startAgent = useCallback(async (
    backend: AgentBackend,
    session?: AgentSessionSummary,
    options: { restartExisting?: boolean; sessionName?: string } = {},
  ) => {
    setStartupError(null);
    setStartingAgent(backend);

    try {
      const result = await new RemoteAgent({
        backend,
        session,
        sessionName: options.sessionName,
        includeReplayEvents: options.restartExisting,
        restartExisting: options.restartExisting,
      }).start();
      chatViewKeyRef.current += 1;
      setScreen({
        type: "chat",
        agentId: backend,
        session: result.session,
        viewKey: chatViewKeyRef.current,
      });
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingAgent(null);
    }
  }, []);

  // Offers arrive over the session websocket (pushed by the server). The 2×2 decision is
  // global, so a resolution from any client closes the prompt here too.
  const handleEnvironmentOfferAvailable = useCallback((payload: EnvironmentOfferAvailablePayload) => {
    setEnvironmentOffer((current) => (current?.environmentId === payload.environmentId ? current : payload));
  }, []);

  const handleEnvironmentOfferResolved = useCallback((payload: EnvironmentOfferResolvedPayload) => {
    setEnvironmentOffer((current) => (current?.environmentId === payload.environmentId ? null : current));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchAgentDefinitions()
      .then((definitions) => {
        if (cancelled) return;
        setAgents(definitions);
      })
      .catch((error) => {
        if (cancelled) return;
        setStartupError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (agents.length === 0 || initialResumeAttemptedRef.current) return;
    initialResumeAttemptedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const recentSession = await fetchMostRecentSession();
        if (cancelled || !recentSession) return;
        await startAgent(recentSession.agent, recentSession);
      } catch (error) {
        if (cancelled) return;
        setStartupError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agents, startAgent]);


  const headerLabel = useMemo(() => screenLabel(screen, agents), [screen, agents]);

  const decideEnvironmentOffer = async (decision: EnvironmentDecision) => {
    if (!environmentOffer) return;
    const offer = environmentOffer;
    setEnvironmentOffer(null); // optimistic close; the resolved event will confirm
    if (decision === "accept" || decision === "approve") {
      setAcceptedEnvironmentSummaries((summaries) => [
        ...summaries,
        { source: offer.sourceName ?? offer.environmentId, skillNames: [] },
      ]);
    }
    try {
      await decideEnvironment(offer.environmentId, decision);
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : String(error));
    }
  };

  const postParentMessage = useCallback((message: unknown) => {
    if (!window.parent || window.parent === window) return;

    try {
      window.parent.postMessage(message, "*");
    } catch {
      // Ignore cross-window relay failures.
    }
  }, []);

  const openSessionSelection = async (agent: AgentDefinition) => {
    setStartupError(null);
    setScreen({ type: "session-selection", agent });
    setLoadingSessions(true);
    try {
      setSessions(await fetchAgentSessions(agent.id));
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingSessions(false);
    }
  };

  return (
    <main className="cwa-app-shell">
      <section className="cwa-window" aria-label="Agent Station chat">
        <header className="cwa-header">
          <div>
            <h1>Agent Station</h1>
            {screen.type !== "chat" && <p>Select an agent to begin.</p>}
          </div>
          <div className="cwa-header__actions">
            <span className="cwa-header__status">{headerLabel}</span>
            {screen.type === "chat" && (
              <button
                type="button"
                className="cwa-header__agent-action"
                onClick={() => setScreen({ type: "agent-selection" })}
              >
                Sessions
              </button>
            )}
          </div>
        </header>

        {screen.type === "chat" ? (
          <ChatScreen
            key={screen.viewKey}
            agentId={screen.agentId}
            session={screen.session}
            onParentMessage={postParentMessage}
            onEnvironmentOfferAvailable={handleEnvironmentOfferAvailable}
            onEnvironmentOfferResolved={handleEnvironmentOfferResolved}
          />
        ) : screen.type === "session-selection" ? (
          <SessionSelectionScreen
            agent={screen.agent}
            sessions={sessions}
            loadingSessions={loadingSessions}
            startingAgent={startingAgent}
            startupError={startupError}
            onSelectSession={(agentId, session) => void startAgent(agentId, session)}
            onBack={() => setScreen({ type: "agent-selection" })}
          />
        ) : (
          <AgentSelectionScreen
            agents={agents}
            startingAgent={startingAgent}
            startupError={startupError}
            environmentSkills={acceptedEnvironmentSummaries}
            onNewSession={(agentId, sessionName) => void startAgent(agentId, undefined, { sessionName })}
            onContinueSession={(agent) => void openSessionSelection(agent)}
          />
        )}
      </section>
      {environmentOffer && (
        <EnvironmentApprovalModal
          environmentId={environmentOffer.environmentId}
          sourceLabel={environmentOffer.sourceName}
          onDecide={(decision) => void decideEnvironmentOffer(decision)}
        />
      )}
    </main>
  );
}
