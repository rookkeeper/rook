import type { CSSProperties } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { AppButton } from "../AppButton";
import { tokens } from "../../theme";

export interface OptionPickerOption {
  value: string;
  label: string;
}

interface OptionPickerProps {
  label: string;
  value: string;
  options: OptionPickerOption[];
  onChange: (value: string) => void;
}

const webSelectStyle: CSSProperties = {
  width: "100%",
  maxWidth: 520,
  borderRadius: 10,
  border: `1px solid ${tokens.colors.modifierBorder}`,
  background: tokens.colors.backgroundTertiary,
  color: tokens.colors.textNormal,
  padding: "10px 12px",
  fontSize: 16,
};

export function OptionPicker({ label, value, options, onChange }: OptionPickerProps) {
  if (Platform.OS === "web") {
    return (
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={webSelectStyle}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }

  return (
    <View style={styles.optionRow}>
      {options.map((option) => (
        <AppButton
          key={option.value}
          label={option.label}
          kind={option.value === value ? "primary" : "secondary"}
          onPress={() => onChange(option.value)}
          compact
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
});
