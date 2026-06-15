import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { tokens } from "../../theme";
import type { MarkdownTextProps } from "../Markdown";

export function MarkdownRendererWeb({ text, color }: MarkdownTextProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, color, fontSize: tokens.fontSizes.bodySm, lineHeight: "20px" }}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: tokens.colors.interactiveAccentHover }} />,
          p: ({ node: _node, ...props }) => <p {...props} style={{ margin: 0 }} />,
          pre: ({ node: _node, ...props }) => <pre {...props} style={{ margin: 0, background: tokens.colors.backgroundPrimary, borderRadius: 8, padding: 10, overflowX: "auto" }} />,
          code: ({ node: _node, className, children, ...props }) => {
            const isBlock = Boolean(className);
            if (isBlock) return <code {...props} className={className}>{children}</code>;
            return <code {...props} style={{ background: tokens.colors.skeleton, borderRadius: 4, padding: "1px 4px", fontFamily: tokens.fonts.mono }}>{children}</code>;
          },
          h1: ({ node: _node, ...props }) => <h1 {...props} style={{ margin: 0, fontSize: 28, lineHeight: "34px" }} />,
          h2: ({ node: _node, ...props }) => <h2 {...props} style={{ margin: 0, fontSize: 22, lineHeight: "28px" }} />,
          h3: ({ node: _node, ...props }) => <h3 {...props} style={{ margin: 0, fontSize: 18, lineHeight: "24px" }} />,
          ul: ({ node: _node, ...props }) => <ul {...props} style={{ margin: 0, paddingLeft: 20 }} />,
          ol: ({ node: _node, ...props }) => <ol {...props} style={{ margin: 0, paddingLeft: 20 }} />,
          blockquote: ({ node: _node, ...props }) => <blockquote {...props} style={{ margin: 0, paddingLeft: 12, borderLeft: `3px solid ${tokens.colors.modifierBorder}`, opacity: 0.95 }} />,
          hr: ({ node: _node, ...props }) => <hr {...props} style={{ width: "100%", border: 0, borderTop: `1px solid ${tokens.colors.modifierBorder}` }} />,
          table: ({ node: _node, ...props }) => <div style={{ overflowX: "auto" }}><table {...props} style={{ borderCollapse: "collapse", width: "100%" }} /></div>,
          th: ({ node: _node, ...props }) => <th {...props} style={{ border: `1px solid ${tokens.colors.modifierBorder}`, padding: "6px 8px", textAlign: "left", background: tokens.colors.modifierHover }} />,
          td: ({ node: _node, ...props }) => <td {...props} style={{ border: `1px solid ${tokens.colors.modifierBorder}`, padding: "6px 8px", verticalAlign: "top" }} />,
        }}
      >
        {text.trimEnd()}
      </Markdown>
    </div>
  );
}
