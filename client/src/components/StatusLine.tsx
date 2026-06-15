import { View, Text, StyleSheet } from "react-native";
import { tokens } from "../theme";
import type { AgentRunStatus } from "../lib/agent";

interface Props {
  status: AgentRunStatus | "queued";
  message: string;
  usageLabel?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  idle: tokens.colors.success,
  busy: tokens.colors.warning,
  thinking: tokens.colors.warning,
  streaming: tokens.colors.warning,
  using_tool: tokens.colors.warning,
  retrying: tokens.colors.warning,
  queued: tokens.colors.interactiveAccent,
  error: tokens.colors.danger,
};

export function StatusLine({ status, message, usageLabel }: Props) {
  const color = STATUS_COLORS[status] ?? tokens.colors.textMuted;

  return (
    <View style={styles.row}>
      <View style={styles.primary}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.label, { color }]}>{message}</Text>
      </View>
      {usageLabel ? <Text style={styles.usage}>{usageLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: tokens.spacing.md,
    marginTop: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontWeight: "600",
    fontSize: tokens.fontSizes.bodySm,
  },
  usage: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
  },
});
