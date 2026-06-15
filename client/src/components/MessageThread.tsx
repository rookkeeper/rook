import { useRef, useEffect } from "react";
import { ScrollView, View, Text, StyleSheet } from "react-native";
import type { Block } from "../lib/types";
import { tokens } from "../theme";
import { UserMessageBlock, AgentTextBlock, ThinkingBlock, ToolBlockView, ErrorBlockView } from "./MessageBlocks";

interface Props {
  blocks: Block[];
  isStreaming: boolean;
  onOpenBlock?: (block: Block) => void;
  emptyTitle?: string;
  emptyText?: string;
}

export function MessageThread({ blocks, isStreaming, onOpenBlock, emptyTitle, emptyText }: Props) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [blocks]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.thread}
      contentContainerStyle={styles.content}
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
    >
      {blocks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{emptyTitle ?? "Say something to your agent"}</Text>
          <Text style={styles.emptySub}>{emptyText ?? "Streaming messages, thinking, and tool activity will appear here."}</Text>
        </View>
      ) : (
        blocks.map((block, index) => {
          const key = `${block.type}-${index}`;
          switch (block.type) {
            case "text":
              if (block.role === "user") return <UserMessageBlock key={key} text={block.text} />;
              return <AgentTextBlock key={key} text={block.text} isStreaming={block.isStreaming} />;
            case "thinking":
              return <ThinkingBlock key={key} thinking={block.thinking} isStreaming={block.isStreaming} />;
            case "toolBlock":
              return <ToolBlockView key={key} block={block} onClick={onOpenBlock ? () => onOpenBlock(block) : undefined} />;
            case "error":
              return <ErrorBlockView key={key} source={block.source} message={block.message} />;
            default:
              return null;
          }
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
    paddingBottom: tokens.spacing.md,
  },
  empty: {
    flex: 1,
    minHeight: 0,
    justifyContent: "center",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  emptyTitle: {
    color: tokens.colors.textNormal,
    fontSize: tokens.fontSizes.subheading,
    fontWeight: "600",
  },
  emptySub: {
    color: tokens.colors.textMuted,
    fontSize: tokens.fontSizes.bodySm,
    textAlign: "center",
  },
});
