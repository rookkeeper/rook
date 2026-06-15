import { View, Text } from "react-native";
import { blockStyles as styles } from "./blockStyles";

export function ErrorBlockView({ source, message }: { source: string; message: string }) {
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorLabel}>{source.toUpperCase()}</Text>
      <Text selectable style={styles.errorText}>{message}</Text>
    </View>
  );
}
