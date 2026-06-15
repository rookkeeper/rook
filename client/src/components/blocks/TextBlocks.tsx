import { View, Text } from "react-native";
import { MarkdownText } from "../Markdown";
import { tokens } from "../../theme";
import { blockStyles as styles } from "./blockStyles";

function MarkdownContent({ text, streaming, color = tokens.colors.textOnAccent }: { text: string; streaming?: boolean; color?: string }) {
  if (!text && streaming) return <Text style={[styles.streamingCursor, { color }]}>…</Text>;
  if (!text) return null;
  return <MarkdownText color={color} selectable>{text}</MarkdownText>;
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
