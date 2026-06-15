import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Modal } from "react-native";
import type { AgentDefinition } from "../lib/agent";
import { tokens } from "../theme";
import { AppButton } from "./AppButton";

interface Props {
  agents: AgentDefinition[];
  startingAgent: string | null;
  onNewSession: (agentId: string, sessionName: string) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}

function childAgents(parentId: string | null, agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter((agent) => agent.parentId === parentId);
}

export function AgentTree({ agents, startingAgent, onNewSession, onContinueSession }: Props) {
  const [newSessionAgent, setNewSessionAgent] = useState<AgentDefinition | null>(null);
  const [sessionName, setSessionName] = useState("default");

  const createSession = () => {
    if (!newSessionAgent) return;
    onNewSession(newSessionAgent.id, sessionName.trim() || "default");
    setNewSessionAgent(null);
    setSessionName("default");
  };

  return (
    <View style={styles.container}>
      <AgentRows
        agents={agents}
        parentId={null}
        startingAgent={startingAgent}
        onNewSession={setNewSessionAgent}
        onContinueSession={onContinueSession}
      />

      <Modal visible={newSessionAgent !== null} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setNewSessionAgent(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Name this session</Text>
            <Text style={styles.modalSubtitle}>Create a new {newSessionAgent?.id} session.</Text>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Session name</Text>
              <TextInput
                autoFocus
                value={sessionName}
                onChangeText={setSessionName}
                editable={startingAgent === null}
                style={styles.fieldInput}
                placeholderTextColor={tokens.colors.textMuted}
              />
            </View>
            <View style={styles.modalActions}>
              <AppButton label="Cancel" kind="secondary" onPress={() => setNewSessionAgent(null)} disabled={startingAgent !== null} />
              <AppButton label={startingAgent !== null ? "Creating…" : "Create agent"} onPress={createSession} disabled={startingAgent !== null} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function AgentRows({
  agents, parentId, depth = 0, startingAgent, onNewSession, onContinueSession,
}: {
  agents: AgentDefinition[];
  parentId: string | null;
  depth?: number;
  startingAgent: string | null;
  onNewSession: (agent: AgentDefinition) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}) {
  const children = childAgents(parentId, agents);
  return (
    <>
      {children.map((agent) => {
        const grandchildren = childAgents(agent.id, agents);
        return (
          <View key={agent.id}>
            <AgentRow agent={agent} depth={depth} startingAgent={startingAgent} onNewSession={onNewSession} onContinueSession={onContinueSession} />
            {grandchildren.length > 0 && (
              <AgentRows agents={agents} parentId={agent.id} depth={depth + 1} startingAgent={startingAgent} onNewSession={onNewSession} onContinueSession={onContinueSession} />
            )}
          </View>
        );
      })}
    </>
  );
}

function AgentRow({
  agent, depth, startingAgent, onNewSession, onContinueSession,
}: {
  agent: AgentDefinition;
  depth: number;
  startingAgent: string | null;
  onNewSession: (agent: AgentDefinition) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}) {
  return (
    <View style={[styles.row, { paddingLeft: Math.max(0, depth - 1) * 24 }]}>
      <View style={styles.rowLabel}>
        {depth > 0 && <Text style={styles.branch}>└─</Text>}
        <Text style={styles.rowName}>{agent.id}</Text>
      </View>
      <View style={styles.rowActions}>
        <AppButton
          label={startingAgent === agent.id ? "Starting…" : "New"}
          onPress={() => onNewSession(agent)}
          disabled={startingAgent !== null}
          compact
        />
        <AppButton label="Continue" kind="secondary" onPress={() => onContinueSession(agent)} disabled={startingAgent !== null} compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: tokens.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: tokens.spacing.xs,
  },
  rowLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.xxs,
    flex: 1,
  },
  branch: {
    color: tokens.colors.textMuted,
    fontFamily: tokens.fonts.mono,
    fontSize: tokens.fontSizes.bodySm,
    lineHeight: 18,
  },
  rowName: {
    color: tokens.colors.textNormal,
    fontWeight: "700",
    fontFamily: tokens.fonts.mono,
    fontSize: tokens.fontSizes.bodySm,
  },
  rowActions: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: tokens.spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: tokens.colors.backgroundSecondary,
    borderRadius: tokens.radii.xl,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  modalTitle: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.subheading,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.bodySm,
  },
  fieldRow: {
    gap: tokens.spacing.xxs,
  },
  fieldLabel: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
  },
  fieldInput: {
    backgroundColor: tokens.colors.backgroundPrimary,
    color: tokens.colors.textNormal,
    borderRadius: tokens.radii.sm,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderWidth: 1,
    borderColor: tokens.colors.modifierBorder,
  },
  modalActions: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
    justifyContent: "flex-end",
  },
});
