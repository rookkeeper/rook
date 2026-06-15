import { render, screen } from "@testing-library/react";
import { MarkdownText } from "./Markdown";

describe("MarkdownText", () => {
  it("renders headings, GFM tables, lists, and code via markdown libraries", () => {
    render(
      <MarkdownText>{`# Foo\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- item\n- [x] done\n\n\`inline\``}</MarkdownText>,
    );

    expect(screen.getByRole("heading", { name: "Foo" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("item")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText("inline")).toBeInTheDocument();
  });
});
