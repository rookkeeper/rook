import type { MouseEvent } from "react";
import { Block } from "./types";

/**
 * Opens a block detail view unless the click is part of a text selection.
 */
export function createBlockClickHandler(block: Block, onOpenBlock?: (block: Block) => void) {
  return (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("a, button, input, textarea, select, summary, [role='button']")) return;

    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    onOpenBlock?.(block);
  };
}
