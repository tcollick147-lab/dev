// src/screens/CricketGameScreen.tsx

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
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
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";

import Dartboard, { type Ring } from "../components/Dartboard";
import {
  createCricketState,
  applyHit,
  undo,
  redo,
  getWinner,
  clearEvents,
  type CricketState,
  type CricketTarget,
} from "../engine/cricketEngine";

import { buildCricketSideGames } from "../engine/cricketSideGames";

// ✅ AutoDarts hook
import { useAutoDarts, type AutoDartsThrow, type AutoDartsStatus } from "../autodarts/useAutoDarts";
import { AUTO_WS_URL } from "../config/autodarts";

type Props = NativeStackScreenProps<RootStackParamList, "CricketGame">;
type Mode = "BOARD" | "LEADER";

/** ------------------------
 * Targets ordering + labels
 * ------------------------ */
function labelForTarget(t: CricketTarget) {
  if (t === "BULL") return "BULL";
  if (t === "D") return "DOUBLE";
  if (t === "T") return "TREBLE";
  return String(t);
}

function sortTargetsCricket(targets: CricketTarget[]) {
  const nums = targets.filter((t): t is number => typeof t === "number");
  const hasD = targets.includes("D");
  const hasT = targets.includes("T");
  const hasB = targets.includes("BULL");

  nums.sort((a, b) => b - a);

  const out: CricketTarget[] = [...nums];
  if (hasD) out.push("D");
  if (hasT) out.push("T");
  if (hasB) out.push("BULL");
  return out;
}

const NO_SCORE_TARGET = "__NO_SCORE__" as unknown as CricketTarget;

function isDeadTargetIndex(state: CricketState, tIdx: number) {
  for (const p of state.players) {
    if ((p.marks?.[tIdx] ?? 0) < 3) return false;
  }
  return true;
}

function normalizeDeadHit(s: CricketState, hit: PendingHit): PendingHit {
  const t: any = hit.target;

  // already no-score
  if (t === (NO_SCORE_TARGET as any)) return hit;

  // if target exists in game and is globally dead -> No Score
  const idx = s.targets.findIndex((x) => x === t);
  if (idx >= 0 && isDeadTargetIndex(s, idx)) {
    return { target: NO_SCORE_TARGET, mult: 1 };
  }

  return hit;
}

/** ------------------------
 * Pending types
 * ------------------------ */
type PendingHit = {
  target: CricketTarget;
  mult: 1 | 2 | 3;
  sourceNumber?: number;
  sourceMultiplier?: 2 | 3;
};

type PendingEntry =
  | { kind: "HIT"; hit: PendingHit }
  | {
      kind: "CHOICE";
      ringKind: "D" | "T";
      n: number;
      asNumber: PendingHit;
      asSpecial: PendingHit;
    };

function specialEarnedPoints(args: {
  state: CricketState;
  turnIdx: number;
  target: "D" | "T";
  sourceNumber?: number;
  sourceMultiplier?: 2 | 3;
}) {
  const { state, turnIdx, target, sourceNumber, sourceMultiplier } = args;

  if (typeof sourceNumber !== "number" || !Number.isFinite(sourceNumber)) return 0;

  const tIdx = state.targets.findIndex((x) => x === target);
  if (tIdx < 0) return 0;

  const meMarks = state.players?.[turnIdx]?.marks?.[tIdx] ?? 0;
  const iAmClosed = meMarks >= 3;
  if (!iAmClosed) return 0;

  // Only score if at least one opponent is NOT closed on that target
  const someoneOpen = state.players.some((p, pIdx) => {
    if (pIdx === turnIdx) return false;
    const m = p.marks?.[tIdx] ?? 0;
    return m < 3;
  });
  if (!someoneOpen) return 0;

  const mult =
    typeof sourceMultiplier === "number"
      ? sourceMultiplier
      : target === "T"
      ? 3
      : 2;

  return sourceNumber * mult;
}

function pendingLabel(entry: PendingEntry | null, sNow?: CricketState, turnIdx?: number) {
  if (!entry) return "—";

  // remove "?" from D20?/T20?
  if (entry.kind === "CHOICE") {
    return entry.ringKind === "D" ? `D${entry.n}` : `T${entry.n}`;
  }

  const { target, mult, sourceNumber, sourceMultiplier } = entry.hit as any;

  if (target === (NO_SCORE_TARGET as any)) return "No Score";

  // ✅ Bulls on board should be "25" / "50"
  if (target === "BULL") return mult === 2 ? "50" : "25";

  // ✅ Special targets on board should be "Double"/"Treble"
  // If they actually SCORED points (i.e. already closed, opponents not closed),
  // append (points).
  if (target === "D") {
    if (sNow && typeof turnIdx === "number") {
      const pts = specialEarnedPoints({
        state: sNow,
        turnIdx,
        target: "D",
        sourceNumber,
        sourceMultiplier,
      });
      return pts > 0 ? `Double (${pts})` : "Double";
    }
    return "Double";
  }

  if (target === "T") {
    if (sNow && typeof turnIdx === "number") {
      const pts = specialEarnedPoints({
        state: sNow,
        turnIdx,
        target: "T",
        sourceNumber,
        sourceMultiplier,
      });
      return pts > 0 ? `Treble (${pts})` : "Treble";
    }
    return "Treble";
  }

  // ✅ Singles are "20" (not "S20"), doubles/trebles are "D20"/"T20"
  if (mult === 1) return `${target}`;
  if (mult === 2) return `D${target}`;
  return `T${target}`;
}



/** ------------------------
 * Mark glyphs
 * ------------------------ */
function SlashMark({ size, active }: { size: number; active?: boolean }) {
  const color = active ? "#1D4ED8" : "#0F172A";
  const d = Math.round(size * 1.05);
  const stroke = Math.max(2, Math.round(d * 0.14));
  return (
    <View style={{ width: d, height: d, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: d * 0.8,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: "-55deg" }],
          borderRadius: stroke,
        }}
      />
    </View>
  );
}

function XMark({ size, active }: { size: number; active?: boolean }) {
  const color = active ? "#1D4ED8" : "#0F172A";
  const d = Math.round(size * 1.05);
  const stroke = Math.max(2, Math.round(d * 0.14));
  return (
    <View style={{ width: d, height: d, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: d * 0.82,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
          borderRadius: stroke,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: d * 0.82,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: "-45deg" }],
          borderRadius: stroke,
        }}
      />
    </View>
  );
}

function CircleXMark({ size, active }: { size: number; active?: boolean }) {
  const color = active ? "#1D4ED8" : "#0F172A";
  const d = Math.round(size * 1.05);
  const stroke = Math.max(2, Math.round(d * 0.12));

  return (
    <View
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        borderWidth: stroke,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: d * 0.7,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
          borderRadius: stroke,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: d * 0.7,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: "-45deg" }],
          borderRadius: stroke,
        }}
      />
    </View>
  );
}

function MarkGlyph(props: { marks: number; size: number; active?: boolean }) {
  const { marks, size, active } = props;
  if (marks <= 0) return <View style={{ width: size, height: size }} />;
  if (marks === 1) return <SlashMark size={size} active={active} />;
  if (marks === 2) return <XMark size={size} active={active} />;
  return <CircleXMark size={size} active={active} />;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function playerName(p: any): string {
  return typeof p?.name === "string" ? p.name : "—";
}
function playerScore(p: any): number {
  return Number(p?.score ?? 0) || 0;
}
function playerMarks(p: any): number[] {
  return Array.isArray(p?.marks) ? p.marks : [];
}

/** ------------------------
 * Persistence
 * ------------------------ */
function makeStorageKey(setup: any) {
  const players = Array.isArray(setup?.players) ? setup.players.join("|") : "players";
  const targets = Array.isArray(setup?.targets) ? setup.targets.join("|") : "targets";
  const mode = setup?.mode ?? "mode";
  const ac = setup?.autoConcede ? "AC1" : "AC0";
  return `cricket:v1:${players}:${targets}:${mode}:${ac}`;
}

// do not persist sideGames (functions)
function persistableState(s: CricketState): any {
  const { past, future, sideGames, ...rest } = s as any;
  return { ...rest, past: [], future: [], sideGames: undefined };
}

function reattachSideGames(setup: any, loaded: CricketState): CricketState {
  const sideGames = buildCricketSideGames(setup.sideGames);
  let sideGameState = (loaded as any).sideGameState;

  if (!sideGameState && sideGames?.init) {
    try {
      sideGameState = sideGames.init({
        players: setup.players,
        targets: setup.targets,
        mode: setup.mode,
        autoConcede: setup.autoConcede,
        sideGames,
      } as any);
    } catch {}
  }

  return {
    ...loaded,
    sideGames,
    sideGameState,
  };
}

/** ------------------------
 * Deferred choice prompt helper
 * ------------------------ */
function askChoice(entry: Extract<PendingEntry, { kind: "CHOICE" }>): Promise<PendingHit | null> {
  const { ringKind, n, asNumber, asSpecial } = entry;
  return new Promise((resolve) => {
    Alert.alert(
      "Count as…",
      ringKind === "D"
        ? `Count Double ${n} as D${n} (2 marks on ${n}) or Double (1 mark)?`
        : `Count Treble ${n} as T${n} (3 marks on ${n}) or Treble (1 mark)?`,
      [
        { text: ringKind === "D" ? `D${n}` : `T${n}`, onPress: () => resolve(asNumber) },
        { text: ringKind === "D" ? "Double" : "Treble", onPress: () => resolve(asSpecial) },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ]
    );
  });
}

/** ------------------------
 * Map Dartboard ring -> Cricket pending hit
 * ------------------------ */
function ringToCricketHit(ring: Ring, targets: CricketTarget[]): PendingHit {
  if (ring.kind === "MISS") return { target: NO_SCORE_TARGET, mult: 1 };

  if (ring.kind === "SB") {
    return targets.includes("BULL") ? { target: "BULL", mult: 1 } : { target: NO_SCORE_TARGET, mult: 1 };
  }
  if (ring.kind === "DB") {
    return targets.includes("BULL") ? { target: "BULL", mult: 2 } : { target: NO_SCORE_TARGET, mult: 1 };
  }

  if (ring.kind === "S_IN" || ring.kind === "S_OUT") {
    return targets.includes(ring.n) ? { target: ring.n, mult: 1 } : { target: NO_SCORE_TARGET, mult: 1 };
  }

  if (ring.kind === "D") {
    if (targets.includes(ring.n)) return { target: ring.n, mult: 2 };
    if (targets.includes("D")) {
      return { target: "D", mult: 1, sourceNumber: ring.n, sourceMultiplier: 2 };
    }
    return { target: NO_SCORE_TARGET, mult: 1 };
  }

  if (ring.kind === "T") {
    if (targets.includes(ring.n)) return { target: ring.n, mult: 3 };
    if (targets.includes("T")) {
      return { target: "T", mult: 1, sourceNumber: ring.n, sourceMultiplier: 3 };
    }
    return { target: NO_SCORE_TARGET, mult: 1 };
  }

  return { target: NO_SCORE_TARGET, mult: 1 };
}

/** ------------------------
 * AutoDarts throw -> Ring
 * ------------------------ */
function autoThrowToRing(t: AutoDartsThrow): Ring {
  const seg: any = (t as any)?.segment ?? {};
  const name = String(seg?.name ?? "").trim();
  const num = Number(seg?.number ?? NaN);
  const bed = String(seg?.bed ?? "").toLowerCase();
  const mult = Number(seg?.multiplier ?? 1);

  // miss-near e.g. "M8"
  if (name.toUpperCase().startsWith("M")) return { kind: "MISS" } as any;

  // bull variants
  if (num === 25 || name === "Bull" || name === "SBULL" || name === "DBULL" || name === "25") {
    const isDouble = mult === 2 || bed.includes("double") || name === "DBULL";
    return (isDouble ? { kind: "DB" } : { kind: "SB" }) as any;
  }

  // numbers
  if (Number.isFinite(num) && num >= 1 && num <= 20) {
    if (mult === 3 || bed.includes("triple")) return { kind: "T", n: num } as any;
    if (mult === 2 || bed.includes("double")) return { kind: "D", n: num } as any;

    // single: try distinguish inner/outer
    if (bed.includes("inner")) return { kind: "S_IN", n: num } as any;
    if (bed.includes("outer")) return { kind: "S_OUT", n: num } as any;

    // fallback
    return { kind: "S_OUT", n: num } as any;
  }

  return { kind: "MISS" } as any;
}

/** ------------------------
 * AutoDarts "EAGLE" detection (best-effort)
 * Adjust if your payload uses a different field.
 * ------------------------ */
function isEagleThrow(t: AutoDartsThrow): boolean {
  const anyT: any = t as any;
  const a = String(anyT?.event?.name ?? anyT?.event?.type ?? anyT?.type ?? "").toUpperCase();
  const b = String(anyT?.segment?.name ?? "").toUpperCase();
  return a.includes("EAGLE") || b.includes("EAGLE");
}

export default function CricketGameScreen({ route, navigation }: Props) {
  const { setup } = route.params;
  const storageKey = useMemo(() => makeStorageKey(setup), [setup]);

  const onExitGame = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch {}
    navigation.goBack();
  }, [navigation, storageKey]);

  // =========================
  // AUTO DARTS SETTINGS
  // =========================
  const AUTO_BASE_URL = AUTO_WS_URL
  .replace(/^ws:/, "http:")
  .replace(/^wss:/, "https:")
  .replace(/\/api\/events\/?$/, "");


  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const base = Math.min(screenWidth, screenHeight);
  const isLarge = base >= 900;
  const isLandscape = screenWidth > screenHeight;

  

  const ui = useMemo(() => {
    const sidePadding = isLarge ? 22 : 12;
    const gap = isLarge ? 12 : 10;

    const targetW = isLarge ? 132 : 100;

    const playerSlots = 6;
    const available = screenWidth - sidePadding * 2 - targetW - gap;
    const rawCellW = Math.floor(available / Math.max(1, playerSlots)) - gap;
    const cellW = Math.max(isLarge ? 120 : 104, Math.min(rawCellW, isLarge ? 220 : 180));

    const btnGap = 12;
    const btnCountBase = 4;
    const btnRowW = screenWidth - sidePadding * 2;
    const btnW = Math.floor((btnRowW - btnGap * (btnCountBase - 1)) / btnCountBase);

    return {
      title: isLarge ? 30 : 22,
      sub: isLarge ? 20 : 16,

      boardSize: Math.min(screenWidth - 10, screenHeight - 232, isLarge ? 1012 : 694),

      btnPadV: isLarge ? 16 : 12,
      btnText: isLarge ? 18 : 14,
      btnW,

      pillPadV: isLarge ? 12 : 9,
      pillPadH: isLarge ? 14 : 12,
      pillMinW: isLarge ? 170 : 120,
      pillText: isLarge ? 18 : 14,

      targetW,
      cellW,
      cellPad: isLarge ? 14 : 10,
      td: isLarge ? 20 : 14,
      th: isLarge ? 18 : 14,
      tdFocus: (isLarge ? 20 : 14) + 2,
      thFocus: (isLarge ? 18 : 14) + 1,

      gap,
      sidePadding,
    };
  }, [isLarge, screenWidth, screenHeight]);

  const [state, setState] = useState<CricketState>(() =>
    createCricketState({
      players: setup.players,
      targets: setup.targets,
      mode: setup.mode,
      autoConcede: setup.autoConcede,
      sideGames: buildCricketSideGames(setup.sideGames),
    })
  );

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable
          onPress={() => {
            Alert.alert("Exit Game", "Exit and discard this game?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Exit Game",
                style: "destructive",
                onPress: async () => {
                  try {
                    await AsyncStorage.removeItem(storageKey);
                  } catch {}
                  navigation.goBack();
                },
              },
            ]);
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 6 }}
        >
          <Text style={{ color: "#2563EB", fontWeight: "800" }}>Exit Game</Text>
        </Pressable>
      ),
    });
  }, [navigation, storageKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!alive) return;
        if (!raw) {
          setHydrated(true);
          return;
        }
        const parsed = JSON.parse(raw) as { state: CricketState; setup: any };

        const samePlayers =
          Array.isArray(parsed?.setup?.players) &&
          Array.isArray(setup?.players) &&
          parsed.setup.players.length === setup.players.length &&
          parsed.setup.players.every((n: any, i: number) => n === setup.players[i]);

        const sameTargets =
          Array.isArray(parsed?.setup?.targets) &&
          Array.isArray(setup?.targets) &&
          parsed.setup.targets.length === setup.targets.length &&
          parsed.setup.targets.every((t: any, i: number) => t === setup.targets[i]);

        const sameMode = parsed?.setup?.mode === setup?.mode;
        const sameAC = !!parsed?.setup?.autoConcede === !!setup?.autoConcede;

        if (parsed?.state && samePlayers && sameTargets && sameMode && sameAC) {
          setState(reattachSideGames(setup, parsed.state));
        }
      } catch {
        // ignore
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storageKey, setup]);

  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify({ setup, state: persistableState(state) }));
      } catch {}
    })();
  }, [state, hydrated, storageKey, setup]);

  const winner = useMemo(() => getWinner(state), [state]);
  const orderedTargets = useMemo(() => sortTargetsCricket(state.targets), [state.targets]);
  const [mode, setMode] = useState<Mode>("LEADER");
  const [viewedViaPeek, setViewedViaPeek] = useState(false);

  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [hitMarkers, setHitMarkers] = useState<{ x: number; y: number }[]>([]);
  const [overlayText, setOverlayText] = useState<string | null>(null);

  // Stack of undone pending entries/markers for board Undo/Redo (markers + overlays)
  const undoneEntriesRef = useRef<PendingEntry[]>([]);
  const undoneMarkersRef = useRef<({ x: number; y: number } | null)[]>([]);

  // ✅ keep live refs (fixes stale closures for AutoDarts)
  const pendingRef = useRef<PendingEntry[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const stateRef = useRef(state);
  const modeRef = useRef(mode);
  const completeRef = useRef(false);
  useEffect(() => {
    stateRef.current = state;
    completeRef.current = winner.winnerIdx !== null || !!state.isComplete;
  }, [state, winner.winnerIdx]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // -------------------------
  // ✅ Overlay helpers
  // -------------------------
  const overlayTimerRef = useRef<any>(null);

  const clearOverlayTimer = useCallback(() => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = null;
  }, []);

  const hideOverlay = useCallback(() => {
    clearOverlayTimer();
    setOverlayText(null);
  }, [clearOverlayTimer]);

  const showOverlayHold = useCallback(
    (text: string) => {
      clearOverlayTimer();
      setOverlayText(text);
    },
    [clearOverlayTimer]
  );

  const showOverlayTimed = useCallback(
    (text: string, ms: number) => {
      clearOverlayTimer();
      setOverlayText(text);
      overlayTimerRef.current = setTimeout(() => {
        setOverlayText(null);
        overlayTimerRef.current = null;
      }, ms);
    },
    [clearOverlayTimer]
  );

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  const clearPending = useCallback(() => {
    setPending([]);
    setHitMarkers([]);
    undoneEntriesRef.current = [];
    undoneMarkersRef.current = [];
    hideOverlay();
  }, [hideOverlay]);

  // ✅ AutoDarts connected dot (based on recent status updates)
  const [autoConnected, setAutoConnected] = useState(false);
  const autoConnTimerRef = useRef<any>(null);

  const noteAutoAlive = useCallback(() => {
    setAutoConnected(true);
    if (autoConnTimerRef.current) clearTimeout(autoConnTimerRef.current);
    autoConnTimerRef.current = setTimeout(() => setAutoConnected(false), 2500);
  }, []);

  // ✅ Reset button state + status for label
  const [autoResetting, setAutoResetting] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string>("");
  const [autoNumThrows, setAutoNumThrows] = useState<number>(0);

  // ✅ Button text
  const resetLabel = useMemo(() => {
    const s = String(autoStatus || "").toLowerCase();
    if (s.includes("takeout")) return "Reset (Takeout)";
    if (autoNumThrows === 1) return "Reset (1/3)";
    if (autoNumThrows === 2) return "Reset (2/3)";
    if (autoNumThrows >= 3) return "Reset (3/3)";
    return "Reset";
  }, [autoStatus, autoNumThrows]);

  useEffect(() => {
    return () => {
      if (autoConnTimerRef.current) clearTimeout(autoConnTimerRef.current);
    };
  }, []);

  // =========================
  // ✅ AutoDarts gating: require a clear (numThrows==0) before accepting throws after turn changes/commit
  // =========================
  const awaitingClearRef = useRef<boolean>(false);
  const resetAutoForNewTurn = useCallback(() => {
    awaitingClearRef.current = true;
  }, []);

  // =========================
  // ✅ Takeout -> Throw transition => commit pending
  // =========================
  const prevAutoStatusRef = useRef<string>("");

  // =========================
  // DONE / NO SCORE helpers
  // =========================
  const endTurnFromScoreboard = useCallback(() => {
    if (winner.winnerIdx !== null) return;

    clearPending();
    hideOverlay();

    setState((s0) => {
      let s = s0;
      if (s.isComplete) return s;

      for (let i = s.dartInTurn; i < 3; i++) {
        const forced = i as 0 | 1 | 2;
        s = applyHit({ ...s, dartInTurn: forced }, { target: NO_SCORE_TARGET as any, multiplier: 1 } as any);
      }

      return s;
    });

    resetAutoForNewTurn();
    setMode("LEADER");
  }, [winner.winnerIdx, clearPending, hideOverlay, resetAutoForNewTurn]);

  const undoLastTurn = useCallback(() => {
    hideOverlay();
    clearPending();
    setState((s0) => {
      let s = s0;
      if (!s.past?.length) return s;

      for (let i = 0; i < 6; i++) {
        const before = s;
        s = undo(s);
        if (s === before) break;
        const atBoundary = s.dartInTurn === 0 && (s.turnHits?.length ?? 0) === 0;
        if (atBoundary) break;
      }
      return s;
    });
    resetAutoForNewTurn();
  }, [hideOverlay, clearPending, resetAutoForNewTurn]);

  // ✅ No Score button (ends turn without throwing a dart)
  const endTurnNoScoreFromBoard = useCallback(() => {
    if (winner.winnerIdx !== null) return;

    clearPending();
    hideOverlay();

    setState((s0) => {
      let s = s0;
      if (s.isComplete) return s;

      for (let i = s.dartInTurn; i < 3; i++) {
        const forced = i as 0 | 1 | 2;
        s = applyHit({ ...s, dartInTurn: forced }, { target: NO_SCORE_TARGET as any, multiplier: 1 } as any);
      }

      return s;
    });

    resetAutoForNewTurn();
    setMode("LEADER");
  }, [winner.winnerIdx, clearPending, hideOverlay, resetAutoForNewTurn]);

  const TAP_LOCK_MS = 90;
  const tapLockedRef = useRef(false);
  const lockScoringTap = useCallback(() => {
    if (tapLockedRef.current) return false;
    tapLockedRef.current = true;
    setTimeout(() => (tapLockedRef.current = false), TAP_LOCK_MS);
    return true;
  }, []);

  const [dartSound, setDartSound] = useState<Audio.Sound | null>(null);
  const [rewardSound, setRewardSound] = useState<Audio.Sound | null>(null);

  useEffect(() => {
    let mounted = true;
    let hit: Audio.Sound | null = null;
    let reward: Audio.Sound | null = null;

    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

        const hitRes = await Audio.Sound.createAsync(require("../../assets/sounds/dart_hit.mp3"), {
          shouldPlay: false,
          volume: 0.8,
        });
        hit = hitRes.sound;
        if (mounted) setDartSound(hit);

        const rewardRes = await Audio.Sound.createAsync(require("../../assets/sounds/reward.mp3"), {
          shouldPlay: false,
          volume: 0.9,
        });
        reward = rewardRes.sound;
        if (mounted) setRewardSound(reward);
      } catch (e) {
        console.warn("Failed to load sounds", e);
      }
    })();

    return () => {
      mounted = false;
      if (hit) hit.unloadAsync();
      if (reward) reward.unloadAsync();
    };
  }, []);

  const playHit = useCallback(async () => {
    if (!dartSound) return;
    try {
      await dartSound.stopAsync();
      await dartSound.setPositionAsync(0);
      await dartSound.playAsync();
    } catch {}
  }, [dartSound]);

  const playReward = useCallback(async () => {
    if (!rewardSound) return;
    try {
      await rewardSound.stopAsync();
      await rewardSound.setPositionAsync(0);
      await rewardSound.playAsync();
    } catch {}
  }, [rewardSound]);

  // Play reward sound and clear events so it can trigger again
  useEffect(() => {
    if (!hydrated) return;
    if (!state.events?.reward && !state.events?.jackpot) return;

    playReward();
    setState((s) => clearEvents(s));
  }, [state.events?.reward, state.events?.jackpot, playReward, hydrated]);

  const commitResolvedHits = useCallback(
    (resolvedHits: PendingHit[]) => {
      if (winner.winnerIdx !== null) {
        setMode("LEADER");
        return;
      }
      if (resolvedHits.length === 0) return;

      setState((s0) => {
        let s = s0;

        for (let i = 0; i < resolvedHits.length && i < 3; i++) {
          const h = resolvedHits[i];
          const forcedDartInTurn = i as 0 | 1 | 2;

          s = applyHit(
            { ...s, dartInTurn: forcedDartInTurn },
            {
              target: h.target as any,
              multiplier: h.mult,
              sourceNumber: h.sourceNumber,
              sourceMultiplier: h.sourceMultiplier,
            } as any
          );
        }

        for (let i = resolvedHits.length; i < 3; i++) {
          const forcedDartInTurn = i as 0 | 1 | 2;
          s = applyHit({ ...s, dartInTurn: forcedDartInTurn }, { target: NO_SCORE_TARGET as any, multiplier: 1 } as any);
        }

        return s;
      });

      clearPending(); // ✅ clears overlay too
      resetAutoForNewTurn(); // ✅ require board clear before next player
      setMode("LEADER"); // ✅ scoreboard after commit
    },
    [winner.winnerIdx, clearPending, resetAutoForNewTurn]
  );

  // ✅ Commit using CURRENT pendingRef (fixes stale closure)
  const commitPendingFromRef = useCallback(async () => {
    if (winner.winnerIdx !== null) {
      setMode("LEADER");
      return;
    }

    const p = pendingRef.current ?? [];
    if (p.length === 0) return;

    const resolvedHits: PendingHit[] = [];
    for (const entry of p.slice(0, 3)) {
      if (entry.kind === "HIT") {
        resolvedHits.push(entry.hit);
      } else {
        const chosen = await askChoice(entry);
        if (!chosen) return;
        resolvedHits.push(chosen);
      }
    }

    commitResolvedHits(resolvedHits);
  }, [winner.winnerIdx, commitResolvedHits]);

  const commitPending = useCallback(async () => {
    await commitPendingFromRef();
  }, [commitPendingFromRef]);

  // =========================
  // ✅ Commit on status transition: Takeout -> Throw
  // =========================
  const commitIfReadyFromStatus = useCallback(async () => {
    if (completeRef.current) return;

    const p = pendingRef.current ?? [];
    if (!p.length) return;

    // if you ever had a timer pending, cancel it before committing
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    await commitPendingFromRef();
  }, [commitPendingFromRef]);

  // -------------------------
  // ✅ Shared handler for BOTH manual taps and AutoDarts
  // -------------------------
  const commitTimerRef = useRef<any>(null);
  const lastAutoAtRef = useRef(0);
  const MIN_AUTO_DART_GAP_MS = 160;

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (autoConnTimerRef.current) clearTimeout(autoConnTimerRef.current);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  type EntrySource = "manual" | "auto";

  // ✅ pushes an entry and updates overlay per the rules
  const pushPendingEntry = useCallback(
    (entry: PendingEntry, source: EntrySource, opts?: { timedMs?: number }) => {
      setPending((p) => {
        if (p.length >= 3) return p;

        undoneEntriesRef.current = [];
        undoneMarkersRef.current = [];

        const next = [...p, entry];
        const sNow = stateRef.current;
const text = pendingLabel(entry, sNow, sNow.turn);

        if (source === "auto") {
          if (typeof opts?.timedMs === "number") {
            showOverlayTimed(text, opts.timedMs);
          } else {
            showOverlayHold(text);
          }
        } else {
          showOverlayHold(text);
        }

        return next;
      });
    },
    [showOverlayHold, showOverlayTimed]
  );

  const pushPendingHit = useCallback(
    (hit: PendingHit, source: EntrySource, opts?: { timedMs?: number }) => {
      pushPendingEntry({ kind: "HIT", hit }, source, opts);
    },
    [pushPendingEntry]
  );

  const handleRingManual = useCallback(
    (ring: Ring) => {
      if (winner.winnerIdx !== null) return;
      if (pendingRef.current.length >= 3) return;
      if (!lockScoringTap()) return;

      // if you were waiting for board clear, a manual dart should override that
      awaitingClearRef.current = false;

      playHit();

      const sNow = stateRef.current;
const mapped = ringToCricketHit(ring, sNow.targets);
const mappedNorm = normalizeDeadHit(sNow, mapped);

      // D/T choice logic (manual): store CHOICE, prompt only when "Done"
      if ((ring.kind === "D" || ring.kind === "T") && typeof (ring as any).n === "number") {
        const n = (ring as any).n as number;

        const sNow = stateRef.current;

        const numIdx = sNow.targets.findIndex((x) => x === n);
        const numberInGame = numIdx >= 0;
        const numberDead = numberInGame ? isDeadTargetIndex(sNow, numIdx) : false;

        const specialTarget: CricketTarget = ring.kind === "D" ? "D" : "T";
        const specialIdx = sNow.targets.findIndex((x) => x === specialTarget);
        const specialInGame = specialIdx >= 0;
        const specialDead = specialInGame ? isDeadTargetIndex(sNow, specialIdx) : false;

        if (!specialInGame) {
          pushPendingHit(mappedNorm, "manual");
          return;
        }

        const asNumber: PendingHit = { target: n, mult: ring.kind === "D" ? 2 : 3 };

        const asSpecial: PendingHit = {
          target: specialTarget,
          mult: 1,
          sourceNumber: n,
          sourceMultiplier: ring.kind === "D" ? 2 : 3,
        };

        if (!numberInGame && !specialDead) {
  pushPendingHit(asSpecial, "manual");
  return;
}

if (numberDead && !specialDead) {
  pushPendingHit(asSpecial, "manual");
  return;
}

// ✅ BOTH DEAD => No Score (MANUAL)
if (numberDead && specialDead) {
  pushPendingHit({ target: NO_SCORE_TARGET, mult: 1 }, "manual");
  return;
}

if (numberInGame && !numberDead && !specialDead) {
  pushPendingEntry({ kind: "CHOICE", ringKind: ring.kind, n, asNumber, asSpecial }, "manual");
  return;
}

// special dead -> treat as number
pushPendingHit(asNumber, "manual");
return;

      }

      pushPendingHit(normalizeDeadHit(stateRef.current, mapped), "manual");
    },
    [winner.winnerIdx, lockScoringTap, playHit, pushPendingEntry, pushPendingHit]
  );

  // ✅ Auto commit scheduler
  // - Normal: only commit once we have 3 darts
  // - Force: commit as soon as we have >=1 (for EAGLE)
  const scheduleCommit = useCallback(
    (delayMs: number, force: boolean) => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);

      commitTimerRef.current = setTimeout(async () => {
        commitTimerRef.current = null;

        const n = pendingRef.current?.length ?? 0;
        if (force) {
          if (n >= 1) await commitPendingFromRef();
        } else {
          if (n >= 3) await commitPendingFromRef();
        }
      }, delayMs);
    },
    [commitPendingFromRef]
  );

  const handleAutoThrow = useCallback(
    (t: AutoDartsThrow) => {
      if (completeRef.current) return;

          // ✅ IMPORTANT: flip to BOARD as soon as a throw arrives
    if (modeRef.current === "LEADER") setMode("BOARD");

      // require the board to be cleared between turns
      if (awaitingClearRef.current) {
  // allow the first real throw to start the next turn
  awaitingClearRef.current = false;
}


      const now = Date.now();
      if (now - lastAutoAtRef.current < MIN_AUTO_DART_GAP_MS) return;
      lastAutoAtRef.current = now;

      playHit();

      const ring = autoThrowToRing(t);

      // marker (best-effort)
      const x = (t as any)?.coords?.x;
      const y = (t as any)?.coords?.y;
      if (typeof x === "number" && typeof y === "number") {
        setHitMarkers((prev) => [...prev, { x, y }].slice(0, 3));
      }

      const sNow = stateRef.current;
const mapped = ringToCricketHit(ring as any, sNow.targets);
const mappedNorm = normalizeDeadHit(sNow, mapped);

      const nextLen = (pendingRef.current?.length ?? 0) + 1;
      const eagle = isEagleThrow(t);
      const isFinalDart = nextLen === 3;

      // overlay rule for auto:
// Overlay rule for auto:
// - always HOLD (no timer)
// - it will disappear when we commit on Takeout -> Throw (clearPending hides it)
const autoOverlayOpts = undefined;


      // ✅ Auto: if D/T needs choice, store CHOICE (don’t prompt yet)
      if ((ring as any).kind === "D" || (ring as any).kind === "T") {
        const kind = (ring as any).kind as "D" | "T";
        const n = (ring as any).n as number | undefined;

        if (typeof n === "number") {
          const numIdx = sNow.targets.findIndex((x) => x === n);
          const numberInGame = numIdx >= 0;
          const numberDead = numberInGame ? isDeadTargetIndex(sNow, numIdx) : false;

          const specialTarget: CricketTarget = kind === "D" ? "D" : "T";
          const specialIdx = sNow.targets.findIndex((x) => x === specialTarget);
          const specialInGame = specialIdx >= 0;
          const specialDead = specialInGame ? isDeadTargetIndex(sNow, specialIdx) : false;

          if (!specialInGame) {
            pushPendingHit(mappedNorm, "auto", autoOverlayOpts);
          } else if (!numberInGame && !specialDead) {
            pushPendingHit(
              { target: specialTarget, mult: 1, sourceNumber: n, sourceMultiplier: kind === "D" ? 2 : 3 },
              "auto",
              autoOverlayOpts
            );
          } else if (numberDead && !specialDead) {
            pushPendingHit(
              { target: specialTarget, mult: 1, sourceNumber: n, sourceMultiplier: kind === "D" ? 2 : 3 },
              "auto",
              autoOverlayOpts
            );
          } else if (numberInGame && !numberDead && !specialDead) {
            pushPendingEntry(
              {
                kind: "CHOICE",
                ringKind: kind,
                n,
                asNumber: { target: n, mult: kind === "D" ? 2 : 3 },
                asSpecial: {
                  target: specialTarget,
                  mult: 1,
                  sourceNumber: n,
                  sourceMultiplier: kind === "D" ? 2 : 3,
                },
              },
              "auto",
              autoOverlayOpts
            );
          } else {
            pushPendingHit({ target: n, mult: kind === "D" ? 2 : 3 }, "auto", autoOverlayOpts);
          }
        } else {
          pushPendingHit(mappedNorm, "auto", autoOverlayOpts);
        }
      } else {
        pushPendingHit(mappedNorm, "auto", autoOverlayOpts);
      }
    },
    [pushPendingEntry, pushPendingHit, scheduleCommit, playHit]
  );

  // -------------------------
  // ✅ AutoDarts wiring
  // -------------------------
  const { forceBoardReset } = useAutoDarts({
    url: AUTO_WS_URL,
    baseUrl: AUTO_BASE_URL,
    enabled: hydrated && winner.winnerIdx === null,
    debug: true,

    onStatus: (s: AutoDartsStatus) => {
      noteAutoAlive();

      const nextStatus = String(s?.status ?? "");
      const nextNum = Number(s?.numThrows ?? 0);

      setAutoStatus(nextStatus);
      setAutoNumThrows(nextNum);

      // awaiting clear gate: once we see 0 throws, allow new throws
      if (awaitingClearRef.current) {
        if (!Number.isFinite(nextNum) || nextNum === 0) {
          awaitingClearRef.current = false;
        }
      }

      // ✅ Takeout -> Throw => commit pending (like Golf/Match)
      const prev = String(prevAutoStatusRef.current ?? "");
      const prevL = prev.toLowerCase();
      const nextL = nextStatus.toLowerCase();
      const wasTakeout = prevL.includes("takeout");
      const isThrow = nextL === "throw" || nextL.includes("throw");

      prevAutoStatusRef.current = nextStatus;

      if (wasTakeout && isThrow) {
        commitIfReadyFromStatus();
      }
    },

    onThrow: (t: AutoDartsThrow) => {
      noteAutoAlive();
      handleAutoThrow(t);
    },
  });

  // =========================
  // AutoDarts: Reset + Restart buttons
  // =========================
const resetAutoDartsHard = useCallback(async () => {
  if (autoResetting) return;
  setAutoResetting(true);
  try {
    await forceBoardReset();
  } catch (e) {
    console.warn("[AutoDarts] reset failed", e);
  } finally {
    setAutoResetting(false);
  }
}, [autoResetting, forceBoardReset]);

const restartAutoDartsHard = useCallback(async () => {
  if (autoResetting) return;
  setAutoResetting(true);
  try {
    const root = String(AUTO_BASE_URL ?? "").replace(/\/+$/, "");
    const url = `${root}/api/start`;
    await fetch(url, { method: "PUT" });
    noteAutoAlive();
  } catch (e) {
    console.warn("[AutoDarts] restart failed", e);
  } finally {
    setAutoResetting(false);
  }
}, [autoResetting, noteAutoAlive]);



  const [leaderH, setLeaderH] = useState(0);

  const playersN = Math.max(1, state.players.length);
  const rowsN = 1 + 1 + orderedTargets.length + 1;

  const pad = ui.sidePadding;
  const gap = ui.gap;

  const usableLeaderH = Math.max(0, leaderH - pad * 2);
  const rowsToShow = isLandscape ? 8 : rowsN;
  const rowH = clamp(
    Math.floor(usableLeaderH / Math.max(1, rowsToShow)),
    isLandscape ? (isLarge ? 36 : 32) : (isLarge ? 56 : 48),
    isLandscape ? (isLarge ? 64 : 56) : (isLarge ? 98 : 84)
  );

  const usableW = screenWidth - pad * 2;
  const targetW = ui.targetW;

  const usableForPlayers = Math.max(0, usableW - targetW - gap);
  const computedCellW = Math.floor((usableForPlayers - gap * (playersN - 1)) / playersN);
  const cellW = clamp(computedCellW, isLarge ? 120 : 104, isLarge ? 280 : 220);

  if (mode === "BOARD") {
    const doneDisabled = winner.winnerIdx !== null || pending.length === 0;
    const turnName = winner.winnerIdx !== null ? "—" : playerName(state.players[state.turn]);

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.full}>
          <View style={styles.topBar}>
            <View style={styles.topBarRow}>
              <Pressable style={styles.exitLink} onPress={onExitGame}>
                <Text style={styles.exitLinkText}>‹ Cricket Setup</Text>
              </Pressable>
              <View
                style={[
                  { flex: 1, marginLeft: 10 },
                  isLandscape
                    ? { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }
                    : { gap: 6 },
                ]}
              >
                <Text style={[styles.title, { fontSize: ui.title }]}>Cricket</Text>
                <Text
                  style={[styles.sub, { fontSize: ui.sub }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {winner.winnerIdx !== null
                    ? `🏁 Complete • Winner: ${playerName(state.players[winner.winnerIdx])}`
                    : `Throwing: ${turnName}`}
                </Text>
              </View>

              {/* RIGHT: Reset, Restart, Dot */}
              <View style={styles.autoRightGroup}>
                <Pressable
                  style={[styles.autoResetBtn, autoResetting && { opacity: 0.5 }]}
                  disabled={autoResetting}
                  onPress={resetAutoDartsHard}
                >
                  <Text style={styles.autoResetText}>{resetLabel}</Text>
                </Pressable>

                <Pressable
                  style={[styles.autoRestartBtn, autoResetting && { opacity: 0.5 }]}
                  disabled={autoResetting}
                  onPress={restartAutoDartsHard}
                >
                  <Text style={styles.autoRestartText}>Restart</Text>
                </Pressable>

                <View style={[styles.autoDot, autoConnected ? styles.autoDotOn : styles.autoDotOff]} />
              </View>
            </View>
          </View>

          <View style={[styles.center, { padding: isLarge ? 10 : 6 }]}>
            <View style={{ position: "relative" }}>
              <Dartboard
                size={ui.boardSize}
                disabled={winner.winnerIdx !== null}
                inputDisabled={winner.winnerIdx !== null || pending.length >= 3}
                hitMarkers={hitMarkers}
                onHitMarker={(pt) => setHitMarkers((prev) => [...prev, pt].slice(0, 3))}
                onDart={() => {}}
                onDartDetail={(ring: Ring) => {
                  handleRingManual(ring);
                }}
                showLast={false}
              />

              {overlayText && (
  <View style={styles.overlayWrap}>
    {(() => {
      const text = String(overlayText);
      const match = text.match(/^(.+)\s(\(\d+\))$/);
      const isSmallOverlay = text === "Treble" || text === "Double" || text === "No Score" || (match && (match[1] === "Treble" || match[1] === "Double" || match[1] === "No Score"));
      const textStyle = isSmallOverlay ? [styles.overlayText, styles.overlayTextSmall] : styles.overlayText;

      if (!match) {
        return (
          <Text style={textStyle}>
            {text}
          </Text>
        );
      }

      return (
        <>
          <Text style={textStyle}>
            {match[1]}
          </Text>
          <Text style={isSmallOverlay ? [styles.overlaySubText, styles.overlaySubTextSmall] : styles.overlaySubText}>
            {match[2]}
          </Text>
        </>
      );
    })()}
  </View>
)}

            </View>
          </View>

          <View
            style={[
              styles.bottomBar,
              { paddingBottom: (isLarge ? 18 : 12) + (Platform.OS === "ios" ? 6 : 0) },
            ]}
          >
            <View style={styles.dartsRow}>
              {Array.from({ length: 3 }).map((_, i) => (
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
                  <Text style={[styles.dartPillText, { fontSize: ui.pillText }]}>
                    {pendingLabel(pending[i] ?? null, state, state.turn)}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.buttonsRowBoard}>
              <Pressable
                style={[styles.btnBoard, styles.btnFill, { paddingVertical: ui.btnPadV }]}
                onPress={() => {
                  if (commitTimerRef.current) {
                    clearTimeout(commitTimerRef.current);
                    commitTimerRef.current = null;
                  }

                  if (pending.length > 0) {
                    undoneEntriesRef.current = [...undoneEntriesRef.current, pending[pending.length - 1]];
                    undoneMarkersRef.current = [...undoneMarkersRef.current, hitMarkers[hitMarkers.length - 1] ?? null];
                    setPending((p) => p.slice(0, -1));
                    setHitMarkers((m) => m.slice(0, -1));
                    const newLength = pending.length - 1;
                    if (newLength >= 1) {
                      const sNow = stateRef.current;
                      showOverlayHold(pendingLabel(pending[newLength - 1], sNow, sNow.turn));
                    } else {
                      hideOverlay();
                    }
                  } else {
                    undoneEntriesRef.current = [];
                    undoneMarkersRef.current = [];
                    hideOverlay();
                    setState((s) => undo(s));
                    resetAutoForNewTurn();
                  }
                }}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Undo</Text>
              </Pressable>

              <Pressable
                style={[styles.btnBoard, styles.btnFill, { paddingVertical: ui.btnPadV }]}
                onPress={() => {
                  const stack = undoneEntriesRef.current;
                  if (stack.length > 0 && pending.length < 3) {
                    const entry = stack[stack.length - 1];
                    const markers = undoneMarkersRef.current;
                    const marker = markers.length > 0 ? markers[markers.length - 1] : null;
                    undoneEntriesRef.current = stack.slice(0, -1);
                    undoneMarkersRef.current = markers.slice(0, -1);
                    setPending((p) => [...p, entry]);
                    if (marker != null) {
                      setHitMarkers((m) => [...m, marker].slice(0, 3));
                    }
                    const sNow = stateRef.current;
                    showOverlayHold(pendingLabel(entry, sNow, sNow.turn));
                  } else {
                    setState((s) => redo(s));
                    resetAutoForNewTurn();
                  }
                }}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Redo</Text>
              </Pressable>

              <Pressable
                style={[styles.btnBoard, styles.btnFill, { paddingVertical: ui.btnPadV }]}
                onPress={() => {
                  setViewedViaPeek(true);
                  setMode("LEADER");
                }}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Peek</Text>
              </Pressable>


              <Pressable
                style={[styles.btnBoard, styles.btnFill, { paddingVertical: ui.btnPadV }]}
                disabled={winner.winnerIdx !== null}
                onPress={endTurnNoScoreFromBoard}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>No Score</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.btnBoard,
                  styles.btnFill,
                  { paddingVertical: ui.btnPadV },
                  doneDisabled && styles.btnDisabled,
                ]}
                disabled={doneDisabled}
                onPress={commitPending}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const activePlayerIdx = winner.winnerIdx === null ? state.turn : -1;
  const markSize = clamp(Math.floor(rowH * 0.92), isLarge ? 34 : 30, isLarge ? 72 : 62);
  const scoreFont = clamp(Math.floor(rowH * 0.92), isLarge ? 18 : 16, isLarge ? 40 : 26);
  const rewardsFont = clamp(Math.floor(rowH * 0.38), isLarge ? 14 : 12, isLarge ? 28 : 20);

  const rewardsRow = Array.isArray(state.rewardsRow) ? state.rewardsRow : Array(playersN).fill("—");

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.full}>
        <View style={styles.topBar}>
          <View style={styles.topBarRow}>
            <Pressable style={styles.exitLink} onPress={onExitGame}>
              <Text style={styles.exitLinkText}>‹ Cricket Setup</Text>
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, marginLeft: 10, flexWrap: "wrap" }}>
              <Text style={[styles.title, { fontSize: ui.title }]}>Scoreboard</Text>
              <Text style={[styles.sub, { fontSize: ui.sub }]} numberOfLines={1} ellipsizeMode="tail">
                {winner.winnerIdx !== null
                  ? `🏁 Complete • Winner: ${playerName(state.players[winner.winnerIdx])}`
                  : `Up next: ${playerName(state.players[state.turn])}`}
              </Text>
            </View>

               {/* RIGHT: Reset + Restart + Dot */}
                        <View style={styles.autoRightGroup}>
                          <Pressable
                            style={[styles.autoResetBtn, autoResetting && { opacity: 0.5 }]}
                            disabled={autoResetting}
                            onPress={resetAutoDartsHard}
                          >
                            <Text style={styles.autoResetText}>{resetLabel}</Text>
                          </Pressable>
            
                          <Pressable
  style={[styles.autoRestartBtn, autoResetting && { opacity: 0.5 }]}
  disabled={autoResetting}
  onPress={restartAutoDartsHard}
>
  <Text style={styles.autoRestartText}>Restart</Text>
</Pressable>
            
                          <View style={[styles.autoDot, autoConnected ? styles.autoDotOn : styles.autoDotOff]} />
                        </View>
                      </View>
                    </View>

        <View
          style={{ flex: 1 }}
          onLayout={(e) => setLeaderH(e.nativeEvent.layout.height)}
        >
          <View style={[styles.tableWrap, { padding: pad, flex: 1, minHeight: 0 }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={[styles.tr, styles.thRow, { marginBottom: gap }]}>
                  <View
                    style={[
                      styles.cellTarget,
                      styles.cellHeader,
                      { width: targetW, padding: ui.cellPad, height: rowH, marginRight: gap },
                    ]}
                  >
                    <Text style={[styles.thText, { fontSize: ui.th }]}>Target</Text>
                  </View>

                  {state.players.map((p, idx) => {
                    const isActive = idx === activePlayerIdx;
                    const isLast = idx === playersN - 1;
                    const elim = !!p?.eliminated;

                    return (
                      <View
                        key={`h-${idx}`}
                        style={[
                          styles.cell,
                          styles.cellHeader,
                          {
                            width: cellW,
                            padding: ui.cellPad,
                            height: rowH,
                            marginRight: isLast ? 0 : gap,
                          },
                          isActive && styles.cellHeaderActive,
                          elim && styles.cellEliminated,
                        ]}
                      >
                        <Text
                          style={[
                            styles.thText,
                            { fontSize: isActive ? ui.thFocus : ui.th },
                            elim && styles.elimText,
                          ]}
                          numberOfLines={1}
                        >
                          {playerName(p)}
                        </Text>

                        {elim && <Text style={styles.elimPill}>ELIM</Text>}
                      </View>
                    );
                  })}
                </View>

                <View style={[styles.tr, { marginBottom: gap }]}>
                  <View style={[styles.cellTarget, { width: targetW, padding: ui.cellPad, height: rowH, marginRight: gap }]}>
                    <Text style={[styles.tdText, { fontSize: ui.tdFocus }]}>Score</Text>
                  </View>

                  {state.players.map((p, idx) => {
                    const isLast = idx === playersN - 1;
                    return (
                      <View
                        key={`s-${idx}`}
                        style={[
                          styles.cell,
                          { width: cellW, padding: ui.cellPad, height: rowH, marginRight: isLast ? 0 : gap },
                        ]}
                      >
                        <Text style={[styles.tdText, { fontSize: scoreFont }]}>{String(playerScore(p))}</Text>
                      </View>
                    );
                  })}
                </View>

                <ScrollView style={{ maxHeight: usableLeaderH }} showsVerticalScrollIndicator>
                  {orderedTargets.map((t, rowIdx) => {
                    const ti = state.targets.findIndex((x) => x === t);

                    return (
                      <View key={`${String(t)}-${rowIdx}`} style={[styles.tr, { marginBottom: gap }]}>
                        <View style={[styles.cellTarget, { width: targetW, padding: ui.cellPad, height: rowH, marginRight: gap }]}>
                          <Text style={[styles.tdText, { fontSize: ui.tdFocus }]}>{labelForTarget(t)}</Text>
                        </View>

                        {state.players.map((p, pIdx) => {
                          const marksRow = playerMarks(p);
                          const m = ti >= 0 ? (marksRow[ti] ?? 0) : 0;

                          const isActive = pIdx === activePlayerIdx;
                          const isLast = pIdx === playersN - 1;

                          const markCellPad = Math.max(4, Math.floor(ui.cellPad * 0.35));

                          return (
                            <View
                              key={`${String(t)}-${pIdx}`}
                              style={[
                                styles.cell,
                                {
                                  width: cellW,
                                  padding: markCellPad,
                                  height: rowH,
                                  marginRight: isLast ? 0 : gap,
                                },
                                isActive && styles.cellActive,
                              ]}
                            >
                              <MarkGlyph marks={m} size={markSize} active={isActive} />
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={[styles.tr, styles.totalRow, { marginTop: gap }]}>
                  <View
                    style={[
                      styles.cellTarget,
                      styles.cellHeader,
                      styles.rewardCell,
                      { width: targetW, height: rowH, marginRight: gap },
                    ]}
                  >
                    <Text style={[styles.thText, { fontSize: ui.th }]}>Rewards</Text>
                  </View>

                  {state.players.map((_, idx) => {
                    const isLast = idx === playersN - 1;
                    return (
                      <View
                        key={`r-${idx}`}
                        style={[
                          styles.cell,
                          styles.cellHeader,
                          styles.rewardCell,
                          { width: cellW, height: rowH, marginRight: isLast ? 0 : gap },
                        ]}
                      >
                        <Text style={[styles.thText, { fontSize: rewardsFont }]} numberOfLines={1}>
                          {rewardsRow[idx] ?? "—"}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>

        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: (isLarge ? 18 : 12) + (Platform.OS === "ios" ? 8 : 0) + (viewedViaPeek ? 24 : 0),
            },
          ]}
        >
          {viewedViaPeek ? (
            <Pressable
              style={[styles.btn, styles.btnThrow, { paddingVertical: ui.btnPadV, alignSelf: "stretch" }]}
              onPress={() => {
                setViewedViaPeek(false);
                setMode("BOARD");
              }}
            >
              <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Back to Dartboard</Text>
            </Pressable>
          ) : (
            <View style={[styles.buttonsRow, styles.buttonsRowWithThrow]}>
              <View style={styles.buttonsRowLeft}>
                <Pressable style={[styles.btn, styles.btnFill, { paddingVertical: ui.btnPadV }]} onPress={undoLastTurn}>
                  <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Undo</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnFill, { paddingVertical: ui.btnPadV }]}
                  onPress={() => {
                    hideOverlay();
                    clearPending();
                    setState((s) => redo(s));
                    resetAutoForNewTurn();
                  }}
                >
                  <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Redo</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnFill, { paddingVertical: ui.btnPadV }]}
                  disabled={winner.winnerIdx !== null}
                  onPress={endTurnFromScoreboard}
                >
                  <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Done</Text>
                </Pressable>
              </View>

              <Pressable
                style={[styles.btn, styles.btnFill, styles.btnThrow, { paddingVertical: ui.btnPadV }]}
                disabled={winner.winnerIdx !== null}
                onPress={() => {
                  setViewedViaPeek(false);
                  setMode("BOARD");
                }}
              >
                <Text style={[styles.btnText, { fontSize: ui.btnText }]}>Throw</Text>
              </Pressable>
            </View>
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
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "white",
    justifyContent: "center",
  },

  topBarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  exitLink: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  exitLinkText: { color: "#111827", fontWeight: "800", fontSize: 15 },

  autoDot: { width: 10, height: 10, borderRadius: 999 },
  autoDotOn: { backgroundColor: "#16A34A" },
  autoDotOff: { backgroundColor: "#9CA3AF" },

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

  buttonsRow: { flexDirection: "row", gap: 12, justifyContent: "center" },
  buttonsRowWithThrow: { justifyContent: "space-between" },
  buttonsRowLeft: { flexDirection: "row", gap: 12, flex: 3 },
  buttonsRowBoard: { flexDirection: "row", gap: 12, justifyContent: "center" },

  btn: { borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center" },
  btnThrow: { backgroundColor: "#16A34A" },
  btnBoard: { borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center" },

  btnText: { color: "white", fontWeight: "900" },
  btnDisabled: { opacity: 0.45 },
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

  tr: { flexDirection: "row" },
  thRow: {},

  cellTarget: {
    borderRadius: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  cell: {
    borderRadius: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },

  cellHeader: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  cellHeaderActive: { borderColor: "#2563EB", borderWidth: 3 },

  thText: { color: "white", fontWeight: "900" },
  tdText: { fontWeight: "900" },

  cellActive: { borderColor: "#2563EB", borderWidth: 3, backgroundColor: "#EEF2FF" },

  totalRow: {},

  cellEliminated: {
    opacity: 0.45,
    backgroundColor: "#4e555d",
    borderColor: "#CBD5E1",
  },
  elimText: {
    opacity: 0.9,
  },
  elimPill: {
    marginTop: 4,
    alignSelf: "center",
    color: "white",
    backgroundColor: "#000000",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontWeight: "900",
    overflow: "hidden",
    fontSize: 20,
  },

  autoRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  autoResetBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },

  autoResetText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },

    // ✅ NEW: Restart button styles (match Reset)
  autoRestartBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#0F172A",
  },
  autoRestartText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },

  overlayWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  overlayText: {
    color: "white",
    fontWeight: "900",
    fontSize: 120,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  overlayTextSmall: { fontSize: 88 },

  overlaySubText: {
  color: "white",
  fontWeight: "900",
  fontSize: 70,      // smaller than main text
  textAlign: "center",
  marginTop: 4,
},
  overlaySubTextSmall: { fontSize: 52 },

  btnFill: { flex: 1 },

  rewardCell: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
