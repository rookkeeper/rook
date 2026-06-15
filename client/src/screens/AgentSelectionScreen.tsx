import { View, Text, StyleSheet } from "react-native";
import type { AgentDefinition } from "../lib/agent";
import { tokens } from "../theme";
import { AgentTree } from "../components/AgentTree";

export interface EnvironmentSkillSummary {
  source: string;
  skillNames: string[];
}

interface Props {
  agents: AgentDefinition[];
  startingAgent: string | null;
  startupError: string | null;
  environmentSkills?: EnvironmentSkillSummary[];
  onNewSession: (agentId: string, sessionName: string) => void;
  onContinueSession: (agent: AgentDefinition) => void;
}

export function AgentSelectionScreen({
  agents, startingAgent, startupError, environmentSkills = [], onNewSession, onContinueSession,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.heading}>Choose your agent</Text>
        <Text style={styles.subtitle}>Start a new session or continue an existing one.</Text>
      </View>
      {environmentSkills.length > 0 && (
        <View style={styles.skillsNotice}>
          <Text style={styles.skillsHeading}>Approved environment skills will be added to sessions</Text>
          <Text style={styles.skillsSub}>You can continue existing sessions; currently approved environment skills are included when resuming.</Text>
          {environmentSkills.map((injection, index) => (
            <View key={`${injection.source}-${index}`} style={styles.skillsRow}>
              <Text style={styles.skillsSource}>{injection.source}</Text>
              <Text style={styles.skillsList}>{injection.skillNames.length > 0 ? injection.skillNames.join(", ") : "No SKILL.md files detected"}</Text>
            </View>
          ))}
        </View>
      )}
      <AgentTree
        agents={agents}
        startingAgent={startingAgent}
        onNewSession={onNewSession}
        onContinueSession={onContinueSession}
      />
      {startupError ? <Text style={styles.error}>{startupError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    gap: tokens.spacing.xl,
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
  skillsNotice: {
    borderWidth: 1,
    borderColor: tokens.colors.accentBorder,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.accentBg,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.sm,
  },
  skillsHeading: {
    color: tokens.colors.textNormal,
    fontWeight: "800",
    fontSize: tokens.fontSizes.bodySm,
  },
  skillsSub: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.bodySm,
  },
  skillsRow: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
  },
  skillsSource: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
  skillsList: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.caption,
  },
  error: {
    color: tokens.colors.textError,
    textAlign: "center",
  },
});
