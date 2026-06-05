import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingBlock as ThinkingBlockType } from "../types";
import { useApp } from "../context";
import { useBlockClick } from "../useBlockClick";

interface Props {
  block: ThinkingBlockType;
}

export function ThinkingBlock({ block }: Props) {
  const app = useApp();
  const handleClick = useBlockClick(app, block);

  return (
    <div className="cwa-thinking" onClick={handleClick} title="Click to expand">
      <div className="cwa-thinking__label">Thinking…</div>
      <div className="cwa-thinking__content">
        <Markdown remarkPlugins={[remarkGfm]}>{block.thinking}</Markdown>
        {block.isStreaming && <span className="cwa-cursor" />}
      </div>
    </div>
  );
}
