// src/components/CricketScoreboard.tsx
import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import type { CricketTarget } from "../engine/cricketEngine";

function labelForTarget(t: CricketTarget) {
  if (t === "BULL") return "BULL";
  if (t === "D") return "DOUBLE";
  if (t === "T") return "TREBLE";
  return String(t);
}

function markSymbol(m: number) {
  if (m <= 0) return "";
  if (m === 1) return "/";
  if (m === 2) return "X";
  return "Ⓧ"; // ✅ 3+ = circled X
}

function sortTargetsCricket(targets: CricketTarget[]) {
  const nums = targets.filter((t): t is number => typeof t === "number");
  const hasD = targets.includes("D");
  const hasT = targets.includes("T");
  const hasB = targets.includes("BULL");

  nums.sort((a, b) => b - a); // 20 downwards

  const out: CricketTarget[] = [...nums];
  if (hasD) out.push("D");
  if (hasT) out.push("T");
  if (hasB) out.push("BULL");
  return out;
}

export default function CricketScoreboard(props: {
  players: string[];
  targets: CricketTarget[];
  marks: number[][];
  scores: number[];
  currentPlayerIdx: number;
  targetIndexOf: (t: CricketTarget) => number;

  cornerWidth?: number;
  colWidth?: number;
  rowHeight?: number;
}) {
  const {
    players,
    targets,
    marks,
    scores,
    currentPlayerIdx,
    targetIndexOf,
    cornerWidth = 92,
    colWidth = 110,
    rowHeight = 48,
  } = props;

  const orderedTargets = useMemo(() => sortTargetsCricket(targets), [targets]);

  // ✅ scale text with rowHeight (keeps it readable on big layouts)
  const headerFont = Math.max(14, Math.floor(rowHeight * 0.34));
  const targetFont = Math.max(14, Math.floor(rowHeight * 0.34));
  const scoreFont = Math.max(16, Math.floor(rowHeight * 0.42));
  const markFont = Math.max(18, Math.floor(rowHeight * 0.52));

  return (
    <View style={styles.wrap}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Header row */}
            <View style={[styles.row, styles.headerRow, { height: rowHeight }]}>
              <View style={[styles.cornerCell, styles.headerCell, { width: cornerWidth, height: rowHeight }]}>
                <Text style={[styles.headerText, { fontSize: headerFont }]}>Target</Text>
              </View>

              {players.map((p, idx) => {
                const active = idx === currentPlayerIdx;
                return (
                  <View
                    key={p + idx}
                    style={[
                      styles.playerHeaderCell,
                      styles.headerCell,
                      { width: colWidth, height: rowHeight },
                      active && styles.activeHeader,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.playerHeaderText,
                        { fontSize: headerFont },
                        active && styles.activeText,
                      ]}
                    >
                      {p}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Score row */}
            <View style={[styles.row, { height: rowHeight }]}>
              <View style={[styles.cornerCell, { width: cornerWidth, height: rowHeight }]}>
                <Text style={[styles.cornerLabel, { fontSize: targetFont }]}>Score</Text>
              </View>

              {players.map((_, pIdx) => {
                const active = pIdx === currentPlayerIdx;
                return (
                  <View
                    key={`score-${pIdx}`}
                    style={[
                      styles.playerCell,
                      { width: colWidth, height: rowHeight },
                      active && styles.activeCol,
                      active && styles.activeBorder,
                    ]}
                  >
                    <Text style={[styles.scoreText, { fontSize: scoreFont }]}>
                      {String(scores[pIdx] ?? 0)}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Target rows */}
            {orderedTargets.map((t) => {
              const ti = targetIndexOf(t);
              return (
                <View key={String(t)} style={[styles.row, { height: rowHeight }]}>
                  <View style={[styles.cornerCell, { width: cornerWidth, height: rowHeight }]}>
                    <Text style={[styles.targetText, { fontSize: targetFont }]}>
                      {labelForTarget(t)}
                    </Text>
                  </View>

                  {players.map((_, pIdx) => {
                    const m = marks[pIdx]?.[ti] ?? 0;
                    const active = pIdx === currentPlayerIdx;

                    return (
                      <View
                        key={`${String(t)}-${pIdx}`}
                        style={[
                          styles.playerCell,
                          { width: colWidth, height: rowHeight },
                          active && styles.activeCol,
                          active && styles.activeBorder,
                        ]}
                      >
                        <Text style={[styles.markText, { fontSize: markFont }]}>
                          {markSymbol(m)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "white",
  },

  row: {
    flexDirection: "row",
    alignItems: "stretch",
  },

  headerRow: {
    backgroundColor: "#F3F4F6",
  },

  headerCell: {
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },

  cornerCell: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "center",
  },

  playerHeaderCell: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "center",
  },

  playerCell: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "center",
    alignItems: "center",
  },

  headerText: { fontWeight: "900", opacity: 0.8 },
  playerHeaderText: { fontWeight: "900" },

  // ✅ stronger active signal
  activeHeader: {
    backgroundColor: "#DBEAFE",
    borderBottomColor: "#60A5FA",
    borderBottomWidth: 2,
  },
  activeCol: { backgroundColor: "#EFF6FF" },
  activeBorder: {
    borderLeftWidth: 2,
    borderLeftColor: "#3B82F6",
    borderRightWidth: 2,
    borderRightColor: "#3B82F6",
  },
  activeText: { color: "#1D4ED8" },

  cornerLabel: { fontWeight: "900", opacity: 0.7 },
  targetText: { fontWeight: "900" },

  scoreText: { fontWeight: "900" },
  markText: { fontWeight: "900" },
});
