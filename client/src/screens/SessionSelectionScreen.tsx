import { View, Text, Pressable, ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import type { AgentDefinition, AgentSessionSummary } from "../lib/agent";
import { tokens } from "../theme";
import { AppButton } from "../components/AppButton";

interface Props {
  agent: AgentDefinition;
  sessions: AgentSessionSummary[];
  loadingSessions: boolean;
  startingAgent: string | null;
  startupError: string | null;
  onSelectSession: (agentId: string, session: AgentSessionSummary) => void;
  onBack: () => void;
}

export function SessionSelectionScreen({
  agent, sessions, loadingSessions, startingAgent, startupError, onSelectSession, onBack,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.heading}>Continue {agent.id}</Text>
        <Text style={styles.subtitle}>Select a previous session.</Text>
      </View>
      <AppButton label="Back" kind="secondary" onPress={onBack} compact />
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loadingSessions ? (
          <View style={styles.emptyRow}>
            <ActivityIndicator color={tokens.colors.interactiveAccent} />
            <Text style={styles.emptyText}>Loading sessions\u2026</Text>
          </View>
        ) : null}
        {!loadingSessions && sessions.length === 0 ? (
          <Text style={styles.emptyText}>No saved sessions yet.</Text>
        ) : null}
        {sessions.map((session) => {
          const isRunning = session.running === true;
          return (
            <Pressable
              key={session.id}
              onPress={() => onSelectSession(agent.id, session)}
              disabled={startingAgent !== null}
              style={({ pressed }) => [
                styles.row,
                pressed && !startingAgent && styles.rowHover,
                startingAgent !== null && styles.rowDisabled,
              ]}
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>{session.name?.trim() || "default"}</Text>
                <Text style={styles.rowDate}>{new Date(session.createdAt).toLocaleString()}</Text>
              </View>
              <View style={[styles.pill, isRunning ? styles.pillRunning : styles.pillStopped]}>
                <Text style={[styles.pillText, isRunning ? styles.pillTextRunning : styles.pillTextStopped]}>
                  {isRunning ? `${session.connectedClients ?? 0} connected` : "Stopped"}
                </Text>
              </View>
              {startingAgent === agent.id ? (
                <Text style={styles.openingText}>Opening\u2026</Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {startupError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{startupError}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    gap: tokens.spacing.lg,
    padding: tokens.spacing.xxl,
    maxWidth: 680,
    alignSelf: "center",
    width: "100%",
  },
  intro: {
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  heading: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.heading,
    fontWeight: "700",
  },
  subtitle: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.bodySm,
  },
  list: {
    maxHeight: 420,
  },
  listContent: {
    gap: tokens.spacing.xs,
    paddingRight: tokens.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.lg,
    paddingVertical: 2,
    paddingHorizontal: tokens.spacing.xxs,
    borderRadius: tokens.spacing.xs,
    minHeight: 30,
  },
  rowHover: {
    backgroundColor: tokens.colors.modifierHover,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.md,
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: tokens.colors.textNormal,
    fontWeight: "700",
    fontSize: tokens.fontSizes.bodySm,
    minWidth: 0,
    overflow: "hidden",
  },
  rowDate: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
  pill: {
    minWidth: 92,
    borderRadius: tokens.radii.full,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 2,
    alignItems: "center",
  },
  pillRunning: {
    backgroundColor: "rgba(110, 231, 183, 0.15)",
  },
  pillStopped: {
    backgroundColor: "rgba(181, 169, 201, 0.08)",
  },
  pillText: {
    fontWeight: "600",
    fontSize: tokens.fontSizes.caption,
  },
  pillTextRunning: {
    color: tokens.colors.success,
  },
  pillTextStopped: {
    color: tokens.colors.textMuted,
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    justifyContent: "center",
  },
  emptyText: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.bodySm,
    textAlign: "center",
    fontStyle: "italic",
  },
  openingText: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
  errorCard: {
    maxWidth: 656,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255, 156, 163, 0.4)",
    borderRadius: tokens.radii.sm,
    backgroundColor: "rgba(255, 156, 163, 0.1)",
  },
  errorText: {
    color: tokens.colors.textError,
    fontSize: tokens.fontSizes.bodySm,
  },
});
