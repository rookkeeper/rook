import type { Block } from "../../lib/types";
import { AgentTextBlock, UserMessageBlock } from "./TextBlocks";
import { ThinkingBlock } from "./ThinkingBlockView";
import { ToolBlockView } from "./ToolBlockView";
import { ErrorBlockView } from "./ErrorBlockView";

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
