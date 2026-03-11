// src/screens/GameResultsDetailScreen.tsx – Detailed results when a game ends with rewards

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "GameResultsDetail">;

export default function GameResultsDetailScreen({ navigation, route }: Props) {
  const params = route.params;
  if (!params?.playerNames?.length || params.winnerIndex == null || params.winnerIndex < 0 || !params?.payload) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Results</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.reset({ index: 0, routes: [{ name: "Lobby" }] })}>
          <Text style={styles.backBtnText}>‹ Back to Lobby</Text>
        </Pressable>
      </View>
    );
  }
  const { gameTitle, playerNames, winnerIndex, payload } = params;
  const winnerName = winnerIndex >= 0 && winnerIndex < playerNames.length ? playerNames[winnerIndex] : "—";
  const { width } = Dimensions.get("window");
  const isLarge = width >= 600;

  const renderMatchBreakdown = () => {
    if (payload.gameType !== "match") return null;
    const { tokens, events } = payload;
    const hasEvents = events && events.length > 0;
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Reward breakdown</Text>
        {playerNames.map((name, idx) => (
          <View key={idx} style={[styles.playerBlock, idx === winnerIndex && styles.playerBlockWinner]}>
            <View style={styles.playerRow}>
              <Text style={[styles.playerName, isLarge && stylesL.playerName]}>{name}</Text>
              <Text style={[styles.resultBadge, idx === winnerIndex ? styles.resultWin : styles.resultLoss]}>
                {idx === winnerIndex ? "Win" : "Loss"}
              </Text>
            </View>
            {hasEvents && (
              <View style={styles.eventsList}>
                {events
                  .filter((e) => e.playerIndex === idx)
                  .map((e, i) => (
                    <Text key={i} style={[styles.eventRow, isLarge && stylesL.eventRow]}>
                      {e.label}: {e.amount >= 0 ? "+" : ""}{e.amount}
                    </Text>
                  ))}
              </View>
            )}
            <Text style={[styles.totalRow, isLarge && stylesL.totalRow]}>
              Total rewards: {tokens[idx] >= 0 ? "+" : ""}{tokens[idx]}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderCricketBreakdown = () => {
    if (payload.gameType !== "cricket") return null;
    const { sideGameTotals, events } = payload;
    const hasEvents = events && events.length > 0;
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Side game rewards</Text>
        {playerNames.map((name, idx) => (
          <View key={idx} style={[styles.playerBlock, idx === winnerIndex && styles.playerBlockWinner]}>
            <View style={styles.playerRow}>
              <Text style={[styles.playerName, isLarge && stylesL.playerName]}>{name}</Text>
              <Text style={[styles.resultBadge, idx === winnerIndex ? styles.resultWin : styles.resultLoss]}>
                {idx === winnerIndex ? "Win" : "Loss"}
              </Text>
            </View>
            {hasEvents && (
              <View style={styles.eventsList}>
                {events
                  .filter((e) => e.playerIndex === idx)
                  .map((e, i) => (
                    <Text key={i} style={[styles.eventRow, isLarge && stylesL.eventRow]}>
                      {e.label}: {e.amount >= 0 ? "+" : ""}{e.amount}
                    </Text>
                  ))}
              </View>
            )}
            <Text style={[styles.totalRow, isLarge && stylesL.totalRow]}>
              Side game total: {sideGameTotals[idx] >= 0 ? "+" : ""}{sideGameTotals[idx]}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderKillerBreakdown = () => {
    if (payload.gameType !== "killer") return null;
    const { playerResults } = payload;
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Placement & rewards</Text>
        {playerResults.map((p, idx) => (
          <View key={idx} style={[styles.playerBlock, p.place === 1 && styles.playerBlockWinner]}>
            <View style={styles.playerRow}>
              <Text style={[styles.playerName, isLarge && stylesL.playerName]}>{p.name}</Text>
              <Text style={[styles.resultBadge, p.place === 1 ? styles.resultWin : styles.resultLoss]}>
                {p.place === 1 ? "Win" : `Place ${p.place}`}
              </Text>
            </View>
            <View style={styles.breakdownRows}>
              <Text style={[styles.breakdownRow, isLarge && stylesL.breakdownRow]}>
                Placement reward: {p.placementReward >= 0 ? "+" : ""}{p.placementReward}
              </Text>
              <Text style={[styles.breakdownRow, isLarge && stylesL.breakdownRow]}>
                Kill rewards: {p.killRewardsBalance >= 0 ? "+" : ""}{p.killRewardsBalance}
              </Text>
            </View>
            <Text style={[styles.totalRow, isLarge && stylesL.totalRow]}>
              Total rewards: {p.totalRewards >= 0 ? "+" : ""}{p.totalRewards}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.title, isLarge && stylesL.title]}>{gameTitle} – Results</Text>
      <View style={[styles.winnerCard, isLarge && stylesL.winnerCard]}>
        <Text style={[styles.winnerLabel, isLarge && stylesL.winnerLabel]}>Winner</Text>
        <Text style={[styles.winnerName, isLarge && stylesL.winnerName]}>{winnerName}</Text>
      </View>

      {payload.gameType === "match" && renderMatchBreakdown()}
      {payload.gameType === "cricket" && renderCricketBreakdown()}
      {payload.gameType === "killer" && renderKillerBreakdown()}

      <Pressable style={[styles.backBtn, isLarge && stylesL.backBtn]} onPress={() => navigation.reset({ index: 0, routes: [{ name: "Lobby" }] })}>
        <Text style={[styles.backBtnText, isLarge && stylesL.backBtnText]}>‹ Back to Lobby</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  title: { fontSize: 22, fontWeight: "900", color: "#111827" },
  winnerCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  winnerLabel: { fontSize: 12, fontWeight: "700", color: "#065F46", marginBottom: 4 },
  winnerName: { fontSize: 20, fontWeight: "900", color: "#047857" },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: "#374151" },
  playerBlock: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  playerBlockWinner: { backgroundColor: "#D1FAE5", borderColor: "#A7F3D0" },
  playerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  playerName: { fontSize: 16, fontWeight: "800", color: "#111827" },
  resultBadge: { fontSize: 14, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  resultWin: { backgroundColor: "#059669", color: "#FFFFFF" },
  resultLoss: { backgroundColor: "#6B7280", color: "#FFFFFF" },
  eventsList: { marginBottom: 6, paddingLeft: 8, gap: 2 },
  eventRow: { fontSize: 14, color: "#4B5563" },
  breakdownRows: { marginBottom: 6, paddingLeft: 8, gap: 2 },
  breakdownRow: { fontSize: 14, color: "#4B5563" },
  totalRow: { fontSize: 15, fontWeight: "800", color: "#111827", marginTop: 4 },
  backBtn: { alignSelf: "flex-start", paddingVertical: 12, paddingHorizontal: 16 },
  backBtnText: { fontSize: 16, fontWeight: "800", color: "#2563EB" },
});

const stylesL = StyleSheet.create({
  title: { fontSize: 26 },
  winnerCard: { padding: 20 },
  winnerLabel: { fontSize: 14 },
  winnerName: { fontSize: 24 },
  sectionTitle: { fontSize: 18 },
  playerName: { fontSize: 18 },
  eventRow: { fontSize: 15 },
  breakdownRow: { fontSize: 15 },
  totalRow: { fontSize: 16 },
  backBtn: {},
  backBtnText: { fontSize: 18 },
});
