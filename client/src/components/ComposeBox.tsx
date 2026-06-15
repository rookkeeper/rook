import { useState } from "react";
import { View, TextInput, StyleSheet, Platform } from "react-native";
import { tokens } from "../theme";
import { AppButton } from "./AppButton";

interface Props {
  isAgentProcessing: boolean;
  disabled?: boolean;
  onSubmit: (text: string) => void;
  onStop?: () => void;
}

export function ComposeBox({ isAgentProcessing, disabled = false, onSubmit, onStop }: Props) {
  const [draft, setDraft] = useState("");

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSubmit(text);
  };

  // On web, multiline TextInput doesn't fire onSubmitEditing for Enter.
  // Intercept Enter without Shift to submit, Shift+Enter for newline.
  const handleKeyPress = (e: unknown) => {
    const event = e as { nativeEvent?: { key?: string; shiftKey?: boolean } };
    if (event?.nativeEvent?.key === "Enter" && !event.nativeEvent.shiftKey) {
      handleSubmit();
    }
  };

  const actionLabel = isAgentProcessing ? "Queue" : "Send";
  const webInputProps = Platform.OS === "web" ? ({ onKeyDown: handleKeyPress } as unknown as Record<string, unknown>) : {};

  return (
    <View style={styles.row}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Message your agent"
        placeholderTextColor={tokens.colors.textMuted}
        style={styles.input}
        multiline
        editable={!disabled}
        onSubmitEditing={handleSubmit}
        onKeyPress={handleKeyPress}
        blurOnSubmit={false}
        {...webInputProps}
      />
      <View style={styles.actions}>
        {isAgentProcessing && onStop && <AppButton label="Stop" kind="danger" onPress={onStop} compact />}
        <AppButton label={actionLabel} onPress={handleSubmit} disabled={disabled && !isAgentProcessing} compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
    alignItems: "flex-end",
    padding: tokens.spacing.md,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: tokens.radii.sm,
    backgroundColor: tokens.colors.queueBg,
    color: tokens.colors.textNormal,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    textAlignVertical: "top",
  },
  actions: {
    gap: tokens.spacing.xs,
  },
});
