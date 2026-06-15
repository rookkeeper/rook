import { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { MarkdownText } from "./Markdown";
import type { Block } from "../lib/types";
import { tokens } from "../theme";

function MarkdownContent({ text, streaming, color = tokens.colors.textOnAccent }: { text: string; streaming?: boolean; color?: string }) {
  if (!text && streaming) return <Text style={[styles.streamingCursor, { color }]}>{"…"}</Text>;
  if (!text) return null;
  return <MarkdownText color={color} selectable>{text}</MarkdownText>;
}

export function BlockRenderer({ block, forceExpanded = false }: { block: Block; forceExpanded?: boolean }) {
  switch (block.type) {
    case "text":
      return block.role === "user"
        ? <UserMessageBlock text={block.text} fullWidth={forceExpanded} />
        : <AgentTextBlock text={block.text} isStreaming={block.isStreaming} fullWidth={forceExpanded} />;
    case "thinking":
      return <ThinkingBlock thinking={block.thinking} isStreaming={block.isStreaming} forceExpanded={forceExpanded} fullWidth={forceExpanded} />;
    case "toolBlock":
      return <ToolBlockView block={block} forceExpanded={forceExpanded} />;
    case "error":
      return <ErrorBlockView source={block.source} message={block.message} />;
    default:
      return null;
  }
}

export function UserMessageBlock({ text, fullWidth = false }: { text: string; fullWidth?: boolean }) {
  return (
    <View style={[styles.row, styles.rowEnd]}>
      <View style={[styles.bubble, styles.userBubble, fullWidth && styles.fullWidthBubble]}>
        <MarkdownContent text={text} />
      </View>
    </View>
  );
}

export function AgentTextBlock({ text, isStreaming, fullWidth = false }: { text: string; isStreaming: boolean; fullWidth?: boolean }) {
  return (
    <View style={[styles.row, styles.rowStart]}>
      <View style={[styles.bubble, styles.agentBubble, fullWidth && styles.fullWidthBubble]}>
        <MarkdownContent text={text} streaming={isStreaming} />
        {isStreaming && <View style={styles.cursor} />}
      </View>
    </View>
  );
}

export function ThinkingBlock({ thinking, isStreaming, forceExpanded = false, fullWidth = false }: { thinking: string; isStreaming: boolean; forceExpanded?: boolean; fullWidth?: boolean }) {
  const [expanded, setExpanded] = useState(isStreaming || forceExpanded);
  const shouldExpand = forceExpanded || expanded || isStreaming;
  return (
    <View style={[styles.row, styles.rowStart]}>
      <View style={[styles.thinkingBubble, fullWidth && styles.fullWidthBubble]}>
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.thinkingToggle}>
          <Text style={styles.thinkingLabel}>{isStreaming ? "THINKING…" : "THINKING"}</Text>
          <Text style={styles.chevron}>{shouldExpand ? "▼" : "▶"}</Text>
        </Pressable>
        {shouldExpand ? (
          <ScrollView style={styles.thinkingContentScroll} nestedScrollEnabled>
            <MarkdownText color={tokens.colors.textOnAccent} selectable>{thinking}</MarkdownText>
          </ScrollView>
        ) : (
          <Text selectable numberOfLines={2} ellipsizeMode="tail" style={styles.thinkingPreview}>{thinking}</Text>
        )}
      </View>
    </View>
  );
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  input_streaming: "Preparing",
  ready: "Ready",
  running: "Running",
  completed: "Completed",
  error: "Failed",
};

export function ToolBlockView({ block, onClick, forceExpanded = false }: { block: Extract<Block, { type: "toolBlock" }>; onClick?: () => void; forceExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const effectiveExpanded = forceExpanded || expanded;
  return (
    <Pressable onPress={onClick} style={({ pressed }) => [styles.toolCard, pressed && styles.toolCardPressed]}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.toolHeader}>
        <Text style={styles.toolLabel}>Tool</Text>
        <Text style={styles.toolName} numberOfLines={1}>{block.name}</Text>
        <Text style={[
          styles.toolStatus,
          block.status === "running" && styles.toolStatusRunning,
          block.status === "completed" && styles.toolStatusDone,
          block.status === "error" && styles.toolStatusError,
        ]}>{TOOL_STATUS_LABELS[block.status] ?? block.status}</Text>
        {(block.argumentsStreaming || block.status === "running") && <View style={styles.cursorDark} />}
        <Text style={styles.chevron}>{effectiveExpanded ? "▲" : "▼"}</Text>
      </Pressable>
      {effectiveExpanded && (
        <View style={styles.toolBody}>
          {(block.arguments.length > 0 || (block.status !== "completed" && block.status !== "error")) && (
            <View style={styles.toolCall}>
              <ScrollView style={styles.toolScroll} nestedScrollEnabled>
                <Text selectable style={styles.toolArgs}>{block.arguments || "(no input provided)"}</Text>
              </ScrollView>
            </View>
          )}
          <View style={[styles.toolResult, block.isError && styles.toolResultError]}>
            <Text style={[styles.toolResultLabel, block.isError && styles.toolResultLabelError]}>Result</Text>
            <ScrollView style={styles.toolScroll} nestedScrollEnabled>
              <Text selectable style={[styles.toolResultContent, block.isError && styles.toolResultContentError]}>
                {block.result === null ? block.status === "running" ? "Running…" : "Waiting for result…" : block.result}
              </Text>
            </ScrollView>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export function ErrorBlockView({ source, message }: { source: string; message: string }) {
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorLabel}>{source.toUpperCase()}</Text>
      <Text selectable style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  rowEnd: { justifyContent: "flex-end" },
  rowStart: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fullWidthBubble: { maxWidth: "100%" },
  userBubble: {
    backgroundColor: tokens.colors.interactiveAccent,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 16,
  },
  agentBubble: {
    backgroundColor: tokens.colors.interactiveAccent,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
  },
  thinkingBubble: {
    maxWidth: "85%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(90, 62, 141, 0.95)",
    opacity: 0.78,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
  },
  thinkingToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  thinkingLabel: {
    color: tokens.colors.textOnAccent,
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  thinkingPreview: {
    color: tokens.colors.textOnAccent,
    fontStyle: "italic",
    fontSize: 11.5,
    lineHeight: 16,
  },
  thinkingContentScroll: {
    maxHeight: 72,
  },
  chevron: { color: tokens.colors.textMuted, fontSize: tokens.fontSizes.caption2 },
  streamingCursor: { color: tokens.colors.textOnAccent },
  cursor: {
    width: 6,
    height: 14,
    backgroundColor: tokens.colors.textOnAccent,
    borderRadius: 3,
    marginTop: 4,
    opacity: 0.9,
  },
  cursorDark: {
    width: 6,
    height: 12,
    backgroundColor: tokens.colors.textMuted,
    borderRadius: 3,
    opacity: 0.7,
  },
  toolCard: {
    alignSelf: "flex-start",
    maxWidth: "90%",
    borderWidth: 1,
    borderColor: tokens.colors.modifierBorder,
    borderRadius: 8,
    overflow: "hidden",
  },
  toolCardPressed: { opacity: 0.94 },
  toolHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: tokens.colors.modifierHover,
  },
  toolLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: tokens.colors.textMuted,
  },
  toolName: {
    fontFamily: tokens.fonts.mono,
    fontWeight: "600",
    color: tokens.colors.textNormal,
    flex: 1,
    fontSize: 12,
  },
  toolStatus: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    color: tokens.colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  toolStatusRunning: { color: "#f8d477" },
  toolStatusDone: { color: "#9ff0b4" },
  toolStatusError: { color: tokens.colors.textError },
  toolBody: { borderTopWidth: 1, borderTopColor: tokens.colors.modifierBorder },
  toolCall: { backgroundColor: tokens.colors.backgroundSecondary },
  toolScroll: { maxHeight: 72 },
  toolArgs: {
    margin: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: tokens.fonts.mono,
    fontSize: 11.5,
    color: tokens.colors.textNormal,
  },
  toolResult: {
    backgroundColor: tokens.colors.backgroundPrimary,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.modifierBorder,
  },
  toolResultError: {},
  toolResultLabel: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: tokens.colors.textMuted,
    backgroundColor: tokens.colors.modifierHover,
  },
  toolResultLabelError: { color: tokens.colors.textError },
  toolResultContent: {
    margin: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: tokens.fonts.mono,
    fontSize: 11.5,
    color: tokens.colors.textNormal,
  },
  toolResultContentError: { color: tokens.colors.textError },
  errorCard: {
    borderWidth: 1,
    borderColor: tokens.colors.dangerBorder,
    backgroundColor: tokens.colors.dangerBg,
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.md,
    gap: tokens.spacing.xxs,
    maxWidth: "85%",
  },
  errorLabel: {
    color: tokens.colors.textError,
    fontWeight: "700",
    fontSize: tokens.fontSizes.caption,
    letterSpacing: 0.5,
  },
  errorText: { color: tokens.colors.textNormal, fontSize: tokens.fontSizes.bodySm },
});
