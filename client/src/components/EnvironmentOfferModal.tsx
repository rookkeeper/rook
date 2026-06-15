import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import type { EnvironmentDecision, EnvironmentOfferAvailablePayload } from "../lib/environment";
import { tokens } from "../theme";
import { AppButton } from "./AppButton";

interface Props {
  offer: EnvironmentOfferAvailablePayload | null;
  onDecide: (decision: EnvironmentDecision) => void;
}

export function EnvironmentOfferModal({ offer, onDecide }: Props) {
  if (!offer) return null;

  return (
    <Modal visible animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Environment available</Text>
          <Text style={styles.name}>{offer.sourceName ?? offer.environmentId}</Text>
          <Text style={styles.meta}>{offer.canonicalSourceUrl ?? "Approve to attach its skills."}</Text>
          <View style={styles.actions}>
            <AppButton label="Allow this visit" onPress={() => onDecide("accept")} />
            <AppButton label="Always allow" onPress={() => onDecide("approve")} />
          </View>
          <View style={styles.actions}>
            <AppButton label="Not now" kind="secondary" onPress={() => onDecide("ignore")} />
            <AppButton label="Never" kind="danger" onPress={() => onDecide("reject")} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: tokens.spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: tokens.colors.backgroundSecondary,
    borderRadius: tokens.radii.xl,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  title: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.subheading,
    fontWeight: "700",
  },
  name: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.bodyLg,
    fontWeight: "600",
  },
  meta: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.label,
  },
  actions: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
    flexWrap: "wrap",
  },
});
