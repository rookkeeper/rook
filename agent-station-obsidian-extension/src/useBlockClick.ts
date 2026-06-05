import { App } from "obsidian";
import { Block } from "./types";
import { openBlockModal } from "./BlockModal";

/**
 * Returns an onClick handler that opens the block modal,
 * but only if the user has not made a text selection (i.e. is not
 * in the middle of or just finished a drag-to-select).
 */
export function useBlockClick(app: App, block: Block) {
  return (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    openBlockModal(app, block);
  };
}
