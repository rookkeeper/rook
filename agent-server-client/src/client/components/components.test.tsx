import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "../types";
import { AgentTextBlock } from "./AgentTextBlock";
import { BlockModal } from "./BlockModal";
import { ComposeBox } from "./ComposeBox";
import { ErrorBlock } from "./ErrorBlock";
import { MessageThread } from "./MessageThread";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";
import { UserMessageBlock } from "./UserMessageBlock";

describe("chat block components", () => {
  it("renders user and assistant markdown blocks", () => {
    render(
      <>
        <UserMessageBlock block={{ type: "text", role: "user", text: "**Hello** [example](https://example.com)", isStreaming: false }} />
        <AgentTextBlock block={{ type: "text", role: "assistant", text: "- item", isStreaming: true }} />
      </>
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("item")).toBeInTheDocument();
    expect(document.querySelector(".cwa-cursor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example" })).toHaveAttribute("target", "_blank");
  });

  it("renders thinking, tool, and error blocks", async () => {
    render(
      <>
        <ThinkingBlock block={{ type: "thinking", thinking: "working", isStreaming: false }} />
        <ToolBlock
          block={{
            type: "toolBlock",
            id: "tool-1",
            name: "read",
            status: "completed",
            arguments: '{"path":"README.md"}',
            argumentsStreaming: false,
            result: "contents",
            isError: false,
          }}
        />
        <ErrorBlock block={{ type: "error", source: "run", message: "Boom" }} />
      </>
    );

    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    await userEvent.click(screen.getByText("read"));
    expect(screen.getByText('{"path":"README.md"}')).toBeInTheDocument();
    expect(screen.getByText("contents")).toBeInTheDocument();
    expect(screen.getByText("run error")).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
  });

  it("MessageThread renders empty state and block types", () => {
    const onOpenBlock = vi.fn();
    const { rerender } = render(<MessageThread blocks={[]} isStreaming={false} onOpenBlock={onOpenBlock} />);
    expect(screen.getByText("No messages yet.")).toBeInTheDocument();

    const blocks: Block[] = [
      { type: "text", role: "user", text: "question", isStreaming: false },
      { type: "text", role: "assistant", text: "answer", isStreaming: false },
      { type: "thinking", thinking: "thought", isStreaming: false },
      { type: "error", source: "protocol", message: "bad event" },
    ];
    rerender(<MessageThread blocks={blocks} isStreaming={false} onOpenBlock={onOpenBlock} />);

    expect(screen.getByText("question")).toBeInTheDocument();
    expect(screen.getByText("answer")).toBeInTheDocument();
    expect(screen.getByText("thought")).toBeInTheDocument();
    expect(screen.getByText("bad event")).toBeInTheDocument();
  });
});

describe("ComposeBox", () => {
  it("submits trimmed text and clears the textarea", async () => {
    const onSubmit = vi.fn();
    render(<ComposeBox onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(textarea, "  hello  ");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(textarea).toHaveValue("");
  });

  it("does not submit blank or disabled input", async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<ComposeBox onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    rerender(<ComposeBox onSubmit={onSubmit} disabled />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows queueing affordance while the agent is busy", () => {
    render(<ComposeBox onSubmit={vi.fn()} isQueueing />);

    expect(screen.getByPlaceholderText("Agent is busy — message will be queued...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue" })).toBeInTheDocument();
  });
});

describe("BlockModal", () => {
  it("renders nothing without a selected block", () => {
    const { container } = render(<BlockModal block={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders selected block and closes from close button/backdrop", async () => {
    const onClose = vi.fn();
    render(<BlockModal block={{ type: "text", role: "user", text: "selected", isStreaming: false }} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Expanded chat block" })).toBeInTheDocument();
    expect(screen.getByText("selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close expanded block" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
