import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { UserMessageBlock as UserMessageBlockType } from "../types";
import { useApp } from "../context";
import { useBlockClick } from "../useBlockClick";

interface Props {
  block: UserMessageBlockType;
}

export function UserMessageBlock({ block }: Props) {
  const app = useApp();
  const handleClick = useBlockClick(app, block);

  return (
    <div className="cwa-user-message" onClick={handleClick} title="Click to expand">
      <div className="cwa-user-message__content">
        <Markdown remarkPlugins={[remarkGfm]}>{block.text}</Markdown>
      </div>
    </div>
  );
}
