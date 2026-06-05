import React, { useEffect, useRef } from "react";
import { Block } from "../types";
import { UserMessageBlock } from "./UserMessageBlock";
import { AgentTextBlock } from "./AgentTextBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";

interface Props {
  blocks: Block[];
  isStreaming: boolean;
}

export function MessageThread({ blocks, isStreaming }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userHasScrolled = useRef(false);

  useEffect(() => {
    if (isStreaming) userHasScrolled.current = false;
  }, [isStreaming]);

  useEffect(() => {
    if (!userHasScrolled.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [blocks]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) {
      userHasScrolled.current = true;
    }
  };

  return (
    <div ref={containerRef} className="cwa-thread" onScroll={onScroll}>
      {blocks.length === 0 && <p className="cwa-thread__empty">No messages yet.</p>}
      {blocks.map((block, i) => {
        if (block.type === "text" && block.role === "user")      return <UserMessageBlock key={i} block={block} />;
        if (block.type === "text" && block.role === "assistant") return <AgentTextBlock   key={i} block={block} />;
        if (block.type === "thinking")                           return <ThinkingBlock    key={i} block={block} />;
        if (block.type === "toolBlock")                          return <ToolBlock        key={i} block={block} />;
        return null;
      })}
    </div>
  );
}
