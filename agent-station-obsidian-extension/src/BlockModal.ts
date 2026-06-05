import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { Block } from "./types";
import { AppContext } from "./context";
import { UserMessageBlock } from "./components/UserMessageBlock";
import { AgentTextBlock } from "./components/AgentTextBlock";
import { ThinkingBlock } from "./components/ThinkingBlock";
import { ToolBlock } from "./components/ToolBlock";

function BlockContent({ block }: { block: Block }) {
  if (block.type === "text" && block.role === "user")      return React.createElement(UserMessageBlock, { block });
  if (block.type === "text" && block.role === "assistant") return React.createElement(AgentTextBlock,   { block });
  if (block.type === "thinking")                           return React.createElement(ThinkingBlock,    { block });
  if (block.type === "toolBlock")                          return React.createElement(ToolBlock,        { block, forceExpanded: true });
  return null;
}

// Global flag — only one block modal open at a time
let modalIsOpen = false;

export function openBlockModal(app: App, block: Block) {
  if (modalIsOpen) return;
  new BlockModal(app, block).open();
}

class BlockModal extends Modal {
  private block: Block;
  private reactRoot: Root | null = null;

  constructor(app: App, block: Block) {
    super(app);
    this.block = block;
  }

  onOpen() {
    modalIsOpen = true;
    const { contentEl } = this;
    contentEl.addClass("cwa-modal");
    this.reactRoot = createRoot(contentEl);
    this.reactRoot.render(
      React.createElement(AppContext.Provider, { value: this.app },
        React.createElement(BlockContent, { block: this.block })
      )
    );
  }

  onClose() {
    modalIsOpen = false;
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
  }
}
