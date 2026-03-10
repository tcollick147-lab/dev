// src/screens/MatchGameScreen.tsx
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import {
  createMatchState,
  applyDart,
  endTurn,
  backTurn,
  removeLastDart,
  isTurnReadyToCommit,
  type DartCode,
} from "../engine/matchEngine";

import Dartboard from "../components/Dartboard";

// ✅ Checkout chart
import { CHECKOUT_CHART, Bed } from "../data/checkoutCharts";
import { AUTO_BASE_URL, AUTO_WS_URL } from "../config/autodarts";

type Props = NativeStackScreenProps<RootStackParamList, "MatchGame">;

type HighlightTarget = number | "BULL" | null;

function computeMatchHighlightTarget(args: {
  remaining: number;
  outRule: "STRAIGHT" | "DOUBLE" | "MASTER";
}): HighlightTarget {
  const r = Number(args.remaining) || 0;
  const out = args.outRule;

  if (r === 50) return "BULL";

  if (out === "STRAIGHT") {
    if (r >= 1 && r <= 20) return r;
    return null;
  }

  if (r >= 2 && r <= 40 && r % 2 === 0) return r / 2;

  return null;
}

function toDartLabels(turnDarts: any): string[] {
  if (!Array.isArray(turnDarts)) return [];
  return turnDarts
    .filter((x) => x !== null && x !== undefined && x !== "")
    .slice(0, 3)
    .map((x) => String(x));
}

function bedToHighlightTarget(bed: Bed | null): HighlightTarget {
  if (!bed) return null;
  if (bed === "DBULL" || bed === "SBULL") return "BULL";

  const n = Number(String(bed).slice(1));
  if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
  return null;
}

// ✅ Works with any of your engine versions:
// - new: past
// - older: turnPast
// - oldest: history
function getTurnHistoryLen(state: any): number {
  if (!state) return 0;
  if (Array.isArray(state.past)) return state.past.length;
  if (Array.isArray(state.turnPast)) return state.turnPast.length;
  if (Array.isArray(state.history)) return state.history.length;
  return 0;
}

// =========================
// AutoDarts helpers
// =========================
type AutoDartsSegment = {
  name?: string; // e.g. "S20" or "Bull" or "M8" (miss near)
  number?: number; // e.g. 20 or 25
  bed?: string; // e.g. "SingleInner" / "SingleOuter" / "Double" / "Triple" / ...
  multiplier?: number; // 1/2/3
};

type AutoDartsThrow = {
  segment?: AutoDartsSegment;
  coords?: { x: number; y: number };
};

function segmentToDartCode(seg: AutoDartsSegment | undefined | null): DartCode | null {
  if (!seg) return null;

  const rawName = String(seg.name ?? "").trim();

  // ✅ Misses like "M8" should be MISS (NOT S8)
  if (rawName.toUpperCase().startsWith("M")) return "MISS";

  const n = Number(seg.number ?? NaN);
  const mult = Number(seg.multiplier ?? NaN);

  // Bull commonly comes through as: name:"Bull", number:25, bed:"Double"/"Single", multiplier:2/1
  if (rawName.toLowerCase() === "bull" || n === 25) {
    if (mult === 2) return "DB";
    return "SB";
  }

  // If name is already like S20 / D16 / T19
  const m = rawName.match(/^([SDT])\s*(\d{1,2})$/i);
  if (m) {
    const letter = m[1].toUpperCase() as "S" | "D" | "T";
    const num = Number(m[2]);
    if (Number.isFinite(num) && num >= 1 && num <= 20) {
      return `${letter}${num}` as DartCode;
    }
  }

  // Otherwise infer from number + multiplier
  if (Number.isFinite(n) && n >= 1 && n <= 20) {
    if (mult === 3) return `T${n}` as DartCode;
    if (mult === 2) return `D${n}` as DartCode;
    if (mult === 1) return `S${n}` as DartCode;
  }

  // Safe fallback
  return "MISS";
}

function keyFromAutoThrow(t: AutoDartsThrow | undefined | null): string {
  const seg = t?.segment ?? {};
  const coords = t?.coords;
  const name = String(seg.name ?? "");
  const num = String(seg.number ?? "");
  const mult = String(seg.multiplier ?? "");
  // coords can be noisy: round a bit so the same dart doesn’t “look different” every frame
  const x = coords?.x;
  const y = coords?.y;
  const rx = typeof x === "number" ? x.toFixed(3) : "";
  const ry = typeof y === "number" ? y.toFixed(3) : "";
  return `${name}|${num}|${mult}|${rx},${ry}`;
}

export default function MatchGameScreen({ route }: Props) {
  const { setup } = route.params;

  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const base = Math.min(screenWidth, screenHeight);
  const isLarge = base >= 900;

  // Board sizing: keep large
  const boardSize = useMemo(() => {
    const maxByWidth = screenWidth * (isLarge ? 0.76 : 0.96);
    const maxByHeight = screenHeight * (isLarge ? 0.7 : 0.6);
    return Math.min(maxByWidth, maxByHeight, isLarge ? 980 : 640);
  }, [screenWidth, screenHeight, isLarge]);

  // =========================
  // Rapid tap lock
  // =========================
  const TAP_LOCK_MS = 90;
  const tapLockedRef = useRef(false);

  const lockScoringTap = useCallback(() => {
    if (tapLockedRef.current) return false;
    tapLockedRef.current = true;
    setTimeout(() => {
      tapLockedRef.current = false;
    }, TAP_LOCK_MS);
    return true;
  }, []);

  // =========================
  // Sounds
  // =========================
  const [dartSound, setDartSound] = useState<Audio.Sound | null>(null);
  const [rewardSound, setRewardSound] = useState<Audio.Sound | null>(null);

  useEffect(() => {
    let mounted = true;
    let hit: Audio.Sound | null = null;
    let reward: Audio.Sound | null = null;

    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

        const hitRes = await Audio.Sound.createAsync(
          require("../../assets/sounds/dart_hit.mp3"),
          { shouldPlay: false, volume: 0.8 }
        );
        hit = hitRes.sound;
        if (mounted) setDartSound(hit);

        const rewardRes = await Audio.Sound.createAsync(
          require("../../assets/sounds/reward.mp3"),
          { shouldPlay: false, volume: 0.95 }
        );
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

  // =========================
  // Game state
  // =========================
  const [state, setState] = useState(() => {
    const s = createMatchState({
      playerNames: setup.players,
      startScore: setup.startScore,
      inRule: setup.inRule,
      outRule: setup.outRule,
    });
    return { ...s, side: { ...s.side, ...setup.side } };
  });

  // =========================
  // Marker dots
  // =========================
  const [hitMarkers, setHitMarkers] = useState<any[]>([]);
  const clearMarkers = useCallback(() => setHitMarkers([]), []);

  // =========================
  // Big overlay (Cricket-style)
  // =========================
  const [overlayText, setOverlayText] = useState<string | null>(null);

  const dartCodeToOverlayLabel = useCallback((d: DartCode | null): string => {
    if (!d) return "—";
    if (d === "MISS") return "No Score";
    if (d === "SB") return "25";
    if (d === "DB") return "50";

    const m = String(d).match(/^([SDT])(\d{1,2})$/i);
    if (m) {
      const letter = m[1].toUpperCase();
      const num = m[2];
      if (letter === "S") return `${num}`;
      return `${letter}${num}`;
    }
    return String(d);
  }, []);

  const showOverlay = useCallback((text: string) => {
    setOverlayText(text);
  }, []);

  const showOverlayForDart = useCallback(
    (d: DartCode | null) => {
      showOverlay(dartCodeToOverlayLabel(d));
    },
    [dartCodeToOverlayLabel, showOverlay]
  );

  const showBustOverlay = useCallback(() => {
    showOverlay("Bust");
  }, [showOverlay]);

  const clearOverlay = useCallback(() => setOverlayText(null), []);

// =========================
// Turn intro overlay (player + start score for the turn)
// =========================
const [turnIntro, setTurnIntro] = useState<{ name: string; start: number } | null>(null);

const showTurnIntro = useCallback((name: string, start: number) => {
  setTurnIntro({ name, start });
}, []);

const clearTurnIntro = useCallback(() => {
  setTurnIntro(null);
}, []);


  // =========================
  // Last turn per player
  // =========================
  const [lastTurnByPlayer, setLastTurnByPlayer] = useState<string[][]>(() =>
    setup.players.map(() => [])
  );

  const persistLastForIndex = useCallback((playerIndex: number, turnDarts: any) => {
    const darts = toDartLabels(turnDarts);
    if (!darts.length) return;
    setLastTurnByPlayer((prev) => {
      const next = prev.slice();
      next[playerIndex] = darts;
      return next;
    });
  }, []);

  // Reward sound: play when events count increases
  const prevEventsLenRef = useRef<number>(state.events?.length ?? 0);
  useEffect(() => {
    const prevLen = prevEventsLenRef.current;
    const nowLen = state.events?.length ?? 0;
    if (nowLen > prevLen) playReward();
    prevEventsLenRef.current = nowLen;
  }, [state.events?.length, playReward]);

  // =========================
  // AutoDarts wiring (turn advances ONLY when board is cleared)
  // =========================
  const autoCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [autoConnected, setAutoConnected] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string>("");
  const [autoNumThrows, setAutoNumThrows] = useState<number>(0);

  // Status memory
  const prevAutoStatusRef = useRef<string>("");

  // Per-turn de-dupe
  const seenThrowKeysRef = useRef<Set<string>>(new Set());

  // Manual turn-change / back / reset -> ignore until clear
  const awaitingClearRef = useRef<boolean>(false);

  // When AutoDarts enters TAKEOUT (player finished), we latch “pending advance”
  // and we only advance when the board becomes CLEAR (0 throws / throws empty / numThrows drops).
  const pendingAdvanceOnClearRef = useRef<boolean>(false);

  // Track last numThrows observed (helps “numThrows dropped” clear detection)
  const lastNumThrowsRef = useRef<number>(0);

  const resetSeenThrows = useCallback(() => {
    seenThrowKeysRef.current = new Set();
  }, []);

  const resetAutoForNewTurn = useCallback(() => {
    resetSeenThrows();
    pendingAdvanceOnClearRef.current = false;
    awaitingClearRef.current = false;
    lastNumThrowsRef.current = 0;
  }, [resetSeenThrows]);

  // If current player changes (manual or auto), reset per-turn state
  useEffect(() => {
    resetAutoForNewTurn();
  }, [state.currentIndex, resetAutoForNewTurn]);

  // Manual Next Turn button: still allowed, but then we MUST wait for clear before accepting new throws.
  const endTurnWithPersist = useCallback(() => {
    if (autoCommitTimerRef.current) {
      clearTimeout(autoCommitTimerRef.current);
      autoCommitTimerRef.current = null;
    }

    setState((s: any) => {
      if (!s || s.winnerIndex !== null) return s;

      let cur = s;

      // ✅ Force-finish the turn even if only 0/1/2 darts were thrown:
      while (!isTurnReadyToCommit(cur) && cur.turnDarts.length < 3) {
        cur = applyDart(cur, "MISS");
      }

      persistLastForIndex(cur.currentIndex, cur.turnDarts);

      clearMarkers();
      clearOverlay();

      const advanced = endTurn(cur);

      // require clear before next player's throws (important for AutoDarts)
      resetAutoForNewTurn();

      return advanced;
    });
  }, [persistLastForIndex, clearMarkers, clearOverlay, resetAutoForNewTurn]);

  // ✅ Winner-safe back: undo the finishing turn
  const backFromWinner = useCallback(() => {
    if (autoCommitTimerRef.current) {
      clearTimeout(autoCommitTimerRef.current);
      autoCommitTimerRef.current = null;
    }

    clearMarkers();
    clearOverlay();

    setState((s: any) => {
      if (!s) return s;

      const rolled = backTurn(s);

      // after back-turn, ignore WS snapshots until the board clears
      awaitingClearRef.current = true;
      pendingAdvanceOnClearRef.current = false;
      seenThrowKeysRef.current = new Set();
      lastNumThrowsRef.current = 0;

      return rolled;
    });
  }, [clearMarkers, clearOverlay]);

  // =========================
  // AutoDarts: Reset + Restart buttons
  // =========================
  const [autoResetting, setAutoResetting] = useState(false);

  const resetAutoDartsHard = useCallback(async () => {
    if (autoResetting) return;
    setAutoResetting(true);
    try {
      await fetch(`${AUTO_BASE_URL}/api/reset`, { method: "POST" });
      clearMarkers();
      clearOverlay();
      awaitingClearRef.current = true;
      pendingAdvanceOnClearRef.current = false;
      resetSeenThrows();
    } catch (e) {
      console.log("AutoDarts reset failed", e);
    } finally {
      setAutoResetting(false);
    }
  }, [AUTO_BASE_URL, autoResetting, clearMarkers, clearOverlay, resetSeenThrows]);

  const restartAutoDartsHard = useCallback(async () => {
    if (autoResetting) return;
    setAutoResetting(true);
    try {
      await fetch(`${AUTO_BASE_URL}/api/start`, { method: "PUT" });
      clearMarkers();
      clearOverlay();
      awaitingClearRef.current = true;
      pendingAdvanceOnClearRef.current = false;
      resetSeenThrows();
    } catch (e) {
      console.log("AutoDarts restart failed", e);
    } finally {
      setAutoResetting(false);
    }
  }, [AUTO_BASE_URL, autoResetting, clearMarkers, clearOverlay, resetSeenThrows]);

  // WS connect once
  useEffect(() => {
    const ws = new WebSocket(AUTO_WS_URL);

    ws.onopen = () => setAutoConnected(true);
    ws.onclose = () => setAutoConnected(false);
    ws.onerror = () => setAutoConnected(false);

    ws.onmessage = (e) => {
      let msg: any = null;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!msg || msg.type !== "state") return;

      const data = msg.data ?? {};

      const nextStatus = String(data.status ?? "");
      const nextNum = Number(data.numThrows ?? 0);

      setAutoStatus((prev) => (prev === nextStatus ? prev : nextStatus));
      setAutoNumThrows((prev) => (prev === nextNum ? prev : nextNum));

      const prevStatus = String(prevAutoStatusRef.current ?? "");
      const nextL = nextStatus.toLowerCase();

      const isTakeoutNow = nextL.includes("takeout");
      // (kept for debugging/telemetry if needed)
      void prevStatus;

      prevAutoStatusRef.current = nextStatus;

      const numThrows = Number(data.numThrows ?? 0);
const throwsArr: AutoDartsThrow[] = Array.isArray(data.throws) ? data.throws : [];

// ✅ if any darts are present, hide the "turn intro" overlay
const hasThrows =
  Number.isFinite(numThrows) && numThrows > 0 && throwsArr.length > 0;

if (hasThrows) clearTurnIntro();

const prevNumThrows = lastNumThrowsRef.current;
if (Number.isFinite(numThrows)) lastNumThrowsRef.current = numThrows;

// A "clear" snapshot = darts removed / board empty
const cleared =
  !Number.isFinite(numThrows) ||
  numThrows === 0 ||
  throwsArr.length === 0 ||
  (Number.isFinite(prevNumThrows) && Number.isFinite(numThrows) && numThrows < prevNumThrows);


      setState((prev: any) => {
        // If game ended, freeze WS scoring (but allow manual "Back" via backFromWinner)
        if (!prev || prev.winnerIndex !== null) return prev;

        let cur = prev;

        // 1) If we manually advanced/reset/backed, ignore until clear
        if (awaitingClearRef.current) {
          if (cleared) {
            awaitingClearRef.current = false;
            resetSeenThrows();
          } else {
            return cur;
          }
        }

        // 2) Always apply NEW throws first (even if status is TAKEOUT)
        if (Number.isFinite(numThrows) && numThrows > 0 && throwsArr.length > 0) {
          if (!(Array.isArray(cur.turnDarts) && cur.turnDarts.length >= 3)) {
            const newThrows: AutoDartsThrow[] = [];
            for (let i = 0; i < throwsArr.length; i++) {
              const k = keyFromAutoThrow(throwsArr[i]);
              if (!k) continue;
              if (!seenThrowKeysRef.current.has(k)) newThrows.push(throwsArr[i]);
            }

            for (const t of newThrows) {
              if (cur.winnerIndex !== null) break;
              if (cur.turnBusted) break;
              if (cur.turnDarts.length >= 3) break;

              const k = keyFromAutoThrow(t);
              const code = segmentToDartCode(t?.segment);

              if (k) seenThrowKeysRef.current.add(k);
              if (!code) continue;


              const beforeBusted = !!cur.turnBusted;
              const next = applyDart(cur, code);

              if (!beforeBusted && !!next.turnBusted) showBustOverlay();
              else showOverlayForDart(code);

              cur = next;
              playHit();
            }
          }
        }

        // 3) TAKEOUT means "turn is done" — latch pendingAdvance
        if (isTakeoutNow) {
          const hasAnyDart = Array.isArray(cur.turnDarts) && cur.turnDarts.length > 0;
          if (hasAnyDart) pendingAdvanceOnClearRef.current = true;
        }

        // 4) If pending and board is cleared -> advance
        if (pendingAdvanceOnClearRef.current && cleared) {
          const hasAnyDart = Array.isArray(cur.turnDarts) && cur.turnDarts.length > 0;
          if (hasAnyDart) {
            persistLastForIndex(cur.currentIndex, cur.turnDarts);

            clearMarkers();
            clearOverlay();

            cur = endTurn(cur);

            pendingAdvanceOnClearRef.current = false;
            resetSeenThrows();
            lastNumThrowsRef.current = 0;

            return cur;
          } else {
            pendingAdvanceOnClearRef.current = false;
          }
        }

        // 5) Never auto-advance just because 2/3 darts thrown.
        return cur;
      });
    };

    return () => {
      try {
        ws.close();
      } catch {}
      if (autoCommitTimerRef.current) {
        clearTimeout(autoCommitTimerRef.current);
        autoCommitTimerRef.current = null;
      }
    };
  }, [
    AUTO_WS_URL,
    playHit,
    showOverlayForDart,
    showBustOverlay,
    clearMarkers,
    clearOverlay,
    persistLastForIndex,
    resetSeenThrows,
      clearTurnIntro,
  ]);

  // =========================
  // Derived UI
  // =========================
  const current = state.players[state.currentIndex];
  const winnerPlayer = state.winnerIndex !== null ? state.players[state.winnerIndex] : null;
  const winnerName = winnerPlayer?.name ?? null;

  useEffect(() => {
  if (winner) {
    clearTurnIntro();
    return;
  }
  showTurnIntro(current.name, Number(current.remaining ?? 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [state.currentIndex, winnerName, showTurnIntro, clearTurnIntro]);


  // =========================
  // AutoDarts reset button state
  // =========================
  const isTakeout = useMemo(() => autoStatus.toLowerCase().includes("takeout"), [autoStatus]);

  const resetLabel = useMemo(() => {
    if (autoResetting) return "Resetting…";
    if (isTakeout) return "Reset (Takeout)";
    if (autoNumThrows === 1) return "Reset (1/3)";
    if (autoNumThrows === 2) return "Reset (2/3)";
    if (autoNumThrows >= 3) return "Reset (3/3)";
    return "Reset";
  }, [autoResetting, isTakeout, autoNumThrows]);

  const restartLabel = useMemo(() => {
    if (autoResetting) return "Working…";
    const s = autoStatus.toLowerCase();
    if (s.includes("stopped")) return "Restart (Stopped)";
    return "Restart";
  }, [autoResetting, autoStatus]);

  const resetBtnExtraStyle = useMemo(() => {
    if (isTakeout) return styles.autoResetBtnDanger;
    if (autoNumThrows === 1 || autoNumThrows === 2) return styles.autoResetBtnWarn;
    return null;
  }, [isTakeout, autoNumThrows]);

  // Checkout UI only for STRAIGHT-in + DOUBLE-out
  const checkoutUiEnabled = useMemo(() => {
    return setup.inRule === "STRAIGHT" && setup.outRule === "DOUBLE";
  }, [setup.inRule, setup.outRule]);

  const checkoutRoute = useMemo(() => {
    if (!checkoutUiEnabled) return null;

    const remaining = Number(current?.remaining ?? 0);
    if (!remaining || remaining < 2) return null;

    const route = CHECKOUT_CHART[remaining];
    if (!route || route.length === 0) return null;

    return route.slice(0, 3);
  }, [checkoutUiEnabled, current?.remaining]);

  const checkoutText = useMemo(() => {
    if (!checkoutUiEnabled) return "—";
    if (!checkoutRoute || checkoutRoute.length === 0) return "—";
    return checkoutRoute
      .map((b) => (b === "DBULL" ? "BULL" : b === "SBULL" ? "25" : b))
      .join(" • ");
  }, [checkoutUiEnabled, checkoutRoute]);

  const highlightBeds = useMemo(() => {
    if (!checkoutUiEnabled) return [];
    if (!checkoutRoute || checkoutRoute.length === 0) return [];
    return checkoutRoute;
  }, [checkoutUiEnabled, checkoutRoute]);

  const checkoutHighlightTarget = useMemo(() => {
    const nextBed = highlightBeds[0] ?? null;
    return bedToHighlightTarget(nextBed);
  }, [highlightBeds]);

  const highlightTarget = useMemo(() => {
    if (checkoutHighlightTarget) return checkoutHighlightTarget;
    return computeMatchHighlightTarget({
      remaining: current?.remaining ?? 0,
      outRule: setup.outRule,
    });
  }, [checkoutHighlightTarget, current?.remaining, setup.outRule]);

  // Button enabled logic
  const winner = !!winnerPlayer;
  const canBackspace = !winner && state.turnDarts.length > 0;
  const canBackTurn = !winner && getTurnHistoryLen(state as any) > 0;

  const inputDisabled = winner || state.turnDarts.length >= 3;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={[styles.h1, isLarge && stylesL.h1]}>Match</Text>

            {/* RIGHT: Reset, Restart, then dot */}
            <View style={styles.autoRight}>
              <Pressable
                style={[
                  styles.autoResetBtn,
                  resetBtnExtraStyle,
                  autoResetting && { opacity: 0.5 },
                ]}
                onPress={resetAutoDartsHard}
                disabled={autoResetting}
              >
                <Text style={styles.autoResetText}>{resetLabel}</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.autoRestartBtn,
                  autoResetting && { opacity: 0.5 },
                ]}
                onPress={restartAutoDartsHard}
                disabled={autoResetting}
              >
                <Text style={styles.autoResetText}>{restartLabel}</Text>
              </Pressable>

              <View style={[styles.autoDot, autoConnected ? styles.autoDotOn : styles.autoDotOff]} />
            </View>
          </View>

          <Text style={[styles.sub, isLarge && stylesL.sub]}>
            In: {setup.inRule} • Out: {setup.outRule} • Start: {setup.startScore}
          </Text>
        </View>

        <View style={[styles.card, isLarge && stylesL.card]}>
          {winner ? (
            <View>
              <Text style={[styles.winner, isLarge && stylesL.winner]}>
                🏆 Winner: {winnerName ?? "—"}
              </Text>
              <Text style={[styles.winnerSub, isLarge && stylesL.winnerSub]}>
                Rewards {state.tokens[state.winnerIndex as number]}
              </Text>
            </View>
          ) : (
            <View style={styles.topRow}>
              <Text
                style={[styles.turnTitle, isLarge && stylesL.turnTitle]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                Throwing: {current.name}
              </Text>

              {checkoutUiEnabled && checkoutText !== "—" ? (
                <Text
                  style={[styles.checkoutHuge, isLarge && stylesL.checkoutHuge]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                >
                  {checkoutText}
                </Text>
              ) : (
                <Text style={[styles.checkoutPlaceholder, isLarge && stylesL.checkoutPlaceholder]}>
                  {" "}
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.boardArea}>
          <View style={{ position: "relative" }}>
            <Dartboard
              size={boardSize}
              disabled={winner}
              inputDisabled={inputDisabled}
              highlightTarget={checkoutUiEnabled ? (highlightTarget as any) : null}
              highlightBeds={checkoutUiEnabled ? highlightBeds : []}
              hitMarkers={hitMarkers}
              showLast={false}
              onHitMarker={(pt: any) => {
                setHitMarkers((prev) => [...prev, pt].slice(-3));
              }}
              onDart={(dart: DartCode) => {
  if (winner) return;
  if (!lockScoringTap()) return;

  clearTurnIntro(); // ✅ hide intro on first dart

  if (autoCommitTimerRef.current) {
    clearTimeout(autoCommitTimerRef.current);
    autoCommitTimerRef.current = null;
  }

  playHit();

  setState((s: any) => {
    if (s.turnDarts.length >= 3) return s;

    const beforeBusted = !!s.turnBusted;
    const next = applyDart(s, dart);

    // ✅ Bust overlay takes priority
    if (!beforeBusted && !!next.turnBusted) showBustOverlay();
    else showOverlayForDart(dart);

    return next;
  });
}}

              onDartDetail={() => {}}
            />

            {!!turnIntro && !winner && (
  <View pointerEvents="none" style={styles.turnIntroWrap}>
    <Text style={[styles.turnIntroPlayer, isLarge && stylesL.turnIntroPlayer]}>
      {turnIntro.name}
    </Text>
    <Text style={[styles.turnIntroScore, isLarge && stylesL.turnIntroScore]}>
      {turnIntro.start}
    </Text>
  </View>
)}


            {overlayText && (
              <View style={styles.overlayWrap}>
                <Text style={[styles.overlayText, isLarge && stylesL.overlayText]}>
                  {overlayText}
                </Text>
              </View>
            )}
          </View>
        </View>

        {!winner && (
          <View style={[styles.actionRow, isLarge && stylesL.actionRow]}>
            {/* narrow ⌫ */}
            <Pressable
              style={[
                styles.btnMiniAlt,
                isLarge && stylesL.btnMiniAlt,
                !canBackspace && { opacity: 0.35 },
              ]}
              disabled={!canBackspace}
              onPress={() => {
                if (autoCommitTimerRef.current) {
                  clearTimeout(autoCommitTimerRef.current);
                  autoCommitTimerRef.current = null;
                }
                setHitMarkers((m) => m.slice(0, -1));
                clearOverlay();
                setState((s: any) => removeLastDart(s));
              }}
            >
              <Text style={[styles.btnMiniText, isLarge && stylesL.btnMiniText]}>⌫</Text>
            </Pressable>

            {/* wide Back = per-turn undo */}
            <Pressable
              style={[
                styles.btnWideAlt,
                isLarge && stylesL.btnWideAlt,
                !canBackTurn && { opacity: 0.35 },
              ]}
              disabled={!canBackTurn}
              onPress={() => {
                if (autoCommitTimerRef.current) {
                  clearTimeout(autoCommitTimerRef.current);
                  autoCommitTimerRef.current = null;
                }

                clearMarkers();
                clearOverlay();
                setState((s: any) => {
                  const rolled = backTurn(s);
                  awaitingClearRef.current = true;
                  pendingAdvanceOnClearRef.current = false;
                  seenThrowKeysRef.current = new Set();
                  lastNumThrowsRef.current = 0;
                  return rolled;
                });
              }}
            >
              <Text style={[styles.btnWideTextAlt, isLarge && stylesL.btnWideTextAlt]}>
                Back
              </Text>
            </Pressable>

            {/* widest Next Turn */}
            <Pressable
              style={[styles.btnWidePrimary, isLarge && stylesL.btnWidePrimary]}
              onPress={endTurnWithPersist}
            >
              <Text style={[styles.btnWideTextPrimary, isLarge && stylesL.btnWideTextPrimary]}>
                Next Turn
              </Text>
            </Pressable>
          </View>
        )}

        {/* Player cards grid */}
        <ScrollView
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: Platform.OS === "ios" ? 10 : 6 },
          ]}
          style={{ marginTop: 10 }}
        >
          {state.players.map((p: any, idx: number) => {
            const active = idx === state.currentIndex && !winner;
            const shown = active ? toDartLabels(state.turnDarts) : lastTurnByPlayer[idx] ?? [];
            const label = active ? "This turn:" : "Last:";

            return (
              <View
                key={idx}
                style={[
                  styles.pcard,
                  isLarge && stylesL.pcard,
                  active && styles.pcardActive,
                ]}
              >
                <Text style={[styles.pname, isLarge && stylesL.pname]} numberOfLines={1}>
                  {p.name}
                </Text>

                <Text style={[styles.pbig, isLarge && stylesL.pbig]}>{p.remaining}</Text>

                <Text style={[styles.psub, isLarge && stylesL.psub]}>
                  Rewards: {state.tokens[idx]}
                </Text>

                {!winner && (
                  <View style={{ marginTop: 10, gap: 6 }}>
                    <Text style={[styles.ptag, isLarge && stylesL.ptag]}>{label}</Text>

                    {shown.length > 0 ? (
                      <View style={styles.dartRow}>
                        {shown.slice(0, 3).map((d: string, i: number) => (
                          <View key={i} style={styles.dartPill}>
                            <Text style={styles.dartPillText}>{d}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.noneText, isLarge && stylesL.noneText]}>—</Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Bottom actions (even after Winner) */}
{winner && (
  <View style={[styles.actionRow, isLarge && stylesL.actionRow]}>
    <Pressable
      style={[styles.btnWideAlt, isLarge && stylesL.btnWideAlt]}
      onPress={backFromWinner}
    >
      <Text style={[styles.btnWideTextAlt, isLarge && stylesL.btnWideTextAlt]}>
        Back
      </Text>
    </Pressable>
  </View>
)}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  container: { flex: 1, padding: 12, gap: 10, backgroundColor: "#F8FAFC" },

  header: { gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  autoDot: { width: 10, height: 10, borderRadius: 999 },
  autoDotOn: { backgroundColor: "#16A34A" },
  autoDotOff: { backgroundColor: "#9CA3AF" },

  h1: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 12, opacity: 0.7 },

  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  autoResetBtnWarn: { backgroundColor: "#000000" },
  autoResetBtnDanger: { backgroundColor: "#000000" },

  turnTitle: { fontSize: 18, fontWeight: "900", flexShrink: 1 },

  checkoutHuge: {
    fontSize: 24,
    fontWeight: "900",
    opacity: 0.92,
    flexShrink: 1,
    lineHeight: 26,
    letterSpacing: 0.2,
  },
  checkoutPlaceholder: { fontSize: 24, lineHeight: 26, opacity: 0 },

  winner: { fontSize: 18, fontWeight: "900" },
  winnerSub: { marginTop: 8, opacity: 0.7, fontWeight: "800" },

  boardArea: { alignItems: "center", justifyContent: "center" },

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
    fontSize: 72,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },

  turnIntroWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
},
turnIntroPlayer: {
  fontWeight: "900",
  color: "rgba(253, 253, 255, 0.9)", 
  fontSize: 36,
  marginBottom: 30,
  textAlign: "center",

    // outline
  textShadowColor: "rgba(0,0,0,0.8)",
  textShadowOffset: { width: 8, height: 8 },
  textShadowRadius: 8,
},
turnIntroScore: {
  fontWeight: "900",
  color: "rgba(255, 255, 255, 0.9)",
  fontSize: 160,
  lineHeight: 170,
  textAlign: "center",

    // outline
  textShadowColor: "rgba(0,0,0,0.8)",
  textShadowOffset: { width: 8, height: 8 },
  textShadowRadius: 8,
},




  actionRow: { flexDirection: "row", gap: 10, marginTop: 2 },

  btnMiniAlt: {
    flex: 0.38,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  btnMiniText: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },

  autoRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  autoResetBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#111827",
  },
  autoRestartBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#0F172A",
  },
  autoResetText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.3,
  },

  btnWideAlt: {
    flex: 1.05,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  btnWideTextAlt: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },

  btnWidePrimary: {
    flex: 1.55,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  btnWideTextPrimary: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  pcard: {
    flexBasis: "48%",
    flexGrow: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    minHeight: 110,
  },
  pcardActive: { borderColor: "#2563EB", borderWidth: 2 },

  pname: { fontWeight: "900", fontSize: 14 },
  pbig: { marginTop: 8, fontWeight: "900", fontSize: 28 },
  psub: { marginTop: 2, opacity: 0.7, fontWeight: "800", fontSize: 12 },
  ptag: { marginTop: 10, opacity: 0.75, fontWeight: "900", fontSize: 12 },

  dartRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dartPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  dartPillText: { fontWeight: "900", fontSize: 12, opacity: 0.85 },

  noneText: { fontWeight: "900", opacity: 0.45, fontSize: 12 },
});

const stylesL = StyleSheet.create({
  h1: { fontSize: 30 },
  sub: { fontSize: 15 },

  card: { padding: 18, borderRadius: 16 },
  turnTitle: { fontSize: 22 },

  checkoutHuge: { fontSize: 34, lineHeight: 36 },
  checkoutPlaceholder: { fontSize: 34, lineHeight: 36 },

  winner: { fontSize: 22 },
  winnerSub: { fontSize: 16 },

  overlayText: { fontSize: 120 },

  turnIntroPlayer: {
  fontSize: 100,
  marginBottom: 0,
},
turnIntroScore: {
  fontSize: 160,
  lineHeight: 270,
},



  actionRow: { gap: 12 },

  btnMiniAlt: { flex: 0.34, paddingVertical: 16, borderRadius: 14 },
  btnMiniText: { fontSize: 22, letterSpacing: 0.5 },

  btnWideAlt: { flex: 1.05, paddingVertical: 16, borderRadius: 14 },

  btnWideTextAlt: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },

  btnWidePrimary: { flex: 1.6, paddingVertical: 16, borderRadius: 14 },
  btnWideTextPrimary: { fontSize: 20, letterSpacing: 0.5 },

  pcard: { flexBasis: "23%", padding: 16, borderRadius: 16, minHeight: 140 },
  pname: { fontSize: 16 },
  pbig: { fontSize: 34 },
  psub: { fontSize: 14 },
  ptag: { fontSize: 14 },

  noneText: { fontSize: 14 },
});
