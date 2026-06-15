import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { MarkdownText } from "../Markdown";
import { tokens } from "../../theme";
import { blockStyles as styles } from "./blockStyles";

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
