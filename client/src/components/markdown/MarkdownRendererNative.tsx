import { Text } from "react-native";
import { tokens } from "../../theme";
import type { MarkdownTextProps } from "../Markdown";

export function MarkdownRendererNative({ text, color, selectable }: MarkdownTextProps) {
  return (
    <Text selectable={selectable} style={{ color, fontSize: tokens.fontSizes.bodySm, lineHeight: 20 }}>
      {text}
    </Text>
  );
}
