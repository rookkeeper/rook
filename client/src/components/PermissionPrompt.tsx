import { View, Text, StyleSheet } from "react-native";
import type { AcpPermissionOption, AcpPermissionToolCall } from "../lib/acp";
import { tokens } from "../theme";
import { AppButton } from "./AppButton";

interface Props {
  toolCall: AcpPermissionToolCall;
  options: AcpPermissionOption[];
  onDecide: (optionId?: string) => void;
}

export function PermissionPrompt({ toolCall, options, onDecide }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.header}>Permission requested</Text>
      <Text style={styles.title}>{toolCall.title}</Text>
      <Text style={styles.kind}>{toolCall.kind}</Text>
      <View style={styles.actions}>
        {options.map((option) => (
          <AppButton key={option.optionId} label={option.name} onPress={() => onDecide(option.optionId)} compact />
        ))}
        <AppButton label="Cancel" kind="secondary" onPress={() => onDecide()} compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: tokens.spacing.md,
    marginTop: tokens.spacing.md,
    backgroundColor: tokens.colors.accentBg,
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  header: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    color: tokens.colors.textNormal,
    fontWeight: "600",
    fontSize: tokens.fontSizes.bodySm,
  },
  kind: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
  },
});
