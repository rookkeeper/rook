import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentTextBlock as AgentTextBlockType, Block } from "../types";
import { createBlockClickHandler } from "../useBlockClick";

interface Props {
  block: AgentTextBlockType;
  onOpenBlock?: (block: Block) => void;
}

export function AgentTextBlock({ block, onOpenBlock }: Props) {
  return (
    <div className="cwa-agent-text" onClick={createBlockClickHandler(block, onOpenBlock)} title="Click to expand">
      <div className="cwa-agent-text__content">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {block.text}
        </Markdown>
        {block.isStreaming && <span className="cwa-cursor" />}
      </div>
    </div>
  );
}
