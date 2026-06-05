import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentTextBlock as AgentTextBlockType } from "../types";
import { useApp } from "../context";
import { useBlockClick } from "../useBlockClick";

interface Props {
  block: AgentTextBlockType;
}

export function AgentTextBlock({ block }: Props) {
  const app = useApp();
  const handleClick = useBlockClick(app, block);

  return (
    <div className="cwa-agent-text" onClick={handleClick} title="Click to expand">
      <div className="cwa-agent-text__content">
        <Markdown remarkPlugins={[remarkGfm]}>{block.text}</Markdown>
        {block.isStreaming && <span className="cwa-cursor" />}
      </div>
    </div>
  );
}
