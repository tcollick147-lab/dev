import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Lobby">;

export default function LobbyScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Darts Royale</Text>
      <Text style={styles.subtitle}>
        MVP • Up to 6 or 8 players • No Teams
      </Text>

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate("MatchSetup")}
      >
        <Text style={styles.buttonText}>Start Match (X01)</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate("GolfSetup")}
      >
        <Text style={styles.buttonText}>Start Golf</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate("CricketSetup")}
      >
        <Text style={styles.buttonText}>Start Cricket</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate("KillerSetup")}
      >
        <Text style={styles.buttonText}>Start Killer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 12 },
  title: { fontSize: 32, fontWeight: "700" },
  subtitle: { fontSize: 14, opacity: 0.7, marginBottom: 14 },
  button: {
    backgroundColor: "#111827",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
