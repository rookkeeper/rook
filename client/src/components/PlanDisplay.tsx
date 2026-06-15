import { View, Text, StyleSheet } from "react-native";
import type { AcpPlanEntry } from "../lib/acp";
import { tokens } from "../theme";

interface Props {
  entries: AcpPlanEntry[];
}

export function PlanDisplay({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Plan</Text>
      {entries.map((entry, index) => (
        <View key={`${entry.content}-${index}`} style={styles.row}>
          <Text style={[styles.content, entry.status === "completed" && styles.completed]}>{entry.content}</Text>
          <Text style={styles.meta}>{entry.priority} \u00b7 {entry.status.replace("_", " ")}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: tokens.spacing.md,
    marginTop: tokens.spacing.md,
    backgroundColor: tokens.colors.planBg,
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.md,
    gap: tokens.spacing.xs,
  },
  label: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: tokens.spacing.md,
    paddingLeft: tokens.spacing.md,
  },
  content: {
    color: tokens.colors.textNormal,
    flex: 1,
    fontSize: tokens.fontSizes.bodySm,
  },
  completed: {
    textDecorationLine: "line-through",
    opacity: 0.75,
  },
  meta: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
});
