import { Pressable, Text, StyleSheet } from "react-native";
import { tokens } from "../theme";

interface Props {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  compact?: boolean;
}

export function AppButton({ label, onPress, kind = "primary", disabled = false, compact = false }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        kind === "secondary" ? styles.secondary : kind === "danger" ? styles.danger : styles.primary,
        compact && styles.compact,
        (pressed) && !disabled && styles.hover,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: tokens.radii.full,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs,
  },
  compact: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xxs,
  },
  primary: {
    backgroundColor: tokens.colors.interactiveAccent,
  },
  secondary: {
    backgroundColor: tokens.colors.backgroundTertiary,
  },
  danger: {
    backgroundColor: tokens.colors.danger,
  },
  hover: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: tokens.colors.textOnAccent,
    fontWeight: "600",
    fontSize: tokens.fontSizes.bodySm,
  },
  labelCompact: {
    fontSize: tokens.fontSizes.label,
  },
});
