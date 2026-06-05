import { Block } from "../types";
import { UserMessageBlock } from "./UserMessageBlock";
import { AgentTextBlock } from "./AgentTextBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";
import { ErrorBlock } from "./ErrorBlock";

interface Props {
  block: Block | null;
  onClose: () => void;
}

function BlockContent({ block }: { block: Block }) {
  if (block.type === "text" && block.role === "user") return <UserMessageBlock block={block} />;
  if (block.type === "text" && block.role === "assistant") return <AgentTextBlock block={block} />;
  if (block.type === "thinking") return <ThinkingBlock block={block} />;
  if (block.type === "toolBlock") return <ToolBlock block={block} forceExpanded />;
  if (block.type === "error") return <ErrorBlock block={block} />;
  return null;
}

export function BlockModal({ block, onClose }: Props) {
  if (!block) return null;

  return (
    <div className="cwa-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="cwa-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Expanded chat block"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="cwa-modal-close" type="button" onClick={onClose} aria-label="Close expanded block">
          ×
        </button>
        <div className="cwa-modal">
          <BlockContent block={block} />
        </div>
      </div>
    </div>
  );
}
