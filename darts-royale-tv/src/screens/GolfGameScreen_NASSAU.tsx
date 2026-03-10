// src/screens/GolfGameScreen.tsx

import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  SafeAreaView,
  Platform,
  Dimensions,
  Alert,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";

import Dartboard from "../components/Dartboard";
import {
  createGolfState,
  applyDart,
  acceptHole,
  noScore,
  undo,
  redo,
  evalDart,
  getCurrentHole,
  getPlayoffNeeds,
  getPlayoffOptions,
  setPlayoffOrder,
  setPlayoffModeTie,
  type GolfDart,
  type Hole,
  type PlayoffKind,
} from "../engine/golfEngine";

type Props = NativeStackScreenProps<RootStackParamList, "GolfGame">;
type Mode = "BOARD" | "LEADER";

function holeLabel(h: Hole | null) {
  if (h === null) return "—";
  return h === "BULL" ? "Bull" : String(h);
}

function scoreLabel(v: number) {
  if (v > 0) return `+${v}`;
  return `${v}`;
}

function resultWord(score: number) {
  switch (score) {
    case 2:
      return "No Score";
    case 1:
      return "Bogey";
    case 0:
      return "Par";
    case -1:
      return "Birdie";
    case -2:
      return "Eagle";
    default:
      return scoreLabel(score);
  }
}

function ord(i: number) {
  const n = i + 1;
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function fmtReward(v: number) {
  const n = Number.isFinite(v) ? v : 0;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function fmtSigned(n: number) {
  const v = Number(n) || 0;
  if (v === 0) return "Even";
  return v > 0 ? `+${v}` : `${v}`;
}

function fmtThresh(n: number) {
  const v = Number(n) || 0;
  return v > 0 ? `≤ +${v}` : `≤ ${v}`;
}

function isNassauRound(holes: Hole[]) {
  if (holes.length !== 19) return false;
  if (!holes.includes("BULL")) return false;
  for (let i = 1; i <= 18; i++) if (!holes.includes(i)) return false;
  return true;
}

function colorFor(n: number) {
  return n > 0 ? "#16a34a" : n < 0 ? "#dc2626" : "#64748b";
}

function holeIndexMap(holes: Hole[]) {
  const m = new Map<string, number>();
  holes.forEach((h, idx) => m.set(h === "BULL" ? "BULL" : String(h), idx));
  return m;
}

function legComplete(scoresByPlayer: (number | null)[][], idxs: number[]) {
  return scoresByPlayer.every((row) => idxs.every((i) => row[i] !== null));
}

function legTotals(scoresByPlayer: (number | null)[][], idxs: number[]) {
  return scoresByPlayer.map((row) => idxs.reduce((acc, i) => acc + (row[i] ?? 0), 0));
}

function leaderLabelForLeg(players: { name: string }[], totals: number[]) {
  if (!players.length || totals.length !== players.length) return "—";
  let best = Infinity;
  for (const t of totals) best = Math.min(best, t);

  const winners: number[] = [];
  totals.forEach((t, i) => {
    if (t === best) winners.push(i);
  });

  if (!winners.length) return "—";
  if (winners.length === 1) return players[winners[0]]?.name ?? "—";
  return `Tied: ${winners.map((i) => players[i]?.name ?? "?").join(", ")}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function totalUpTo(scores: (number | null)[], holeIdx: number) {
  let sum = 0;
  for (let i = 0; i <= holeIdx; i++) sum += scores[i] ?? 0;
  return sum;
}

function holeName(v: number) {
  // Only for the label next to the value (per your request)
  switch (v) {
    case 2:
      return "Double"; // instead of "No Score" here
    case 1:
      return "Bogey";
    case 0:
      return "Par";
    case -1:
      return "Birdie";
    case -2:
      return "Eagle";
    default:
      return v > 0 ? `+${v}` : `${v}`;
  }
}

function scoreNameForCell(score: number) {
  switch (score) {
    case 2:
      return "Double"; // instead of "No Score" in the cell UI
    case 1:
      return "Bogey";
    case 0:
      return "Par";
    case -1:
      return "Birdie";
    case -2:
      return "Eagle";
    default:
      return "";
  }
}

export default function GolfGameScreen({ route, navigation }: Props) {
  const { setup } = route.params;

  const cellMode: "HOLE" | "TOTAL" = setup.golf?.cellMode ?? "HOLE";

  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const base = Math.min(screenWidth, screenHeight);
  const isLarge = base >= 900;

  const ui = useMemo(() => {
    const sidePadding = isLarge ? 22 : 12;
    const gap = 10;
    const holeW = isLarge ? 110 : 72;

    // Always size as if 6 players so 2–3 players don't shrink the table
    const playerSlots = 6;

    const available = screenWidth - sidePadding * 2 - holeW - gap;
    const rawCellW = Math.floor(available / Math.max(1, playerSlots)) - gap;
    const cellW = Math.max(isLarge ? 110 : 96, Math.min(rawCellW, isLarge ? 170 : 130));

    // Fixed button width based on 5-button layout
    const btnGap = 12;
    const btnCountBase = 5;
    const btnRowW = screenWidth - sidePadding * 2;
    const btnW = Math.floor((btnRowW - btnGap * (btnCountBase - 1)) / btnCountBase);

    return {
      title: isLarge ? 30 : 22,
      sub: isLarge ? 20 : 16,

      boardSize: Math.min(
        screenWidth - 24,
        screenHeight - (isLarge ? 340 : 260),
        isLarge ? 950 : 520
      ),

      btnPadV: isLarge ? 16 : 12,
      btnText: isLarge ? 18 : 14,
      btnW,

      pillPadV: isLarge ? 12 : 9,
      pillPadH: isLarge ? 14 : 12,
      pillMinW: isLarge ? 170 : 120,
      pillText: isLarge ? 18 : 14,

      holeW,
      cellW,
      cellPad: isLarge ? 14 : 10,
      td: isLarge ? 20 : 14,
      th: isLarge ? 18 : 14,
      tdFocus: (isLarge ? 20 : 14) + 2,
      thFocus: (isLarge ? 18 : 14) + 1,

      holesMaxH: screenHeight - (isLarge ? 420 : 360),
    };
  }, [isLarge, screenWidth, screenHeight]);

  const [mode, setMode] = useState<Mode>("LEADER");
  const [showRewardsCard, setShowRewardsCard] = useState(false);

  // ✅ Correctly typed ScrollView ref
  const holesScrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  const [holesViewportH, setHolesViewportH] = useState(0);
  const [holesContentH, setHolesContentH] = useState(0);
  const [holeRowH, setHoleRowH] = useState(0);

  const [state, setState] = useState(() =>
    createGolfState({
      playerNames: setup.players,
      holes: setup.golf?.holes,
      side: setup.golf?.side,
    })
  );

  const [pending, setPending] = useState<GolfDart[]>([]);
  const [hitMarkers, setHitMarkers] = useState<{ x: number; y: number }[]>([]);

  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentHole = getCurrentHole(state);

useEffect(() => {
  console.log("FRONT DEBUG", {
    enabled: state.side.enabled,
    nassauOn: state.side.nassauOn,
    resolveAt9: state.side.nassauFrontResolveAt9,
    frontMode: state.playoffs.nassauFrontMode,
    scoresFront9Nulls: state.players.map(p => p.scores.slice(0, 9).some(v => v === null)),
    holeIndexes: state.players.map(p => p.holeIndex),
  });
}, [state]);


  const [flashPlayer, setFlashPlayer] = useState<number | null>(null);

  const rewardsOn = !!state.side?.enabled;

  useEffect(() => {
    if (!rewardsOn) setShowRewardsCard(false);
  }, [rewardsOn]);

  useEffect(() => {
    const last = state.events[state.events.length - 1];
    if (last?.kind === "REWARD") {
      setFlashPlayer(last.playerIndex);

      const t = setTimeout(() => {
        setFlashPlayer(null);
      }, 1200); // highlight duration

      return () => clearTimeout(t);
    }
  }, [state.events]);

// --------------------------
// 3) TIES / PLAYOFFS (engine-backed)
// --------------------------
const playoffNeeds = useMemo(() => getPlayoffNeeds(state), [state]);

useEffect(() => {
  console.log("PLACEMENT+FLAGS (UI)", {
    placement: state.side?.placement,
    enabled: state.side?.enabled,
    nassauOn: state.side?.nassauOn,
    nassauBack9Double: state.side?.nassauBack9Double,
    resolveAt9: state.side?.nassauFrontResolveAt9,
  });
}, [state.side]);

// tracks whether we already prompted for a given kind (prevents repeat alerts)
const promptedPlayoffsRef = useRef<Record<PlayoffKind, boolean>>({} as any);

function promptPlayoffOrder(kind: PlayoffKind, title: string, tiedPlayers: number[]) {
  const players = state.players;

  // Only ask the tied players (engine will expand to full order internally)
  const remaining = [...tiedPlayers];
  const order: number[] = [];

  const pickNext = () => {
    // if only one remains, auto-assign
    if (remaining.length === 1) {
      order.push(remaining[0]);
      remaining.splice(0, 1);
    }

    if (remaining.length === 0) {
      setState((s) => setPlayoffOrder(s, kind, order));
      return;
    }

    const place = order.length + 1;
    Alert.alert(
      title,
      `Playoff result: who finished ${ord(place - 1)} (among tied players)?`,
      remaining.map((idx) => ({
        text: players[idx]?.name ?? "?",
        onPress: () => {
          const j = remaining.indexOf(idx);
          if (j >= 0) remaining.splice(j, 1);
          order.push(idx);
          pickNext();
        },
      }))
    );
  };

  pickNext();
}

function promptResolution(kind: PlayoffKind, title: string) {
  const opts = getPlayoffOptions(state, kind);

  // Safety: if no tied players, nothing to do
  if (!opts.tiedPlayerIndices?.length) return;

  const buttons: any[] = [];

  // ✅ Only show Tie option if engine says it’s allowed + divisible
  if (opts.canTie) {
    buttons.push({
      text: "Keep Tie (split)",
      onPress: () => setState((s) => setPlayoffModeTie(s, kind)),
    });
  }

  // ✅ Playoff option if engine says allowed
  if (opts.canPlayoff) {
    buttons.push({
      text: "Playoff",
      onPress: () => promptPlayoffOrder(kind, title, opts.tiedPlayerIndices),
    });
  }

  // If somehow neither is possible, show a message (no dead end)
  if (!buttons.length) {
    Alert.alert(
      title,
      opts.reasonIfNoTie
        ? `Tie detected, but Tie (split) is not available: ${opts.reasonIfNoTie}. Enable Playoffs or adjust the divisor in Setup.`
        : "Tie detected, but no resolution option is available. Check Setup."
    );
    return;
  }

  // ✅ No “Later” option (per your requirement)
  const msg =
    opts.canTie && opts.canPlayoff
      ? "Tie detected. Choose Tie (split) or Playoff."
      : opts.canPlayoff
      ? "Tie detected. A playoff is required."
      : "Tie detected. The tie will be kept (split).";

  Alert.alert(title, msg, buttons);
}


  // --------------------------
  // 1) Rewards row behavior
  // --------------------------
  const displayRewardsTotals = useMemo(() => {
    const n = state.players.length;
    const zero = Array(n).fill(0);

    if (!rewardsOn) return zero;

    // During game: show Eagle Streak only (live)
    if (!state.isComplete) return state.rewards?.streak?.slice?.() ?? zero;

    // End of game: show final totals (all rewards)
    return state.rewards?.total?.slice?.() ?? zero;
  }, [rewardsOn, state.isComplete, state.players.length, state.rewards]);

  // pulse when displayed totals change
  const prevTotalsRef = useRef<number[]>(displayRewardsTotals);
  const [rewardsPulse, setRewardsPulse] = useState(false);

  useEffect(() => {
    if (!rewardsOn) {
      setRewardsPulse(false);
      prevTotalsRef.current = displayRewardsTotals;
      return;
    }

    const prev = prevTotalsRef.current ?? [];
    const changed =
      prev.length !== displayRewardsTotals.length ||
      displayRewardsTotals.some((v, i) => Number(v ?? 0) !== Number(prev[i] ?? 0));

    if (changed) {
      setRewardsPulse(true);
      const t = setTimeout(() => setRewardsPulse(false), 700);
      prevTotalsRef.current = displayRewardsTotals;
      return () => clearTimeout(t);
    }

    prevTotalsRef.current = displayRewardsTotals;
  }, [displayRewardsTotals, rewardsOn]);

  function mapRingToGolfDart(ring: any): GolfDart {
    if (!ring || !ring.kind) return { kind: "MISS" };
    switch (ring.kind) {
      case "MISS":
        return { kind: "MISS" };
      case "SB":
        return { kind: "SB" };
      case "DB":
        return { kind: "DB" };
      case "S_IN":
        return { kind: "S_IN", n: Number(ring.n) };
      case "S_OUT":
        return { kind: "S_OUT", n: Number(ring.n) };
      case "D":
        return { kind: "D", n: Number(ring.n) };
      case "T":
        return { kind: "T", n: Number(ring.n) };
      default:
        return { kind: "MISS" };
    }
  }

  const results3 = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = pending[i];
      if (!d || !currentHole) {
        out.push("—");
        continue;
      }
      const res = evalDart(currentHole, d);
      out.push(resultWord(res.score));
    }
    return out;
  }, [pending, currentHole]);

  function clearPending() {
    setPending([]);
  }

  function commitPendingAndEndHole() {
    if (state.isComplete) {
      setMode("LEADER");
      return;
    }
    if (pending.length === 0) return;

    setState((s0) => {
      let s = s0;
      for (const d of pending) s = applyDart(s, d);
      s = acceptHole(s);
      return s;
    });

    setHitMarkers([]);
    clearPending();
    setMode("LEADER");
  }

  // =========================
  // Nassau Leg Tracker
  // =========================
  const nassau = useMemo(() => {
    const enabled = !!state.side?.enabled && !!state.side?.nassauOn && isNassauRound(state.holes);
    if (!enabled) {
      return {
        enabled: false,
        front: { complete: false, label: "—" },
        back: { complete: false, label: "—" },
        overall: { complete: false, label: "—" },
      };
    }

    const idx = holeIndexMap(state.holes);

    const frontIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 1))!).filter((v) =>
      Number.isFinite(v)
    );

    const backIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 10))!).filter((v) =>
      Number.isFinite(v)
    );

    const bullIdx = idx.get("BULL");
    if (typeof bullIdx === "number") backIdxs.push(bullIdx);

    const overallIdxs = [...frontIdxs, ...backIdxs];

    const scoresByPlayer = state.players.map((p) => p.scores as (number | null)[]);

    const frontTotals = legTotals(scoresByPlayer, frontIdxs);
    const backTotals = legTotals(scoresByPlayer, backIdxs);
    const overallTotals = legTotals(scoresByPlayer, overallIdxs);

    return {
      enabled: true,
      front: {
        complete: legComplete(scoresByPlayer, frontIdxs),
        label: leaderLabelForLeg(state.players, frontTotals),
      },
      back: {
        complete: legComplete(scoresByPlayer, backIdxs),
        label: leaderLabelForLeg(state.players, backTotals),
      },
      overall: {
        complete: legComplete(scoresByPlayer, overallIdxs),
        label: leaderLabelForLeg(state.players, overallTotals),
      },
    };
  }, [state]);

    // Nassau front resolve check (single source of truth, AFTER state exists)
const front9Reached =
  !!state.side?.enabled &&
  !!state.side?.nassauOn &&
  !!state.side?.nassauFrontResolveAt9 &&
  !!nassau.enabled &&
  !!nassau.front.complete;

  // Prompt when needed.
  // ✅ Engine decides when something is “due”.
  // Nassau Front can become due after 9 holes if enabled.
  useEffect(() => {
  const canPrompt = state.isComplete || front9Reached;
  if (!canPrompt) return;

  // Clear prompt flags for kinds that are no longer needed (undo-safe)
  (["PODIUM", "NASSAU_FRONT", "NASSAU_BACK", "NASSAU_OVERALL"] as PlayoffKind[]).forEach((k) => {
    const needed =
      (k === "PODIUM" && playoffNeeds.podium) ||
      (k === "NASSAU_FRONT" && playoffNeeds.nassauFront) ||
      (k === "NASSAU_BACK" && playoffNeeds.nassauBack) ||
      (k === "NASSAU_OVERALL" && playoffNeeds.nassauOverall);

    if (!needed) delete promptedPlayoffsRef.current[k];
  });

  if (playoffNeeds.podium && !promptedPlayoffsRef.current["PODIUM"]) {
    promptedPlayoffsRef.current["PODIUM"] = true;
    promptResolution("PODIUM", "Podium Tie");
    return;
  }

  if (playoffNeeds.nassauFront && !promptedPlayoffsRef.current["NASSAU_FRONT"]) {
    promptedPlayoffsRef.current["NASSAU_FRONT"] = true;
    promptResolution("NASSAU_FRONT", "Nassau Front 9 Tie");
    return;
  }

  if (playoffNeeds.nassauBack && !promptedPlayoffsRef.current["NASSAU_BACK"]) {
    promptedPlayoffsRef.current["NASSAU_BACK"] = true;
    promptResolution("NASSAU_BACK", "Nassau Back 9 Tie");
    return;
  }

  if (playoffNeeds.nassauOverall && !promptedPlayoffsRef.current["NASSAU_OVERALL"]) {
    promptedPlayoffsRef.current["NASSAU_OVERALL"] = true;
    promptResolution("NASSAU_OVERALL", "Nassau Overall Tie");
    return;
  }
}, [front9Reached, playoffNeeds, state.isComplete]);


  const winnerNames = useMemo(() => {
    if (!state.isComplete) return null;
    if (!state.winnerIndices?.length) return "—";
    return state.winnerIndices.map((i) => state.players[i]?.name ?? "?").join(", ");
  }, [state.isComplete, state.winnerIndices, state.players]);

  // Back 9 totals for Total row (only when Nassau is ON)
  const back9Totals = useMemo(() => {
    if (!nassau.enabled) return null;

    const idx = holeIndexMap(state.holes);
    const backIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 10))!).filter((v) =>
      Number.isFinite(v)
    );

    const bullIdx = idx.get("BULL");
    if (typeof bullIdx === "number") backIdxs.push(bullIdx);

    return state.players.map((p) => backIdxs.reduce((acc, i) => acc + (p.scores[i] ?? 0), 0));
  }, [nassau.enabled, state.holes, state.players]);

  // ✅ Auto-scroll holes list so active hole stays roughly mid-screen
  useEffect(() => {
    if (mode !== "LEADER") return;
    if (state.isComplete) return;
    if (!holesScrollRef.current) return;
    if (!holesViewportH || !holesContentH || !holeRowH) return;

    const focusIdx = state.players[state.currentPlayerIndex]?.holeIndex ?? 0;

    // When rewards open, viewport is shorter -> anchor a bit higher
    const anchor = showRewardsCard ? 0.35 : 0.45;

    const focusTop = focusIdx * holeRowH;
    const targetY = focusTop - holesViewportH * anchor;

    const maxY = Math.max(0, holesContentH - holesViewportH);
    const y = clamp(targetY, 0, maxY);

    holesScrollRef.current.scrollTo({ y, animated: true });
  }, [
    mode,
    showRewardsCard,
    holesViewportH,
    holesContentH,
    holeRowH,
    state.currentPlayerIndex,
    state.players,
    state.isComplete,
  ]);

  const playoffsPending = useMemo(() => {
    const needs = getPlayoffNeeds(state);
    return needs.podium || needs.nassauFront || needs.nassauBack || needs.nassauOverall;
  }, [state]);

  // =========================
  // BOARD MODE
  // =========================
  if (mode === "BOARD") {
    const doneDisabled = state.isComplete || pending.length === 0;

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.full}>
          <View style={styles.topBar}>
            <View style={{ gap: 6 }}>
              <Text style={[styles.title, { fontSize: ui.title }]}>Golf</Text>
              <Text style={[styles.sub, { fontSize: ui.sub }]}>
                {state.isComplete
                  ? `🏁 Complete • Winner(s): ${winnerNames ?? "—"}`
                  : `Throwing: ${currentPlayer.name} • Target: ${holeLabel(currentHole)}`}
              </Text>
            </View>
          </View>

          <View style={[styles.center, { padding: isLarge ? 18 : 12 }]}>
            <Dartboard
              size={ui.boardSize}
              disabled={state.isComplete}
              inputDisabled={state.isComplete || pending.length >= 3}
              highlightTarget={currentHole}
              hitMarkers={hitMarkers}
              onHitMarker={(pt) => setHitMarkers((prev) => [...prev, pt].slice(0, 3))}
              onDart={() => {}}
              onDartDetail={(ring: any) => {
                if (state.isComplete) return;
                if (pending.length >= 3) return;
                const dart = mapRingToGolfDart(ring);
                setPending((p) => (p.length >= 3 ? p : [...p, dart]));
              }}
            />
          </View>

          <View
            style={[
              styles.bottomBar,
              { paddingBottom: (isLarge ? 18 : 12) + (Platform.OS === "ios" ? 6 : 0) },
            ]}
          >
            <View style={styles.dartsRow}>
              {results3.map((label, i) => (
                <View
                  key={i}
                  style={[
                    styles.dartPill,
                    {
                      paddingVertical: ui.pillPadV,
                      paddingHorizontal: ui.pillPadH,
                      minWidth: ui.pillMinW,
                    },
                  ]}
                >
                  <Text style={[styles.dartPillText, { fontSize: ui.pillText }]}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.buttonsRowBoard}>
              <Pressable
                style={[styles.btnBoard, { paddingVertical: ui.btnPadV, width: ui.btnW }]}
                onPress={() => {
                  if (pending.length > 0) {
                    // undo the most recent dart in this turn
                    setPending((p) => p.slice(0, -1));
                    // undo the most recent dot too
                    setHitMarkers((m) => m.slice(0, -1));
                  } else {
                    // fallback: undo previous accepted action (prior hole / previous turn)
                    setState((s) => undo(s));
                  }
                }}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Undo</Text>
              </Pressable>

              <Pressable
                style={[styles.btnBoard, { paddingVertical: ui.btnPadV, width: ui.btnW }]}
                onPress={() => {
                  clearPending();
                  setMode("LEADER");
                }}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Close</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.btnBoard,
                  { paddingVertical: ui.btnPadV, width: ui.btnW },
                  doneDisabled && styles.btnDisabled,
                ]}
                disabled={doneDisabled}
                onPress={commitPendingAndEndHole}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // =========================
  // SCORECARD MODE
  // =========================
  const placementConfig = state.side?.placement ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.full}>
        <View style={styles.topBar}>
          <View style={{ gap: 6 }}>
            <Text style={[styles.title, { fontSize: ui.title }]}>Scorecard</Text>
            <Text style={[styles.sub, { fontSize: ui.sub }]}>
              {state.isComplete
                ? `🏁 Complete • Winner(s): ${winnerNames ?? "—"}`
                : `Tap anywhere to throw • Up next: ${currentPlayer.name} • Hole: ${holeLabel(currentHole)}`}
            </Text>

            {/* playoff status */}
            {state.isComplete && !playoffsPending && (
              <Text style={{ marginTop: 4, opacity: 0.7, fontWeight: "800" }}>
                Playoffs resolved ✓
              </Text>
            )}
          </View>
        </View>

        {/* Rewards info card */}
        {rewardsOn && showRewardsCard && (
          <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
            <View style={styles.sideCard}>
              <Text style={styles.cardTitle}>Rewards (On)</Text>

              {/* Podium (config only) */}
              {state.side?.placementOn && (
                <>
                  <Text style={styles.cardHeader}>Podium Rewards</Text>
                  <View style={styles.badgeRow}>
                    {placementConfig.map((v, i) => (
                      <View key={i} style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {ord(i)}: {fmtSigned(v)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {/* Nassau (config + leader labels only) */}
              {state.side?.nassauOn && (
                <>
                  <Text style={styles.cardHeader}>
                    Nassau {state.side.nassauBack9Double ? "(Back 9 x2)" : ""}
                  </Text>
                  <Text style={styles.cardSub}>
                    Pays 3 legs: Front 9, Back 9 + Bull, Overall (once each leg is complete).
                  </Text>

                  {nassau.enabled && (
                    <View style={styles.legRow}>
                      <View style={styles.legPill}>
                        <Text style={styles.legPillText}>
                          Front: {nassau.front.complete ? "✓" : "…"} • {nassau.front.label}
                        </Text>
                      </View>
                      <View style={styles.legPill}>
                        <Text style={styles.legPillText}>
                          Back: {nassau.back.complete ? "✓" : "…"} • {nassau.back.label}
                        </Text>
                      </View>
                      <View style={styles.legPill}>
                        <Text style={styles.legPillText}>
                          Overall: {nassau.overall.complete ? "✓" : "…"} • {nassau.overall.label}
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* FINAL SUMMARY (only at end) */}
              {state.isComplete && state.rewards && (
                <>
                  <Text style={styles.cardHeader}>Final Summary</Text>

                  <View style={{ marginTop: 8, gap: 8 }}>
                    {state.players.map((p, i) => {
                      const podium = state.rewards.podium?.[i] ?? 0;
                      const nassauV = state.rewards.nassau?.[i] ?? 0;
                      const streak = state.rewards.streak?.[i] ?? 0;
                      const round = state.rewards.roundScore?.[i] ?? 0;
                      const total = state.rewards.total?.[i] ?? 0;

                      return (
                        <View key={i} style={{ paddingVertical: 6 }}>
                          <Text style={{ fontWeight: "900" }}>{p.name}</Text>

                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                            <View style={styles.badge}>
                              <Text style={[styles.badgeText, { color: colorFor(podium) }]}>
                                Podium: {fmtReward(podium)}
                              </Text>
                            </View>

                            <View style={styles.badge}>
                              <Text style={[styles.badgeText, { color: colorFor(nassauV) }]}>
                                Nassau: {fmtReward(nassauV)}
                              </Text>
                            </View>

                            <View style={styles.badge}>
                              <Text style={[styles.badgeText, { color: colorFor(streak) }]}>
                                Eagle: {fmtReward(streak)}
                              </Text>
                            </View>

                            <View style={styles.badge}>
                              <Text style={[styles.badgeText, { color: colorFor(round) }]}>
                                Round: {fmtReward(round)}
                              </Text>
                            </View>

                            <View style={styles.badge}>
                              <Text style={[styles.badgeText, { color: colorFor(total) }]}>
                                Total: {fmtReward(total)}
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Eagle + Round (config + live streak counter) */}
              {(state.side?.eagleBonusOn ||
                state.side?.eagleJackpotOn ||
                state.side?.roundBonusOn ||
                state.side?.roundJackpotOn) && (
                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardHeader}>Eagle Streak</Text>
                    <View style={styles.badgeRow}>
                      {state.side?.eagleBonusOn && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>
                            Bonus: {fmtSigned(state.side.eagleBonusValue)} ({state.side.eagleBonusCount})
                          </Text>
                        </View>
                      )}
                      {state.side?.eagleJackpotOn && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>
                            Jackpot: {fmtSigned(state.side.eagleJackpotValue)} ({state.side.eagleJackpotCount})
                          </Text>
                        </View>
                      )}
                    </View>

                    {(state.side?.eagleBonusOn || state.side?.eagleJackpotOn) && (
                      <Text style={styles.cardSub}>
                        Current streaks:{" "}
                        {state.players.map((p, i) => `${p.name} ${state.eagleStreak[i] ?? 0}`).join(" • ")}
                      </Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardHeader}>Total Round Score</Text>
                    <View style={styles.badgeRow}>
                      {state.side?.roundBonusOn && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>
                            Bonus: {fmtSigned(state.side.roundBonusValue)} @ {fmtThresh(state.side.roundBonusThreshold)}
                          </Text>
                        </View>
                      )}
                      {state.side?.roundJackpotOn && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>
                            Jackpot: {fmtSigned(state.side.roundJackpotValue)} @ {fmtThresh(state.side.roundJackpotThreshold)}
                          </Text>
                        </View>
                      )}
                    </View>
                    {(state.side?.roundBonusOn || state.side?.roundJackpotOn) && (
                      <Text style={styles.cardSub}>Paid at game end if total meets threshold.</Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Tap anywhere -> open board */}
        <Pressable
          style={{ flex: 1 }}
          disabled={state.isComplete}
          onPress={() => {
            clearPending();
            setMode("BOARD");
          }}
        >
          <View style={[styles.tableWrap, { padding: isLarge ? 22 : 12 }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                {/* Header */}
                <View style={[styles.tr, styles.th]}>
                  <View style={[styles.cellHole, styles.cellHeader, { width: ui.holeW, padding: ui.cellPad }]}>
                    <Text style={[styles.thText, { fontSize: ui.th }]}>Hole</Text>
                  </View>

                  {state.players.map((p, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.cell,
                        styles.cellHeader,
                        { width: ui.cellW, padding: ui.cellPad },
                        idx === state.currentPlayerIndex && !state.isComplete ? styles.cellHeaderActive : null,
                      ]}
                    >
                      <Text style={[styles.thText, { fontSize: ui.th }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Holes list (vertical scroll) */}
                <ScrollView
                  ref={holesScrollRef}
                  style={{ maxHeight: ui.holesMaxH }}
                  onLayout={(e) => setHolesViewportH(e.nativeEvent.layout.height)}
                  onContentSizeChange={(_, h) => setHolesContentH(h)}
                  showsVerticalScrollIndicator
                >
                  {state.holes.map((h, holeIdx) => {
                    const isFocusRow = holeIdx === currentPlayer.holeIndex && !state.isComplete;

                    return (
                      <View
                        key={holeIdx}
                        onLayout={(e) => {
                          if (holeIdx === 0 && !holeRowH) setHoleRowH(e.nativeEvent.layout.height);
                        }}
                        style={[styles.tr, isFocusRow && styles.focusRow]}
                      >
                        <View style={[styles.cellHole, { width: ui.holeW, padding: ui.cellPad }]}>
                          <Text style={[styles.tdText, { fontSize: isFocusRow ? ui.tdFocus : ui.td }]}>
                            {holeLabel(h)}
                          </Text>
                        </View>

                        {state.players.map((p, pIdx) => {
                          const v = p.scores[holeIdx];
                          const played = v !== null;

                          const isCurrentCell =
                            !state.isComplete &&
                            pIdx === state.currentPlayerIndex &&
                            holeIdx === state.players[pIdx].holeIndex;

                          const mark = state.eagleRewardMark?.[pIdx]?.[holeIdx] ?? null;
                          const isEagleStreak = mark === "EAGLE"; // provisional streak highlight
                          const isEagleBonus = mark === "BONUS";
                          const isEagleJackpot = mark === "JACKPOT";

                          return (
                            <View
                              key={pIdx}
                              style={[
                                styles.cell,
                                { width: ui.cellW, padding: ui.cellPad },
                                isEagleStreak && styles.eagleStreakCell,
                                isEagleBonus && styles.eagleBonusCell,
                                isEagleJackpot && styles.eagleJackpotCell,
                                isCurrentCell && styles.cellActive,
                                isFocusRow && styles.focusCell,
                              ]}
                            >
                              {!played ? (
                                <Text
                                  style={[
                                    styles.tdText,
                                    { fontSize: isFocusRow ? ui.tdFocus : ui.td, opacity: 0.35 },
                                  ]}
                                >
                                  —
                                </Text>
                              ) : (() => {
                                const holeScore = v as number;
                                const runningTotal = totalUpTo(p.scores, holeIdx);
                                const shownNumber = cellMode === "TOTAL" ? runningTotal : holeScore;
                                const label = scoreNameForCell(holeScore);

                                return (
                                  <View
                                    style={{
                                      flexDirection: "row",
                                      alignItems: "center",
                                      justifyContent: "flex-start",
                                      width: "100%",
                                      paddingHorizontal: 2,
                                    }}
                                  >
                                    {!!label && (
                                      <Text
                                        style={[
                                          styles.tdText,
                                          {
                                            fontSize: (isFocusRow ? ui.tdFocus : ui.td) * 0.65,
                                            opacity: 0.7,
                                          },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {label}
                                      </Text>
                                    )}

                                    <Text
                                      style={[
                                        styles.tdText,
                                        {
                                          fontSize: isFocusRow ? ui.tdFocus : ui.td,
                                          fontWeight: "900",
                                          marginLeft: "auto",
                                          textAlign: "right",
                                        },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {scoreLabel(shownNumber)}
                                    </Text>
                                  </View>
                                );
                              })()}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </ScrollView>

                {/* Total row */}
                <View style={[styles.tr, styles.totalRow]}>
                  <View style={[styles.cellHole, styles.cellHeader, { width: ui.holeW, padding: ui.cellPad }]}>
                    <Text style={[styles.thText, { fontSize: ui.th }]}>Total</Text>
                  </View>

                  {state.players.map((p, idx) => {
                    const back = back9Totals ? (back9Totals[idx] ?? 0) : null;

                    return (
                      <View
                        key={idx}
                        style={[
                          styles.cell,
                          styles.cellHeader,
                          {
                            width: ui.cellW,
                            padding: ui.cellPad,
                            flexDirection: back9Totals ? "row" : "column",
                            justifyContent: back9Totals ? "space-between" : "center",
                            alignItems: "center",
                          },
                        ]}
                      >
                        <Text style={[styles.thText, { fontSize: ui.th }]} numberOfLines={1}>
                          {scoreLabel(p.total)}
                        </Text>

                        {back9Totals &&(
                          <Text style={[styles.thText, { fontSize: ui.th, opacity: 0.85 }]} numberOfLines={1}>
                            {scoreLabel(back as number)}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Rewards row (1) ALL rewards: streak live during game, total at end */}
                {rewardsOn && (
                  <View style={[styles.tr, styles.totalRow]}>
                    <View style={[styles.cellHole, styles.cellHeader, styles.rewardCell, { width: ui.holeW }]}>
                      <Text style={[styles.thText, { fontSize: ui.th }]}>
                        {state.isComplete ? "Rewards" : "Rewards"}
                      </Text>
                    </View>

                    {state.players.map((_, idx) => {
                      const d = displayRewardsTotals[idx] ?? 0;
                      const label = fmtReward(d);

                      return (
                        <View
                          key={idx}
                          style={[
                            styles.cell,
                            styles.cellHeader,
                            styles.rewardCell,
                            { width: ui.cellW },
                            flashPlayer === idx && styles.rewardPulseCell,
                          ]}
                        >
                          <Text
                            style={[
                              styles.thText,
                              { fontSize: ui.th },
                              flashPlayer === idx && styles.rewardPulseText,
                            ]}
                            numberOfLines={1}
                          >
                            {label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        </Pressable>

        <View style={[styles.bottomBar, { paddingBottom: (isLarge ? 18 : 12) + (Platform.OS === "ios" ? 8 : 0) }]}>
          <View style={styles.buttonsRow}>
            {rewardsOn && (
              <Pressable
                style={[
                  styles.btn,
                  { paddingVertical: ui.btnPadV, width: ui.btnW },
                  !showRewardsCard && styles.btnGlow,
                  showRewardsCard && styles.btnActive,
                ]}
                onPress={() => setShowRewardsCard((v) => !v)}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Rewards</Text>
              </Pressable>
            )}

            <Pressable
              style={[styles.btn, { paddingVertical: ui.btnPadV, width: ui.btnW }]}
              onPress={() => navigation.goBack()}
            >
              <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Exit</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, { paddingVertical: ui.btnPadV, width: ui.btnW }]}
              onPress={() => setState((s) => undo(s))}
            >
              <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Undo</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, { paddingVertical: ui.btnPadV, width: ui.btnW }]}
              onPress={() => setState((s) => redo(s))}
            >
              <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Redo</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, { paddingVertical: ui.btnPadV, width: ui.btnW }]}
              disabled={state.isComplete}
              onPress={() => setState((s) => noScore(s))}
            >
              <Text style={[styles.btnText, { fontSize: ui.btnText }]}>No Score</Text>
            </Pressable>
          </View>

          {!state.isComplete && (
            <Text style={[styles.hint, { fontSize: isLarge ? 14 : 11 }]}>
              No Score forces +2 and ends the current player’s hole immediately.
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  full: { flex: 1, backgroundColor: "#F8FAFC" },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "white",
    justifyContent: "center",
  },

  title: { fontWeight: "800" },
  sub: { opacity: 0.85, fontWeight: "700" },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  bottomBar: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "white",
    gap: 12,
  },

  buttonsRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },

  buttonsRowBoard: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },

  btn: {
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  btnBoard: {
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },

  btnText: { color: "white", fontWeight: "900" },

  btnDisabled: { opacity: 0.45 },

  btnActive: { backgroundColor: "#0F172A" },

  btnGlow: {
    borderWidth: 2,
    borderColor: "#0F9D58",
    shadowColor: "#0F9D58",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  hint: { opacity: 0.65 },

  dartsRow: { flexDirection: "row", gap: 10, justifyContent: "center", flexWrap: "wrap" },
  dartPill: {
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  dartPillText: { fontWeight: "900" },

  tableWrap: { flex: 1 },
  tr: { flexDirection: "row", marginBottom: 10 },
  th: { marginBottom: 12 },

  cellHole: {
    borderRadius: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cell: {
    borderRadius: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  cellHeader: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  cellHeaderActive: { borderColor: "#2563EB", borderWidth: 2 },

  thText: { color: "white", fontWeight: "900" },
  tdText: { fontWeight: "900" },

  cellActive: { borderColor: "#2563EB", borderWidth: 2 },

  totalRow: { marginTop: 10 },

  rewardCell: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },

  rewardPulseCell: {
    backgroundColor: "#0F9D58",
    borderColor: "#0F9D58",
    borderWidth: 2,
  },
  rewardPulseText: { color: "white" },

  sideCard: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 12,
  },

  cardTitle: { fontWeight: "900", fontSize: 16 },
  cardHeader: { marginTop: 10, fontWeight: "900", opacity: 0.9 },
  cardSub: { opacity: 0.7, marginTop: 4 },

  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  badgeText: { fontWeight: "900" },
  badge: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },

  legRow: { marginTop: 10, gap: 8, flexDirection: "row", flexWrap: "wrap" },
  legPill: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  legPillText: { fontWeight: "900", color: "#1E3A8A" },

  twoColRow: { marginTop: 12, flexDirection: "row", gap: 12 },

  focusRow: { borderRadius: 12 },
  focusCell: { backgroundColor: "#EEF2FF", borderColor: "#5fb84b" },

  // ✅ NEW: first eagle in streak
  eagleStreakCell: {
  backgroundColor: "#f1fff5", 
  borderColor: "#86c79e",
  borderWidth: 2,
},
  eagleStartCell: {
    backgroundColor: "#ECFDF5",
    borderColor: "#34D399",
    borderWidth: 2,
  },

  eagleBonusCell: {
    backgroundColor: "#DCFCE7",
    borderColor: "#22C55E",
    borderWidth: 2,
  },
  eagleJackpotCell: {
    backgroundColor: "#BBF7D0",
    borderColor: "#16A34A",
    borderWidth: 2,
  },
});
