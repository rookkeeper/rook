import { Text, View, StyleSheet } from "react-native";
import type { AcpConfigOption } from "../lib/acp";
import { tokens } from "../theme";
import { OptionPicker } from "./controls/OptionPicker";

interface AcpSettingsPanelProps {
  currentModeId?: string;
  availableModes?: Array<{ id: string; name: string }>;
  configOptions: AcpConfigOption[];
  onModeChange: (modeId: string) => void;
  onConfigOptionChange: (configId: string, value: string) => void;
}

function optionLabel(option: AcpConfigOption, value: AcpConfigOption["options"][number]): string {
  if (option.category === "model" && value.description) return `${value.name} — ${value.description}`;
  return value.name;
}

export function displayConfigOptions(configOptions: AcpConfigOption[], hasModes: boolean): AcpConfigOption[] {
  return configOptions.filter((option) => !(hasModes && option.category === "mode"));
}

export function AcpSettingsPanel({
  currentModeId,
  availableModes = [],
  configOptions,
  onModeChange,
  onConfigOptionChange,
}: AcpSettingsPanelProps) {
  const visibleConfigOptions = displayConfigOptions(configOptions, availableModes.length > 0);

  return (
    <View style={styles.settingsBar}>
      {currentModeId && availableModes.length > 0 && (
        <View style={styles.settingGroup}>
          <Text style={styles.settingLabel}>Mode</Text>
          <OptionPicker
            label="Mode"
            value={currentModeId}
            options={availableModes.map((mode) => ({ value: mode.id, label: mode.name }))}
            onChange={onModeChange}
          />
        </View>
      )}
      {visibleConfigOptions.map((option) => (
        <View key={option.id} style={styles.settingGroup}>
          <Text style={styles.settingLabel}>{option.name}</Text>
          <OptionPicker
            label={option.name}
            value={option.currentValue}
            options={option.options.map((value) => ({ value: value.value, label: optionLabel(option, value) }))}
            onChange={(value) => onConfigOptionChange(option.id, value)}
          />
        </View>
      ))}
      {!currentModeId && configOptions.length === 0 && (
        <Text style={styles.settingEmpty}>No ACP settings reported yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  settingsBar: {
    padding: tokens.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.modifierBorder,
    backgroundColor: tokens.colors.headerBg,
    gap: tokens.spacing.sm,
  },
  settingGroup: {
    gap: tokens.spacing.xxs,
  },
  settingLabel: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
  },
  settingEmpty: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.caption,
  },
});
