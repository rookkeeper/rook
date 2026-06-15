import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { AgentBackend, AgentDefinition, AgentSessionSummary } from "./lib/agent";
import type { EnvironmentDecision, EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "./lib/environment";
import { RemoteAgent, decideEnvironment, fetchAgentDefinitions, fetchAgentSessions, fetchMostRecentSession } from "./lib/remoteAgent";
import { tokens, breakpoints } from "./theme";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { AppButton } from "./components/AppButton";
import { AgentSelectionScreen, type EnvironmentSkillSummary } from "./screens/AgentSelectionScreen";
import { SessionSelectionScreen } from "./screens/SessionSelectionScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { EnvironmentOfferModal } from "./components/EnvironmentOfferModal";

type AppScreen =
  | { type: "agent-selection" }
  | { type: "session-selection"; agent: AgentDefinition }
  | { type: "chat"; agentId: AgentBackend; session: AgentSessionSummary; viewKey: number };

function screenLabel(screen: AppScreen, agents: AgentDefinition[]): string {
  if (screen.type !== "chat") return "Choose agent";
  const agentName = agents.find((a) => a.id === screen.agentId)?.id ?? screen.agentId;
  const sessionName = screen.session.name?.trim();
  return sessionName && sessionName !== "default" ? `${agentName} \u00b7 ${sessionName}` : agentName;
}

export function App() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [screen, setScreen] = useState<AppScreen>({ type: "agent-selection" });
  const [startingAgent, setStartingAgent] = useState<AgentBackend | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [environmentOffer, setEnvironmentOffer] = useState<EnvironmentOfferAvailablePayload | null>(null);
  const [acceptedEnvironments, setAcceptedEnvironments] = useState<EnvironmentSkillSummary[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const initialResumeAttemptedRef = useRef(false);
  const chatViewKeyRef = useRef(0);
  const bp = useBreakpoint();

  const startAgent = useCallback(async (
    backend: AgentBackend,
    session?: AgentSessionSummary,
    options: { restartExisting?: boolean; sessionName?: string } = {},
  ) => {
    setStartupError(null);
    setStartingAgent(backend);
    try {
      const result = await new RemoteAgent({
        backend, session,
        sessionName: options.sessionName,
        includeReplayEvents: options.restartExisting,
        restartExisting: options.restartExisting,
      }).start();
      chatViewKeyRef.current += 1;
      setShowSettings(false);
      setScreen({ type: "chat", agentId: backend, session: result.session, viewKey: chatViewKeyRef.current });
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingAgent(null);
    }
  }, []);

  const handleEnvironmentOfferAvailable = useCallback((payload: EnvironmentOfferAvailablePayload) => {
    setEnvironmentOffer((current) => (current?.environmentId === payload.environmentId ? current : payload));
  }, []);

  const handleEnvironmentOfferResolved = useCallback((payload: EnvironmentOfferResolvedPayload) => {
    setEnvironmentOffer((current) => (current?.environmentId === payload.environmentId ? null : current));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAgentDefinitions()
      .then((defs) => { if (!cancelled) setAgents(defs); })
      .catch((error) => { if (!cancelled) setStartupError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (agents.length === 0 || initialResumeAttemptedRef.current) return;
    initialResumeAttemptedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const recent = await fetchMostRecentSession();
        if (cancelled || !recent) return;
        await startAgent(recent.agent, recent);
      } catch (error) {
        if (!cancelled) setStartupError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [agents, startAgent]);

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

  const decideEnvironmentOffer = async (decision: EnvironmentDecision) => {
    if (!environmentOffer) return;
    const offer = environmentOffer;
    setEnvironmentOffer(null);
    if (decision === "accept" || decision === "approve") {
      setAcceptedEnvironments((prev) => [...prev, { source: offer.sourceName ?? offer.environmentId, skillNames: [] }]);
    }
    try {
      await decideEnvironment(offer.environmentId, decision);
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : String(error));
    }
  };

  const headerLabel = useMemo(() => screenLabel(screen, agents), [screen, agents]);

  return (
    <View style={styles.shell}>
      <View style={[styles.window, bp === "compact" && styles.windowCompact]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Rook</Text>
            <Text style={styles.headerSubtitle}>
              {screen.type === "chat" ? "Agent chat" : "Select an agent to begin."}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {screen.type === "chat" && (
              <Pressable onPress={() => setShowSettings((v) => !v)} style={({ pressed }) => [styles.settingsIconButton, pressed && styles.settingsIconButtonPressed]}>
                <Text style={styles.settingsIcon}>⚙</Text>
              </Pressable>
            )}
            <Text style={styles.badge}>{headerLabel}</Text>
            {screen.type === "chat" && (
              <AppButton
                label="Sessions"
                kind="secondary"
                onPress={() => { setShowSettings(false); setScreen({ type: "agent-selection" }); }}
                compact
              />
            )}
          </View>
        </View>

        {screen.type === "chat" ? (
          <ChatScreen
            key={screen.viewKey}
            agentId={screen.agentId}
            session={screen.session}
            showSettings={showSettings}
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
            environmentSkills={acceptedEnvironments}
            onNewSession={(agentId, sessionName) => void startAgent(agentId, undefined, { sessionName })}
            onContinueSession={(agent) => void openSessionSelection(agent)}
          />
        )}
      </View>

      <EnvironmentOfferModal offer={environmentOffer} onDecide={(d) => void decideEnvironmentOffer(d)} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: tokens.colors.backgroundPrimary,
  },
  window: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
    backgroundColor: tokens.colors.backgroundSecondary,
    borderRadius: tokens.radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: tokens.colors.windowBorder,
    margin: tokens.spacing.xl,
  },
  windowCompact: {
    margin: 0,
    borderRadius: 0,
    borderWidth: 0,
    maxHeight: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.modifierBorder,
    backgroundColor: tokens.colors.headerBg,
  },
  headerTitle: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.subheading,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.xs,
  },
  settingsIconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIconButtonPressed: {
    opacity: 0.75,
  },
  settingsIcon: {
    color: tokens.colors.textMuted,
    fontSize: 22,
    lineHeight: 22,
  },
  badge: {
    color: tokens.colors.textMuted,
    borderWidth: 1,
    borderColor: tokens.colors.statusBadgeBorder,
    borderRadius: tokens.radii.full,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xxs,
    fontSize: tokens.fontSizes.caption,
    overflow: "hidden",
  },
});
