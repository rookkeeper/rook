import { useState } from "react";
import { ToolBlock as ToolBlockType, Block } from "../types";
import { createBlockClickHandler } from "../useBlockClick";

interface Props {
  block: ToolBlockType;
  forceExpanded?: boolean;
  onOpenBlock?: (block: Block) => void;
}

const STATUS_LABELS: Record<ToolBlockType["status"], string> = {
  input_streaming: "Preparing",
  ready: "Ready",
  running: "Running",
  completed: "Completed",
  error: "Failed",
};

export function ToolBlock({ block, forceExpanded = false, onOpenBlock }: Props) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const openBlock = createBlockClickHandler(block, onOpenBlock);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div className="cwa-tool-block" onClick={openBlock} title="Click to expand">
      <div className="cwa-tool-block__call-header" onClick={toggle}>
        <span className="cwa-tool-block__call-label">Tool</span>
        <span className="cwa-tool-block__call-name">{block.name}</span>
        <span className={`cwa-tool-block__status cwa-tool-block__status--${block.status}`}>{STATUS_LABELS[block.status]}</span>
        {(block.argumentsStreaming || block.status === "running") && <span className="cwa-cursor cwa-cursor--dark" />}
        <span className="cwa-tool-block__chevron">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="cwa-tool-block__body">
          {(block.arguments.length > 0 || (block.status !== "completed" && block.status !== "error")) && (
            <div className="cwa-tool-block__call">
              <pre className="cwa-tool-block__args">{block.arguments || "(no input provided)"}</pre>
            </div>
          )}
          <div className={`cwa-tool-block__result${block.isError ? " cwa-tool-block__result--error" : ""}`}>
            <div className="cwa-tool-block__result-label">Result</div>
            <pre className="cwa-tool-block__result-content">
              {block.result === null ? block.status === "running" ? "Running…" : "Waiting for result…" : block.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
