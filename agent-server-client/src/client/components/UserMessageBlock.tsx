import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { UserMessageBlock as UserMessageBlockType, Block } from "../types";
import { createBlockClickHandler } from "../useBlockClick";

interface Props {
  block: UserMessageBlockType;
  onOpenBlock?: (block: Block) => void;
}

export function UserMessageBlock({ block, onOpenBlock }: Props) {
  return (
    <div className="cwa-user-message" onClick={createBlockClickHandler(block, onOpenBlock)} title="Click to expand">
      <div className="cwa-user-message__content">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {block.text}
        </Markdown>
      </div>
    </div>
  );
}
