import { describe, expect, it, vi } from "vitest";
import type { Block } from "./types";
import { createBlockClickHandler } from "./useBlockClick";

const block: Block = { type: "text", role: "user", text: "hello", isStreaming: false };

describe("createBlockClickHandler", () => {
  it("opens a block when there is no text selection", () => {
    const onOpenBlock = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as Selection);

    createBlockClickHandler(block, onOpenBlock)({} as never);

    expect(onOpenBlock).toHaveBeenCalledWith(block);
  });

  it("does not open a block while text is selected", () => {
    const onOpenBlock = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "selected" } as Selection);

    createBlockClickHandler(block, onOpenBlock)({} as never);

    expect(onOpenBlock).not.toHaveBeenCalled();
  });

  it("does not open a block when clicking an interactive element", () => {
    const onOpenBlock = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as Selection);

    const anchor = document.createElement("a");
    document.body.appendChild(anchor);

    createBlockClickHandler(block, onOpenBlock)({ target: anchor } as never);

    expect(onOpenBlock).not.toHaveBeenCalled();
  });
});
