import { View, Text, TextInput, StyleSheet } from "react-native";
import { tokens } from "../theme";
import { AppButton } from "./AppButton";

export interface QueueDisplayMessage {
  id: string;
  text: string;
  draftText: string;
  isEditing: boolean;
}

interface Props {
  messages: QueueDisplayMessage[];
  onEditStart: (id: string) => void;
  onEditChange: (id: string, text: string) => void;
  onEditCancel: (id: string) => void;
  onEditSave: (id: string) => void;
  onSendNow: (id: string) => void;
  onDelete: (id: string) => void;
}

export function QueueDisplay({ messages, onEditStart, onEditChange, onEditCancel, onEditSave, onSendNow, onDelete }: Props) {
  if (messages.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Queued</Text>
      {messages.map((msg) => (
        <View key={msg.id} style={styles.rowWrap}>
          {msg.isEditing ? (
            <View style={styles.rowEditing}>
              <TextInput
                autoFocus
                value={msg.draftText}
                onChangeText={(text) => onEditChange(msg.id, text)}
                style={styles.editInput}
                multiline
                onSubmitEditing={() => onEditSave(msg.id)}
              />
              <View style={styles.actions}>
                <AppButton label="Save" onPress={() => onEditSave(msg.id)} compact />
                <AppButton label="Cancel" kind="secondary" onPress={() => onEditCancel(msg.id)} compact />
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={styles.text} numberOfLines={1}>{msg.text}</Text>
              <View style={styles.actions}>
                <AppButton label="Edit" kind="secondary" onPress={() => onEditStart(msg.id)} compact />
                <AppButton label="Send now" onPress={() => onSendNow(msg.id)} compact />
                <AppButton label="Delete" kind="danger" onPress={() => onDelete(msg.id)} compact />
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: tokens.spacing.md,
    marginTop: tokens.spacing.md,
    backgroundColor: tokens.colors.queueBg,
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
  rowWrap: {
    gap: tokens.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  rowEditing: {
    gap: tokens.spacing.xs,
  },
  text: {
    color: tokens.colors.textNormal,
    flex: 1,
    fontSize: tokens.fontSizes.bodySm,
  },
  actions: {
    flexDirection: "row",
    gap: tokens.spacing.xxs,
  },
  editInput: {
    flex: 1,
    backgroundColor: tokens.colors.backgroundPrimary,
    color: tokens.colors.textNormal,
    borderRadius: tokens.radii.sm,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xxs,
    fontSize: tokens.fontSizes.bodySm,
  },
});
