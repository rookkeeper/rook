import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import type { Block } from "../lib/types";
import { tokens } from "../theme";
import { BlockRenderer } from "./MessageBlocks";

interface Props {
  block: Block | null;
  onClose: () => void;
}

export function BlockModal({ block, onClose }: Props) {
  if (!block) return null;

  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>{titleForBlock(block)}</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeLabel}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
          <BlockRenderer block={block} forceExpanded />
        </View>
      </View>
    </Modal>
  );
}

function titleForBlock(block: Block): string {
  if (block.type === "text") return block.role === "user" ? "Your message" : "Agent response";
  if (block.type === "thinking") return "Thinking";
  if (block.type === "toolBlock") return `Tool: ${block.name}`;
  return block.source.toUpperCase();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.colors.backgroundPrimary,
    paddingTop: tokens.spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: tokens.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.modifierBorder,
  },
  title: {
    color: tokens.colors.textNormal,
    fontWeight: "700",
    fontSize: tokens.fontSizes.subheading,
  },
  closeBtn: {
    backgroundColor: tokens.colors.backgroundTertiary,
    borderRadius: tokens.radii.full,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xxs,
  },
  closeLabel: {
    color: tokens.colors.textNormal,
    fontWeight: "600",
    fontSize: tokens.fontSizes.bodySm,
  },
  content: {
    flex: 1,
    padding: tokens.spacing.lg,
  },
});
