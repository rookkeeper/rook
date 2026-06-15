import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import type { Block } from "../../lib/types";
import { blockStyles as styles } from "./blockStyles";

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
