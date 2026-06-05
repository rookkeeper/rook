import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingBlock as ThinkingBlockType, Block } from "../types";
import { createBlockClickHandler } from "../useBlockClick";

interface Props {
  block: ThinkingBlockType;
  onOpenBlock?: (block: Block) => void;
}

export function ThinkingBlock({ block, onOpenBlock }: Props) {
  return (
    <div className="cwa-thinking" onClick={createBlockClickHandler(block, onOpenBlock)} title="Click to expand">
      <div className="cwa-thinking__label">Thinking…</div>
      <div className="cwa-thinking__content">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {block.thinking}
        </Markdown>
        {block.isStreaming && <span className="cwa-cursor" />}
      </div>
    </div>
  );
}
