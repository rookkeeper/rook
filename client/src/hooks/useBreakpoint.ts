import { useWindowDimensions } from "react-native";

export type Breakpoint = "compact" | "expanded";

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return width < 768 ? "compact" : "expanded";
}
