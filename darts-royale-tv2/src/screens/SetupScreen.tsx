// src/screens/SetupScreen.tsx
import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Dimensions } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Setup">;

export default function SetupScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  return (
    <ScrollView contentContainerStyle={[styles.container, isLarge && stylesL.container]}>
      <Text style={[styles.title, isLarge && stylesL.title]}>Game Setup</Text>
      <Text style={[styles.sub, isLarge && stylesL.sub]}>
        Manual test app • 2–8 players • no teams
      </Text>

      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Choose a mode</Text>

        <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={() => navigation.navigate("MatchSetup")}>
          <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Match</Text>
        </Pressable>

        <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={() => navigation.navigate("GolfSetup")}>
          <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Golf</Text>
        </Pressable>

        <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={() => navigation.navigate("CricketSetup")}>
          <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Cricket</Text>
        </Pressable>

        <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={() => navigation.navigate("KillerSetup")}>
          <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Killer</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "900" },
  sub: { fontSize: 12, opacity: 0.65, marginTop: -6 },

  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", marginTop: 2 },

  primary: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },
});

const stylesL = StyleSheet.create({
  container: { padding: 22, gap: 14 },
  title: { fontSize: 30 },
  sub: { fontSize: 15, marginTop: -4 },

  card: { padding: 18, borderRadius: 16, gap: 12 },
  sectionTitle: { fontSize: 22, fontWeight: "900", marginTop: 2 },

  primary: { paddingVertical: 18, borderRadius: 14 },
  primaryText: { fontSize: 18 },
});
