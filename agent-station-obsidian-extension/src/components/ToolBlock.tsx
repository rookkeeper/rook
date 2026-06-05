import React, { useState } from "react";
import { ToolBlock as ToolBlockType } from "../types";
import { useApp } from "../context";
import { useBlockClick } from "../useBlockClick";

interface Props {
  block: ToolBlockType;
  forceExpanded?: boolean;
}

export function ToolBlock({ block, forceExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const app = useApp();
  const handleClick = useBlockClick(app, block);

  const openModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleClick(e);
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  };

  return (
    <div className="cwa-tool-block" onClick={openModal} title="Click to expand">
      {/* Header — always visible */}
      <div className="cwa-tool-block__call-header" onClick={toggle}>
        <span className="cwa-tool-block__call-label">Tool</span>
        <span className="cwa-tool-block__call-name">{block.name}</span>
        {block.argumentsStreaming && <span className="cwa-cursor cwa-cursor--dark" />}
        <span className="cwa-tool-block__chevron">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="cwa-tool-block__body">
          <div className="cwa-tool-block__call">
            <pre className="cwa-tool-block__args">{block.arguments}</pre>
          </div>
          <div className={`cwa-tool-block__result${block.isError ? " cwa-tool-block__result--error" : ""}`}>
            <div className="cwa-tool-block__result-label">Result</div>
            <pre className="cwa-tool-block__result-content">
              {block.result === null ? "Waiting for result…" : block.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
