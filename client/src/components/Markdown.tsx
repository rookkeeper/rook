import { Platform } from "react-native";
import { tokens } from "../theme";
import { MarkdownRendererNative } from "./markdown/MarkdownRendererNative";
import { MarkdownRendererWeb } from "./markdown/MarkdownRendererWeb";

export interface MarkdownTextProps {
  text: string;
  color: string;
  selectable: boolean;
}

export function MarkdownText({
  children: text,
  color = tokens.colors.textNormal,
  selectable = false,
}: {
  children: string;
  color?: string;
  selectable?: boolean;
}) {
  if (!text) return null;

  const props: MarkdownTextProps = { text, color, selectable };
  return Platform.OS === "web"
    ? <MarkdownRendererWeb {...props} />
    : <MarkdownRendererNative {...props} />;
}
