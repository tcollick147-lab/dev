// src/screens/MatchGameScreen.tsx
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
  Platform,
  SafeAreaView,
  Animated,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import {
  createMatchState,
  applyDart,
  endTurn,
  backTurn,
  removeLastDart,
  isTurnReadyToCommit,
  scoreOf,
  type DartCode,
} from "../engine/matchEngine";

import Dartboard from "../components/Dartboard";
import { useDartSounds } from "../hooks/useDartSounds";
import { loadMatchSetup, saveMatchSetup } from "../storage/setupStorage";
import { AUTO_BASE_URL, AUTO_WS_URL } from "../config/autodarts";
import { useTakeoutStallWarning } from "../autodarts/useTakeoutStallWarning";

// ✅ Checkout chart
import { CHECKOUT_CHART, Bed } from "../data/checkoutCharts";

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

/** Pass throwIndex in CtB so multiple identical misses (e.g. bouncers) each get a unique key. */
function keyFromAutoThrow(t: AutoDartsThrow | undefined | null, throwIndex?: number): string {
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
  const base = `${name}|${num}|${mult}|${rx},${ry}`;
  return typeof throwIndex === "number" ? `${base}|${throwIndex}` : base;
}

function shufflePlayers(names: string[]) {
  const out = [...names];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function MatchGameScreen({ route, navigation }: Props) {
  const { setup } = route.params;
  const setupRef = useRef(setup);
  setupRef.current = setup;

  const onExitGame = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isLandscape = screenWidth > screenHeight;
  const base = Math.min(screenWidth, screenHeight);
  const isLarge = base >= 900;

  // Board sizing: landscape = fill most of left column; portrait 75% of width; cap by height to fit
  const boardSize = useMemo(() => {
    const widthFactor = 0.75;
    if (isLandscape) {
      const rowWidth = screenWidth - 28;
      const leftColWidth = rowWidth * 0.7;
      const sizeByWidth = leftColWidth * 0.95;
      const maxByHeight = screenHeight * (isLarge ? 0.82 : 0.78);
      return Math.min(sizeByWidth, maxByHeight);
    }
    const maxByHeight = screenHeight * (isLarge ? 0.7 : 0.65);
    const sizeByWidth = screenWidth * widthFactor;
    return Math.min(sizeByWidth, maxByHeight);
  }, [screenWidth, screenHeight, isLarge, isLandscape]);

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

  const { playHit, playBonus, playJackpot, playKilled } = useDartSounds();
  const playHitRef = useRef(playHit);
  const playKilledRef = useRef(playKilled);
  useEffect(() => {
    playHitRef.current = playHit;
  }, [playHit]);
  useEffect(() => {
    playKilledRef.current = playKilled;
  }, [playKilled]);

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
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [closestToBullActive, setClosestToBullActive] = useState<boolean>(!!setup.closestToBull);
  const [closestToBullOrder] = useState<string[]>(() => shufflePlayers(setup.players));
  const [closestToBullIndex, setClosestToBullIndex] = useState(0);
  const [closestToBullResults, setClosestToBullResults] = useState<Record<string, number>>({});
  const closestToBullActiveRef = useRef<boolean>(!!setup.closestToBull);
  const closestToBullIndexRef = useRef(0);
  const closestToBullResultsRef = useRef<Record<string, number>>({});
  const closestAwaitingFinalTakeoutRef = useRef(false);

  // Restore Closest to Bull from last session (lobby and back)
  useEffect(() => {
    let cancelled = false;
    loadMatchSetup().then((stored) => {
      if (cancelled || !stored || typeof stored.closestToBull !== "boolean") return;
      setClosestToBullActive(stored.closestToBull);
      closestToBullActiveRef.current = stored.closestToBull;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist Closest to Bull when leaving the game so lobby-and-back keeps last status
  useEffect(() => {
    return () => {
      const current = closestToBullActiveRef.current;
      const s = setupRef.current;
      loadMatchSetup().then((stored) => {
        const base = stored ?? {
          startScore: s?.startScore ?? 501,
          inRule: (s?.inRule as any) ?? "STRAIGHT",
          outRule: (s?.outRule as any) ?? "DOUBLE",
          side: (s?.side as any) ?? {},
        };
        saveMatchSetup({ ...base, closestToBull: current });
      });
    };
  }, []);

  const [boardProfileMode, setBoardProfileMode] = useState<"auto" | "manual">("auto");
  const usingAutoBoard = boardProfileMode === "auto";

  // =========================
  // Marker dots
  // =========================
  const [hitMarkers, setHitMarkers] = useState<any[]>([]);
  const clearMarkers = useCallback(() => setHitMarkers([]), []);

  const [showCtBMissOverlay, setShowCtBMissOverlay] = useState(false);
  const ctbMissOpacityRef = useRef(new Animated.Value(0)).current;
  const triggerCtBMissOverlayRef = useRef<() => void>(() => {});
  const pendingNextCtBIndexRef = useRef<number | null>(null);

  const [showThrowOrderSetOverlay, setShowThrowOrderSetOverlay] = useState(false);
  const [throwOrderSetWinnerName, setThrowOrderSetWinnerName] = useState<string | null>(null);
  const showThrowOrderSetOverlayRef = useRef<() => void>(() => {});

  useEffect(() => {
    triggerCtBMissOverlayRef.current = () => setShowCtBMissOverlay(true);
    return () => {
      triggerCtBMissOverlayRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    showThrowOrderSetOverlayRef.current = () => {
      const nextResults = closestToBullResultsRef.current;
      const indexOf = new Map<string, number>();
      closestToBullOrder.forEach((p, i) => indexOf.set(p, i));
      const ordered = [...closestToBullOrder].sort((a, b) => {
        const da = nextResults[a] ?? Number.POSITIVE_INFINITY;
        const db = nextResults[b] ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
      });
      setShowThrowOrderSetOverlay(true);
      setThrowOrderSetWinnerName(ordered[0] ?? null);
    };
    return () => {
      showThrowOrderSetOverlayRef.current = () => {};
    };
  }, [closestToBullOrder]);

  useEffect(() => {
    if (!showCtBMissOverlay) return;
    ctbMissOpacityRef.setValue(0);
    Animated.sequence([
      Animated.timing(ctbMissOpacityRef, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.delay(550),
      Animated.timing(ctbMissOpacityRef, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowCtBMissOverlay(false);
      const pending = pendingNextCtBIndexRef.current;
      pendingNextCtBIndexRef.current = null;
      if (pending != null) setClosestToBullIndex(closestToBullIndexRef.current);
    });
  }, [showCtBMissOverlay, ctbMissOpacityRef]);

  const markerFromAutoCoords = useCallback(
    (coords?: { x?: number; y?: number } | null) => {
      const x = coords?.x;
      const y = coords?.y;
      if (typeof x !== "number" || typeof y !== "number") return null;

      const absMax = Math.max(Math.abs(x), Math.abs(y));
      if (absMax <= 1.5) {
        // Preserve radial spread: don't clamp to 1.05 or close darts (e.g. 1.03 vs 1.20) collapse
        const nx = Math.max(-1.25, Math.min(1.25, x));
        const ny = Math.max(-1.25, Math.min(1.25, y));
        // AutoDarts normalized radius maps slightly inside our board edge.
        const profileScale = usingAutoBoard ? 1.0 : 0.94;
        const rOuter = boardSize * (isLarge ? 0.47 : 0.43) * profileScale;
        const cx = boardSize / 2;
        const cy = boardSize / 2;
        // Radius-dependent scale: treble (r~0.6) stays ~1.0, outer (r~0.9) scales in so single doesn't land on double
        const r = Math.sqrt(nx * nx + ny * ny) || 0.001;
        const rScale = Math.max(0.76, Math.min(0.93, 0.76 + 0.07 * r));
        return { x: cx + nx * rOuter * rScale, y: cy - ny * rOuter * rScale };
      }

      if (x >= -8 && x <= boardSize + 8 && y >= -8 && y <= boardSize + 8) {
        return {
          x: Math.max(0, Math.min(boardSize, x)),
          y: Math.max(0, Math.min(boardSize, y)),
        };
      }

      return null;
    },
    [boardSize, isLarge, usingAutoBoard]
  );
  const distanceFromAutoCoords = useCallback(
    (coords?: { x?: number; y?: number } | null) => {
      const x = coords?.x;
      const y = coords?.y;
      if (typeof x !== "number" || typeof y !== "number") return null;
      const absMax = Math.max(Math.abs(x), Math.abs(y));
      if (absMax <= 1.5) return Math.hypot(x, y);

      const marker = markerFromAutoCoords(coords);
      if (!marker) return null;
      const cx = boardSize / 2;
      const cy = boardSize / 2;
      const rOuter = boardSize * (isLarge ? 0.47 : 0.43);
      return Math.hypot(marker.x - cx, marker.y - cy) / Math.max(1, rOuter);
    },
    [boardSize, isLarge, markerFromAutoCoords]
  );

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
    playKilledRef.current?.();
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
useEffect(() => {
  closestToBullActiveRef.current = closestToBullActive;
  if (closestToBullActive) clearTurnIntro();
}, [closestToBullActive, clearTurnIntro]);
useEffect(() => {
  closestToBullIndexRef.current = closestToBullIndex;
}, [closestToBullIndex]);

const restartWithPlayerOrder = useCallback((orderedPlayers: string[]) => {
  const s = createMatchState({
    playerNames: orderedPlayers,
    startScore: setup.startScore,
    inRule: setup.inRule,
    outRule: setup.outRule,
  });
  setState({ ...s, side: { ...s.side, ...setup.side } });
  setLastTurnByPlayer(orderedPlayers.map(() => []));
  setLastTurnRewardByPlayer(orderedPlayers.map(() => "none"));
  setHitMarkers([]);
  setOverlayText(null);
  setClosestToBullResults({});
  closestToBullResultsRef.current = {};
  closestAwaitingFinalTakeoutRef.current = false;
}, [setup]);

const finalizeClosestToBull = useCallback(() => {
  setShowThrowOrderSetOverlay(false);
  setThrowOrderSetWinnerName(null);
  const nextResults = closestToBullResultsRef.current;
  const indexOf = new Map<string, number>();
  closestToBullOrder.forEach((p, i) => indexOf.set(p, i));
  const ordered = [...closestToBullOrder].sort((a, b) => {
    const da = nextResults[a] ?? Number.POSITIVE_INFINITY;
    const db = nextResults[b] ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
  });
  setClosestToBullActive(false);
  closestToBullActiveRef.current = false;
  setClosestToBullIndex(0);
  closestToBullIndexRef.current = 0;
  closestAwaitingFinalTakeoutRef.current = false;
  setHitMarkers([]); // clear CtB markers when progressing to game
  // Reset AutoDarts so new game isn't stuck on Takeout
  fetch(`${AUTO_BASE_URL}/api/reset`, { method: "POST" }).catch(() => {});
  restartWithPlayerOrder(ordered);
}, [closestToBullOrder, restartWithPlayerOrder]);

const recordClosestToBullThrow = useCallback(
  (dist: number) => {
    if (!closestToBullActiveRef.current) return;
    const player = closestToBullOrder[closestToBullIndexRef.current];
    if (!player) return;
    const isMiss = !Number.isFinite(dist) || dist < 0;
    const nextResults = {
      ...closestToBullResultsRef.current,
      [player]: isMiss ? Number.POSITIVE_INFINITY : dist,
    };
    closestToBullResultsRef.current = nextResults;
    setClosestToBullResults(nextResults);
    const nextIndex = closestToBullIndexRef.current + 1;
    if (isMiss) {
      closestToBullIndexRef.current = nextIndex;
      if (nextIndex >= closestToBullOrder.length) {
        closestAwaitingFinalTakeoutRef.current = true;
        showThrowOrderSetOverlayRef.current?.();
      }
      pendingNextCtBIndexRef.current = nextIndex;
      triggerCtBMissOverlayRef.current?.();
    } else {
      if (nextIndex >= closestToBullOrder.length) {
        closestAwaitingFinalTakeoutRef.current = true;
        showThrowOrderSetOverlayRef.current?.();
      } else {
        setClosestToBullIndex(nextIndex);
        closestToBullIndexRef.current = nextIndex;
      }
    }
  },
  [closestToBullOrder]
);

const undoLastCtBThrow = useCallback(() => {
  if (!closestToBullActiveRef.current) return;
  const idx = closestToBullIndexRef.current;
  const prevIndex = idx >= closestToBullOrder.length ? closestToBullOrder.length - 1 : idx - 1;
  if (prevIndex < 0) return;
  const playerToRemove = closestToBullOrder[prevIndex];
  if (!playerToRemove) return;
  const nextResults = { ...closestToBullResultsRef.current };
  delete nextResults[playerToRemove];
  closestToBullResultsRef.current = nextResults;
  setClosestToBullResults(nextResults);
  setClosestToBullIndex(prevIndex);
  closestToBullIndexRef.current = prevIndex;
  if (idx >= closestToBullOrder.length) {
    closestAwaitingFinalTakeoutRef.current = false;
    setShowThrowOrderSetOverlay(false);
  }
  setHitMarkers((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
}, [closestToBullOrder]);

const canUndoCtB = closestToBullActive && (closestToBullIndex > 0 || showThrowOrderSetOverlay);


  // =========================
  // Last turn per player
  // =========================
  type TurnReward = "none" | "bonus" | "jackpot";
  const [lastTurnByPlayer, setLastTurnByPlayer] = useState<string[][]>(() =>
    setup.players.map(() => [])
  );
  const [lastTurnRewardByPlayer, setLastTurnRewardByPlayer] = useState<TurnReward[]>(() =>
    setup.players.map(() => "none")
  );

  // Compute reward for current turn (engine overwrites turnScoreReward in endTurn return)
  const getTurnRewardType = useCallback((s: any): TurnReward => {
    if (!s?.side) return "none";
    if (s.turnBusted || (s.turnScore ?? 0) <= 0) return "none";
    const side = s.side;
    if (side.scoreJackpotOn && s.turnScore >= side.scoreJackpotThreshold) return "jackpot";
    if (side.scoreBonusOn && s.turnScore >= side.scoreBonusThreshold) return "bonus";
    return "none";
  }, []);

  const persistLastForIndex = useCallback(
    (playerIndex: number, turnDarts: any, rewardType: TurnReward = "none") => {
      const darts = toDartLabels(turnDarts);
      if (!darts.length) return;
      setLastTurnByPlayer((prev) => {
        const next = prev.slice();
        next[playerIndex] = darts;
        return next;
      });
      setLastTurnRewardByPlayer((prev) => {
        const next = prev.slice();
        next[playerIndex] = rewardType;
        return next;
      });
    },
    []
  );

  // Reward sound: play when events count increases (bonus vs jackpot from last event label)
  const prevEventsLenRef = useRef<number>(state.events?.length ?? 0);
  useEffect(() => {
    const prevLen = prevEventsLenRef.current;
    const nowLen = state.events?.length ?? 0;
    if (nowLen > prevLen && nowLen > 0) {
      const last = state.events![nowLen - 1] as { label?: string } | undefined;
      const isJackpot = last?.label?.toLowerCase().includes("jackpot");
      if (isJackpot) playJackpot();
      else playBonus();
    }
    prevEventsLenRef.current = nowLen;
  }, [state.events?.length, state.events, playBonus, playJackpot]);

  // =========================
  // AutoDarts wiring (turn advances ONLY when board is cleared)
  // =========================
  const autoCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [autoConnected, setAutoConnected] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string>("");
  const [autoNumThrows, setAutoNumThrows] = useState<number>(0);

  const prevAutoStatusRef = useRef<string>("");

  // Per-turn de-dupe
  const seenThrowKeysRef = useRef<Set<string>>(new Set());

  // Manual turn-change / back / reset -> ignore until clear
  const awaitingClearRef = useRef<boolean>(false);

  // When AutoDarts enters TAKEOUT (player finished), we latch “pending advance”
  // and we only advance when the board becomes CLEAR (0 throws / throws empty / numThrows drops).
  // Advance only on Takeout; guard against duplicate Takeout messages advancing twice
  const advancedOnTakeoutRef = useRef<boolean>(false);

  // Track last numThrows observed (helps “numThrows dropped” clear detection)
  const lastNumThrowsRef = useRef<number>(0);

  // After "Takeout finished" (Takeout -> Throw), ignore incoming throws for 2.5s to avoid stale re-apply
  const ignoreThrowsAfterTakeoutUntilRef = useRef<number>(0);
  // AutoDarts repeats the same 3 throws in a Takeout message after removal; only process Takeout+throws once per turn
  const processedTakeoutWithThrowsRef = useRef<boolean>(false);

  const RESET_FETCH_TIMEOUT_MS = 8000;
  const doResetAndRefetch = useCallback(() => {
    const root = String(AUTO_BASE_URL ?? "").replace(/\/+$/, "");
    const timeout = (ms: number) =>
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Reset timeout")), ms));
    const resetAndRefetch = () =>
      fetch(`${root}/api/reset`, { method: "POST" })
        .then(() => fetch(`${root}/api/state`).then((r) => r.json()))
        .then((data: any) => {
          const status = data?.status;
          const numThrows = Number(data?.numThrows ?? data?.numDarts ?? 0);
          if (status != null) setAutoStatus(String(status));
          if (Number.isFinite(numThrows)) setAutoNumThrows(numThrows);
          lastNumThrowsRef.current = numThrows ?? 0;
          seenThrowKeysRef.current = new Set();
          processedTakeoutWithThrowsRef.current = false;
          awaitingClearRef.current = false;
          advancedOnTakeoutRef.current = false;
          prevAutoStatusRef.current = data?.status ?? "";
        });
    return Promise.race([resetAndRefetch(), timeout(RESET_FETCH_TIMEOUT_MS)]).catch((e) => {
      console.warn("[AutoDarts] reset/refetch failed or timed out", e);
    });
  }, []);

  const prevClosestToBullActiveRef = useRef<boolean>(!!setup.closestToBull);

  useEffect(() => {
    if (!closestToBullActive) return;
    doResetAndRefetch();
  }, [closestToBullActive, doResetAndRefetch]);

  const resetSeenThrows = useCallback(() => {
    seenThrowKeysRef.current = new Set();
  }, []);

  const resetAutoForNewTurn = useCallback(() => {
    resetSeenThrows();
    awaitingClearRef.current = false;
    lastNumThrowsRef.current = 0;
    processedTakeoutWithThrowsRef.current = false;
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

      const prevIndex = cur.currentIndex;
      const prevDarts = cur.turnDarts;
      const rewardType = getTurnRewardType(cur);
      clearMarkers();
      clearOverlay();

      const advanced = endTurn(cur);
      persistLastForIndex(prevIndex, prevDarts, rewardType);

      // require clear before next player's throws (important for AutoDarts)
      resetAutoForNewTurn();

      return advanced;
    });
  }, [getTurnRewardType, persistLastForIndex, clearMarkers, clearOverlay, resetAutoForNewTurn]);

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
      advancedOnTakeoutRef.current = false;
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
      advancedOnTakeoutRef.current = false;
      resetSeenThrows();
    } catch (e) {
      console.log("AutoDarts reset failed", e);
    } finally {
      setAutoResetting(false);
    }
  }, [AUTO_BASE_URL, autoResetting, clearMarkers, clearOverlay, resetSeenThrows]);

  // Restart = PUT /api/start only (same in CtB and main game)
  const restartAutoDartsHard = useCallback(async () => {
    if (autoResetting) return;
    setAutoResetting(true);
    try {
      await fetch(`${AUTO_BASE_URL}/api/start`, { method: "PUT" });
      clearMarkers();
      clearOverlay();
      awaitingClearRef.current = true;
      advancedOnTakeoutRef.current = false;
      resetSeenThrows();
      const currentOrder = stateRef.current.players.map((p: { name: string }) => p.name);
      restartWithPlayerOrder(currentOrder);
      setClosestToBullIndex(0);
      closestToBullIndexRef.current = 0;
    } catch (e) {
      console.log("AutoDarts restart failed", e);
    } finally {
      setAutoResetting(false);
    }
  }, [AUTO_BASE_URL, autoResetting, clearMarkers, clearOverlay, resetSeenThrows, restartWithPlayerOrder]);

  // WS connect with reconnect when AutoDarts is closed and reopened
  const matchWsRef = useRef<WebSocket | null>(null);
  const matchReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchWsActiveRef = useRef(true);

  useEffect(() => {
    matchWsActiveRef.current = true;

    function connect() {
      if (!matchWsActiveRef.current) return;
      if (matchWsRef.current) {
        try {
          matchWsRef.current.close();
        } catch {}
        matchWsRef.current = null;
      }

      const ws = new WebSocket(AUTO_WS_URL);
      matchWsRef.current = ws;

      ws.onopen = () => {
        setAutoConnected(true);
        // Sync current board state (e.g. Takeout + 3 darts) so UI is correct after app restart
        const root = String(AUTO_BASE_URL ?? "").replace(/\/+$/, "");
        fetch(`${root}/api/state`)
          .then((r) => r.json())
          .then((data: any) => {
            const status = data?.status;
            const numThrows = Number(data?.numThrows ?? data?.numDarts ?? 0);
            if (status != null) setAutoStatus(String(status));
            if (Number.isFinite(numThrows)) setAutoNumThrows(numThrows);
          })
          .catch(() => {});
      };
      ws.onclose = () => {
        setAutoConnected(false);
        matchWsRef.current = null;
        if (!matchWsActiveRef.current) return;
        if (matchReconnectTimerRef.current) clearTimeout(matchReconnectTimerRef.current);
        matchReconnectTimerRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        setAutoConnected(false);
        if (!matchWsActiveRef.current) return;
        if (matchReconnectTimerRef.current) clearTimeout(matchReconnectTimerRef.current);
        matchReconnectTimerRef.current = setTimeout(connect, 3000);
      };

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
      const prevL = prevStatus.toLowerCase();
      const wasTakeout = prevL.includes("takeout");

      const isTakeoutNow = nextL.includes("takeout");
      // "Takeout in progress" = user removing darts; we advance only on this, not on "Takeout" (finished)
      const isTakeoutInProgress = nextL.includes("takeout") && nextL.includes("progress");
      const isThrowNow = nextL === "throw" || nextL.includes("throw");

      prevAutoStatusRef.current = nextStatus;
      // When board is in Throw (new turn), allow next Takeout to advance
      if (isThrowNow) advancedOnTakeoutRef.current = false;

      const numThrows = Number(data.numThrows ?? 0);
const throwsArr: AutoDartsThrow[] = Array.isArray(data.throws) ? data.throws : [];

      // Start post-takeout ignore window so we don't re-apply stale darts — but not during CtB mid-round (4+ players): we sent reset and expect the next player's dart
      const ctbMidRound = closestToBullActiveRef.current && closestToBullOrder.length > 3 && !closestAwaitingFinalTakeoutRef.current;
      if (
        !ctbMidRound &&
        ((wasTakeout && isThrowNow) ||
          (isThrowNow && numThrows === 0 && throwsArr.length === 0))
      ) {
        ignoreThrowsAfterTakeoutUntilRef.current = Date.now() + 2500;
        processedTakeoutWithThrowsRef.current = false; // next Takeout+throws is the real 3rd dart
      }
      // First dart of new turn (Throw, 1 dart) — reset so we'll accept the next Takeout+3 once (in case we never got board-empty)
      if (isThrowNow && numThrows === 1 && throwsArr.length >= 1) {
        processedTakeoutWithThrowsRef.current = false;
      }
      // CtB with 4+ players: previous message had 3 darts, this one has <3 = board was cleared and next player threw — reset so we accept it
      if (closestToBullActiveRef.current && (numThrows < 3 || throwsArr.length < 3) && lastNumThrowsRef.current >= 3) {
        processedTakeoutWithThrowsRef.current = false;
      }

      if (throwsArr.length > 0) {
        console.log("[AutoDarts] state numThrows=" + numThrows + " throws=" + throwsArr.length);
        throwsArr.forEach((t: any, i: number) => {
          const c = t?.coords;
          console.log("[AutoDarts] coords[" + i + "] x=" + (c?.x ?? "—") + " y=" + (c?.y ?? "—"));
        });
      }

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

if (closestToBullActiveRef.current) {
  // Stale: we're already awaiting takeout (all 3 threw) and this message has 3 darts — skip
  if (closestAwaitingFinalTakeoutRef.current && throwsArr.length >= 3) {
    ignoreThrowsAfterTakeoutUntilRef.current = Date.now() + 2500;
    if (wasTakeout && isThrowNow) finalizeClosestToBull();
    return;
  }
  // Never process throws when status is "Takeout in progress" — those are the darts being removed
  if (isTakeoutInProgress) return;
  // Process throws (3rd dart often in status "Takeout"; "Takeout in progress" handled above).
  // When ctbMidRound, the 4th+ dart can arrive in a "Takeout" message — still process so we add the marker and ranking.
  const shouldProcessCtBThrows =
    Number.isFinite(numThrows) &&
    numThrows > 0 &&
    throwsArr.length > 0 &&
    Date.now() >= ignoreThrowsAfterTakeoutUntilRef.current &&
    (ctbMidRound && numThrows < 3 || !(isTakeoutNow && processedTakeoutWithThrowsRef.current));

  if (shouldProcessCtBThrows) {
    const newMarkers: any[] = [];
    for (let i = 0; i < throwsArr.length; i++) {
      const k = keyFromAutoThrow(throwsArr[i], i);
      if (!k || seenThrowKeysRef.current.has(k)) continue;
      seenThrowKeysRef.current.add(k);

      const marker = markerFromAutoCoords(throwsArr[i]?.coords);
      if (marker) newMarkers.push(marker);

      playHitRef.current?.();

      if (closestAwaitingFinalTakeoutRef.current) continue;
      const player = closestToBullOrder[closestToBullIndexRef.current];
      if (!player) continue;
      const dist = distanceFromAutoCoords(throwsArr[i]?.coords);
      const isMiss = typeof dist !== "number" || !Number.isFinite(dist);
      const nextIndex = closestToBullIndexRef.current + 1;
      const nextResults = {
        ...closestToBullResultsRef.current,
        [player]:
          typeof dist === "number" && Number.isFinite(dist) ? dist : Number.POSITIVE_INFINITY,
      };
      closestToBullResultsRef.current = nextResults;
      setClosestToBullResults(nextResults);
      if (isMiss) {
        closestToBullIndexRef.current = nextIndex;
        if (nextIndex >= closestToBullOrder.length) {
          closestAwaitingFinalTakeoutRef.current = true;
          showThrowOrderSetOverlayRef.current?.();
        }
        pendingNextCtBIndexRef.current = nextIndex;
        triggerCtBMissOverlayRef.current?.();
      } else {
        if (nextIndex >= closestToBullOrder.length) {
          closestAwaitingFinalTakeoutRef.current = true;
          showThrowOrderSetOverlayRef.current?.();
        } else {
          setClosestToBullIndex(nextIndex);
          closestToBullIndexRef.current = nextIndex;
        }
      }
    }
    if (newMarkers.length > 0) {
      setHitMarkers((prev) => [...prev, ...newMarkers]);
    }
    if (isTakeoutNow) processedTakeoutWithThrowsRef.current = true;
    // CtB with 4+ players: after 3 darts, send reset so AutoDarts clears takeout and next player can throw (markers stay until final player)
    if (throwsArr.length >= 3 && !closestAwaitingFinalTakeoutRef.current) {
      fetch(`${AUTO_BASE_URL}/api/reset`, { method: "POST" }).catch(() => {});
    }
  }

  if (wasTakeout && isThrowNow && closestAwaitingFinalTakeoutRef.current) {
    finalizeClosestToBull();
    // Do NOT clear seenThrowKeysRef: a stale message with the same 3 darts may arrive after this;
    // keeping their keys prevents the main match flow from re-applying them
    lastNumThrowsRef.current = 0;
  }
  return;
}

      setState((prev: any) => {
        // If game ended, freeze WS scoring (but allow manual "Back" via backFromWinner)
        if (!prev || prev.winnerIndex !== null) return prev;

        let cur = prev;

        // 1) If we manually advanced/reset/backed, ignore until clear
        if (awaitingClearRef.current) {
          if (cleared) {
            awaitingClearRef.current = false;
            // Do not resetSeenThrows here: a stale message with previous 3 darts could re-apply them
          } else {
            return cur;
          }
        }

        // 2) Always apply NEW throws first (even if status is TAKEOUT), unless we're in the post-takeout ignore window
        const inPostTakeoutIgnoreWindow = Date.now() < ignoreThrowsAfterTakeoutUntilRef.current;
        const alreadyHaveThreeDarts = Array.isArray(cur.turnDarts) && cur.turnDarts.length >= 3;
        const incomingHasThreeDarts = numThrows >= 3 && throwsArr.length >= 3;
        // Stale re-send: we already have 3 darts and this message also has 3 — skip re-apply, but if Takeout still fall through to advance
        if (alreadyHaveThreeDarts && incomingHasThreeDarts && !isTakeoutNow) {
          ignoreThrowsAfterTakeoutUntilRef.current = Date.now() + 2500;
          return cur;
        }
        // AutoDarts repeats the same 3 throws in status=Takeout; only process Takeout+throws once per turn (but if we already have 3 darts, still fall through to advance on Takeout)
        if (isTakeoutNow && processedTakeoutWithThrowsRef.current && !alreadyHaveThreeDarts) {
          return cur;
        }
        // Don't apply throws when status is "Takeout in progress" (darts being removed), but still fall through to advance
        if (
          !inPostTakeoutIgnoreWindow &&
          !isTakeoutInProgress &&
          Number.isFinite(numThrows) &&
          numThrows > 0 &&
          throwsArr.length > 0
        ) {
          if (!alreadyHaveThreeDarts) {
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

              const marker = markerFromAutoCoords(t?.coords);
              if (marker) {
                setHitMarkers((prev) => [...prev, marker].slice(-3));
              }


              const beforeBusted = !!cur.turnBusted;
              const next = applyDart(cur, code);

              if (!beforeBusted && !!next.turnBusted) showBustOverlay();
              else showOverlayForDart(code);

              cur = next;
              playHitRef.current?.();
            }
            if (isTakeoutNow && newThrows.length > 0) {
              processedTakeoutWithThrowsRef.current = true;
            }
          }
        }

        // 3) Advance only on "Takeout in progress" (not on "Takeout" or 3 darts). One advance per takeout.
        if (isTakeoutInProgress) {
          if (advancedOnTakeoutRef.current) return cur; // already advanced for this Takeout (duplicate message)
          const hasAnyDart = Array.isArray(cur.turnDarts) && cur.turnDarts.length > 0;
          if (hasAnyDart) {
            advancedOnTakeoutRef.current = true;
            const prevIndex = cur.currentIndex;
            const prevDarts = cur.turnDarts;
            const rewardType = getTurnRewardType(cur);
            clearMarkers();
            clearOverlay();

            cur = endTurn(cur);
            persistLastForIndex(prevIndex, prevDarts, rewardType);

            lastNumThrowsRef.current = 0;
            processedTakeoutWithThrowsRef.current = false;
            resetAutoForNewTurn();

            return cur;
          }
        }

        // 4) Never auto-advance on 3 darts or board cleared — only on Takeout above.
        return cur;
      });
    };
    }

    connect();

    return () => {
      matchWsActiveRef.current = false;
      if (matchReconnectTimerRef.current) {
        clearTimeout(matchReconnectTimerRef.current);
        matchReconnectTimerRef.current = null;
      }
      if (matchWsRef.current) {
        try {
          matchWsRef.current.close();
        } catch {}
        matchWsRef.current = null;
      }
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
    getTurnRewardType,
    persistLastForIndex,
    resetSeenThrows,
    clearTurnIntro,
    markerFromAutoCoords,
    distanceFromAutoCoords,
    finalizeClosestToBull,
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
  }, [autoResetting, autoStatus]); // same logic in CtB and main game

  const isTakeoutInProgress = useMemo(() => {
    const s = (autoStatus ?? "").toLowerCase();
    return s.includes("takeout") && s.includes("progress");
  }, [autoStatus]);
  const { takeoutStallModal } = useTakeoutStallWarning({
    isTakeoutInProgress,
    onResetTakeout: () => {
      resetAutoDartsHard();
    },
    turnKey: state.currentIndex,
  });

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

  const scrollPortraitRef = useRef<ScrollView>(null);
  const scrollLandscapeRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Array<{ x: number; y: number }>>([]);

  // Scroll active player card into view when current player changes
  useEffect(() => {
    if (state.players.length === 0 || winner) return;
    const idx = state.currentIndex;
    const scrollRef = isLandscape ? scrollLandscapeRef.current : scrollPortraitRef.current;
    const off = cardOffsets.current[idx];
    if (scrollRef != null && off) {
      const pad = 24;
      if (isLandscape) {
        scrollRef.scrollTo({ y: Math.max(0, off.y - pad), animated: true });
      } else {
        scrollRef.scrollTo({ x: Math.max(0, off.x - pad), animated: true });
      }
    }
  }, [state.currentIndex, state.players.length, winner, isLandscape]);

  const canBackspace = !winner && state.turnDarts.length > 0;
  const canBackTurn = !winner && getTurnHistoryLen(state as any) > 0;

  const inputDisabled = winner || (!closestToBullActive && state.turnDarts.length >= 3);

  const actionRows = (
    <>
      {!winner && (
        <View style={[styles.actionRow, isLarge && stylesL.actionRow]}>
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
              clearTurnIntro();
              setState((s: any) => {
                const next = removeLastDart(s);
                if (next.turnDarts.length >= 1) {
                  const lastDart = next.turnDarts[next.turnDarts.length - 1];
                  setTimeout(() => showOverlayForDart(lastDart), 0);
                } else {
                  setTimeout(() => clearOverlay(), 0);
                }
                return next;
              });
              setHitMarkers((m) => m.slice(0, -1));
            }}
          >
            <Text style={[styles.btnMiniText, isLarge && stylesL.btnMiniText]}>⌫</Text>
          </Pressable>

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
                advancedOnTakeoutRef.current = false;
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
    </>
  );

  const topBar = (
    <View style={[styles.header, styles.headerRow]}>
      <Pressable style={styles.exitLink} onPress={onExitGame}>
        <Text style={styles.exitLinkText}>‹ Match Setup</Text>
      </Pressable>
      <Text style={[styles.h1, isLarge && stylesL.h1, { marginLeft: 10 }]}>Match</Text>
      <Text
        style={[
          styles.sub,
          styles.subClosest,
          isLarge && stylesL.sub,
          isLarge && stylesL.subClosest,
          { flex: 1, marginLeft: 10 },
        ]}
        numberOfLines={1}
      >
        {closestToBullActive
          ? `${closestToBullOrder.length} Players · Closest to Bull • Throwing: ${closestToBullOrder[closestToBullIndex] ?? "—"}`
          : `In: ${setup.inRule} • Out: ${setup.outRule} • Start: ${setup.startScore}`}
      </Text>
      <View style={styles.autoRight}>
        {!closestToBullActive && (
          <Pressable
            style={[
              styles.autoBoardBtn,
              autoResetting && { opacity: 0.5 },
            ]}
            onPress={() => setBoardProfileMode((m) => (m === "auto" ? "manual" : "auto"))}
            disabled={autoResetting}
          >
            <Text style={styles.autoResetText}>{usingAutoBoard ? "Board: Auto" : "Board: Manual"}</Text>
          </Pressable>
        )}

        {closestToBullActive && (
          <Pressable
            style={[styles.autoResetBtn, resetBtnExtraStyle, !canUndoCtB && { opacity: 0.5 }]}
            onPress={undoLastCtBThrow}
            disabled={!canUndoCtB}
          >
            <Text style={styles.autoResetText}>Undo</Text>
          </Pressable>
        )}

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
  );

  const showMatchUi = !closestToBullActive;

  const hasRewards =
    !!setup?.side &&
    (!!setup.side.gameWinnerOn ||
      !!setup.side.scoreBonusOn ||
      !!setup.side.scoreJackpotOn ||
      !!setup.side.checkoutBonusOn ||
      !!setup.side.checkoutJackpotOn ||
      !!setup.side.bullOn);

  const openResultsDetail = useCallback(() => {
    if (state.winnerIndex == null) return;
    navigation.navigate("GameResultsDetail", {
      gameTitle: "Match",
      playerNames: state.players.map((p) => p.name),
      winnerIndex: state.winnerIndex,
      payload: {
        gameType: "match",
        tokens: [...state.tokens],
        events: [...(state.events ?? [])],
      },
    });
  }, [navigation, state.winnerIndex, state.players, state.tokens, state.events]);

  const cardBlock = showMatchUi ? (
    <View style={[styles.card, isLarge && stylesL.card]}>
        {winner ? (
          hasRewards ? (
            <Pressable onPress={openResultsDetail} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <View>
                <Text style={[styles.winner, isLarge && stylesL.winner]}>
                  🏆 Winner: {winnerName ?? "—"}
                </Text>
                <Text style={[styles.winnerSub, isLarge && stylesL.winnerSub]}>
                  Rewards {state.tokens[state.winnerIndex as number]} · Tap for breakdown
                </Text>
              </View>
            </Pressable>
          ) : (
            <View>
              <Text style={[styles.winner, isLarge && stylesL.winner]}>
                🏆 Winner: {winnerName ?? "—"}
              </Text>
              <Text style={[styles.winnerSub, isLarge && stylesL.winnerSub]}>
                Rewards {state.tokens[state.winnerIndex as number]}
              </Text>
            </View>
          )
        ) : (
          <Text
            style={[styles.turnTitle, isLarge && stylesL.turnTitle]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {closestToBullActive
              ? `${closestToBullOrder.length} Players · Closest to Bull: ${closestToBullOrder[closestToBullIndex] ?? "—"}`
              : `Throwing: ${current.name}`}
          </Text>
        )}
    </View>
  ) : null;

  const headerAndCard = (
    <>
      {topBar}
      {cardBlock}
    </>
  );

  const headerCardAndActions = (
    <>
      {headerAndCard}
      {actionRows}
    </>
  );

  const boardBlock = (
    <View
      style={[
        styles.boardArea,
        isLandscape && styles.boardAreaLandscape,
        closestToBullActive && styles.boardAreaClosest,
      ]}
    >
      <View style={{ position: "relative" }}>
        <Dartboard
          size={boardSize}
          disabled={winner}
          inputDisabled={inputDisabled}
          boardProfile={closestToBullActive ? "standard" : (usingAutoBoard ? "standard" : "manual")}
          highlightTarget={closestToBullActive ? "BULL" : (checkoutUiEnabled ? (highlightTarget as any) : null)}
          highlightBeds={closestToBullActive ? ["BULL"] : (checkoutUiEnabled ? highlightBeds : [])}
          hitMarkers={hitMarkers}
          maxMarkers={closestToBullActive ? Math.max(3, closestToBullOrder.length) : 3}
          showLast={false}
          onHitMarker={(pt: any) => {
            if (closestToBullActive) {
              if (showThrowOrderSetOverlay) {
                finalizeClosestToBull();
                return;
              }
              const cx = boardSize / 2;
              const cy = boardSize / 2;
              const rOuter = boardSize * (isLarge ? 0.47 : 0.43);
              const dist = Math.hypot(pt.x - cx, pt.y - cy) / Math.max(1, rOuter);
              recordClosestToBullThrow(dist);
              setHitMarkers((prev) => [...prev, pt].slice(-Math.max(3, closestToBullOrder.length)));
              playHitRef.current?.();
              return;
            }
            setHitMarkers((prev) => [...prev, pt].slice(-3));
          }}
          onDart={(dart: DartCode) => {
            if (winner) return;
            if (closestToBullActive) return;
            if (!lockScoringTap()) return;

            clearTurnIntro();

            if (autoCommitTimerRef.current) {
              clearTimeout(autoCommitTimerRef.current);
              autoCommitTimerRef.current = null;
            }

            playHitRef.current?.();

            setState((s: any) => {
              if (s.turnDarts.length >= 3) return s;

              const beforeBusted = !!s.turnBusted;
              const next = applyDart(s, dart);

              if (!beforeBusted && !!next.turnBusted) showBustOverlay();
              else showOverlayForDart(dart);

              return next;
            });
          }}
          onDartDetail={() => {}}
        />

        {!!turnIntro && !winner && !closestToBullActive && (
          <View pointerEvents="none" style={styles.overlayWrap}>
            <View style={[StyleSheet.absoluteFill, styles.turnIntroScoreWrap]}>
              <Text style={[styles.turnIntroScore, isLarge && stylesL.turnIntroScore]} numberOfLines={1}>
                {turnIntro.start}
              </Text>
            </View>
            <View style={styles.turnIntroNameWrap}>
              <Text style={[styles.turnIntroPlayer, isLarge && stylesL.turnIntroPlayer]}>
                {turnIntro.name}
              </Text>
            </View>
          </View>
        )}

        {overlayText && (
          <View style={styles.overlayWrap}>
            <Text
              style={[
                styles.overlayText,
                isLarge && stylesL.overlayText,
                overlayText !== "No Score" && styles.overlayTextLarge,
                overlayText !== "No Score" && isLarge && stylesL.overlayTextLarge,
              ]}
            >
              {overlayText}
            </Text>
          </View>
        )}
        {closestToBullActive && !showThrowOrderSetOverlay && (
          <View pointerEvents="none" style={styles.closestOverlay}>
            <Text style={styles.closestOverlayText}>{closestToBullOrder[closestToBullIndex] ?? "—"}</Text>
          </View>
        )}
        {closestToBullActive && showCtBMissOverlay && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.ctbMissOverlayWrap, { opacity: ctbMissOpacityRef }]}
          >
            <Text style={styles.ctbMissOverlayText}>Miss</Text>
          </Animated.View>
        )}
        {closestToBullActive && showThrowOrderSetOverlay && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ctbMissOverlayWrap]}>
            <Text style={styles.ctbThrowOrderSetTitle}>Throw Order Set</Text>
            <Text style={styles.ctbThrowOrderSetSub}>
              {throwOrderSetWinnerName ?? "—"} is closest to the bull
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  const leftColumn = isLandscape ? boardBlock : (
    <>
      {showMatchUi && cardBlock}
      {boardBlock}
    </>
  );

  const rightColumn = showMatchUi ? (isLandscape ? (
    <View style={styles.rightColumnContent}>
      {cardBlock}
      <ScrollView
        ref={scrollLandscapeRef}
        contentContainerStyle={[
          styles.grid,
          styles.gridLandscape,
          { paddingBottom: Platform.OS === "ios" ? 10 : 6 },
        ]}
        style={styles.scoresScrollLandscape}
      >
        {state.players.map((p: any, idx: number) => {
        const active = idx === state.currentIndex && !winner;
        const shown = active ? toDartLabels(state.turnDarts) : lastTurnByPlayer[idx] ?? [];
        const label = active ? "This turn:" : "Last:";
        const visitTotal = active
          ? state.turnDarts.reduce((acc: number, d: DartCode) => acc + scoreOf(d), 0)
          : (lastTurnByPlayer[idx] ?? []).reduce(
              (acc: number, dartLabel: string) => acc + scoreOf(dartLabel as DartCode),
              0
            );
        const rewardHighlight: TurnReward = active ? getTurnRewardType(state) : lastTurnRewardByPlayer[idx];

        return (
          <View
            key={idx}
            onLayout={(e) => {
              const { x, y } = e.nativeEvent.layout;
              if (!cardOffsets.current[idx]) cardOffsets.current[idx] = { x: 0, y: 0 };
              cardOffsets.current[idx] = { x, y };
            }}
            style={[
              styles.pcard,
              isLarge && stylesL.pcard,
              isLandscape && styles.pcardLandscape,
              active && styles.pcardActive,
            ]}
          >
            <View style={styles.pcardTopRow}>
              <Text style={[styles.pname, isLarge && stylesL.pname]} numberOfLines={1}>
                {p.name}
              </Text>
              {!winner && active && checkoutUiEnabled && checkoutText !== "—" && (
                <Text
                  style={[styles.pcardCheckout, isLarge && stylesL.pcardCheckout]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                >
                  {checkoutText}
                </Text>
              )}
            </View>

            <Text style={[styles.pbig, isLarge && stylesL.pbig]}>{p.remaining}</Text>

            <Text style={[styles.psub, isLarge && stylesL.psub]}>
              Rewards: {state.tokens[idx]}
            </Text>

            {!winner && (
              <View style={styles.pcardTurnBlock}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 4 }}>
                  <Text style={[styles.ptag, isLarge && stylesL.ptag]}>{label}</Text>
                  {shown.length > 0 && (
                    <Text
                      style={[
                        styles.ptag,
                        isLarge && stylesL.ptag,
                        rewardHighlight === "bonus" && [
                          styles.ptagScoreBonus,
                          isLarge && stylesL.ptagScoreBonus,
                        ],
                        rewardHighlight === "jackpot" && [
                          styles.ptagScoreJackpot,
                          isLarge && stylesL.ptagScoreJackpot,
                        ],
                      ]}
                    >
                      {visitTotal}
                    </Text>
                  )}
                </View>

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
      {actionRows}
    </View>
  ) : (
    <>
      <ScrollView
        ref={scrollPortraitRef}
        contentContainerStyle={[
          styles.grid,
          styles.gridPortrait,
          { paddingBottom: Platform.OS === "ios" ? 10 : 6 },
        ]}
        style={styles.scoresScroll}
        showsVerticalScrollIndicator={false}
      >
        {state.players.map((p: any, idx: number) => {
          const active = idx === state.currentIndex && !winner;
          const shown = active ? toDartLabels(state.turnDarts) : lastTurnByPlayer[idx] ?? [];
          const label = active ? "This turn:" : "Last:";
          const visitTotal = active
            ? state.turnDarts.reduce((acc: number, d: DartCode) => acc + scoreOf(d), 0)
            : (lastTurnByPlayer[idx] ?? []).reduce(
                (acc: number, dartLabel: string) => acc + scoreOf(dartLabel as DartCode),
                0
              );
          const rewardHighlight: TurnReward = active ? getTurnRewardType(state) : lastTurnRewardByPlayer[idx];

          return (
            <View
              key={idx}
              onLayout={(e) => {
                const { x, y } = e.nativeEvent.layout;
                if (!cardOffsets.current[idx]) cardOffsets.current[idx] = { x: 0, y: 0 };
                cardOffsets.current[idx] = { x, y };
              }}
              style={[
                styles.pcard,
                styles.pcardPortrait,
                isLarge && stylesL.pcard,
                active && styles.pcardActive,
              ]}
            >
              <View style={styles.pcardTopRow}>
                <Text style={[styles.pname, isLarge && stylesL.pname]} numberOfLines={1}>
                  {p.name}
                </Text>
                {!winner && active && checkoutUiEnabled && checkoutText !== "—" && (
                  <Text
                    style={[styles.pcardCheckout, isLarge && stylesL.pcardCheckout]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {checkoutText}
                  </Text>
                )}
              </View>

              <Text style={[styles.pbig, isLarge && stylesL.pbig]}>{p.remaining}</Text>

              <Text style={[styles.psub, isLarge && stylesL.psub]}>
                Rewards: {state.tokens[idx]}
              </Text>

              {!winner && (
                <View style={styles.pcardTurnBlock}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 4 }}>
                    <Text style={[styles.ptag, isLarge && stylesL.ptag]}>{label}</Text>
                    {shown.length > 0 && (
                      <Text
                        style={[
                          styles.ptag,
                          isLarge && stylesL.ptag,
                          rewardHighlight === "bonus" && [
                            styles.ptagScoreBonus,
                            isLarge && stylesL.ptagScoreBonus,
                          ],
                          rewardHighlight === "jackpot" && [
                            styles.ptagScoreJackpot,
                            isLarge && stylesL.ptagScoreJackpot,
                          ],
                        ]}
                      >
                        {visitTotal}
                      </Text>
                    )}
                  </View>

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
      {actionRows}
    </>
  )) : null;

  return (
    <SafeAreaView style={styles.safe}>
      {takeoutStallModal}
      <View style={[styles.container, isLandscape && styles.containerLandscape]}>
        {topBar}
        {isLandscape ? (
          closestToBullActive ? (
            <View style={styles.closestLandscapeCenter}>{boardBlock}</View>
          ) : (
            <View style={styles.landscapeContentRow}>
              <View style={[styles.leftColumn, styles.leftColumnLandscape]}>{leftColumn}</View>
              <View style={[styles.rightColumn, styles.rightColumnLandscape]}>{rightColumn}</View>
            </View>
          )
        ) : (
          <>
            {leftColumn}
            {rightColumn}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  container: { flex: 1, padding: 12, gap: 10, backgroundColor: "#F8FAFC" },
  containerLandscape: {
    padding: 10,
    gap: 8,
  },
  landscapeContentRow: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    gap: 8,
  },

  leftColumn: {
    flex: 3,
    minWidth: 0,
    gap: 8,
    justifyContent: "flex-start",
  },
  leftColumnLandscape: { flex: 7 },
  rightColumn: {
    flex: 2,
    minWidth: 0,
  },
  rightColumnLandscape: { flex: 3 },
  rightColumnContent: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },

  header: { gap: 2 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 10,
  },
  exitLink: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  exitLinkText: { color: "#111827", fontWeight: "800", fontSize: 15 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  autoDot: { width: 10, height: 10, borderRadius: 999 },
  autoDotOn: { backgroundColor: "#16A34A" },
  autoDotOff: { backgroundColor: "#9CA3AF" },

  h1: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 12, opacity: 0.7 },
  subClosest: { fontSize: 17, fontWeight: "800", opacity: 0.9 },

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

  turnTitle: { fontSize: 22, fontWeight: "900", flexShrink: 1 },

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

  boardArea: { alignItems: "center", justifyContent: "center", marginTop: -26, marginLeft: -12 },
  boardAreaLandscape: { flex: 1, justifyContent: "center", marginTop: -22, marginLeft: -10 },
  boardAreaClosest: { marginTop: 0, marginLeft: 0 },
  closestModeLabel: { marginBottom: 10, color: "#0F172A", fontWeight: "900", fontSize: 20 },
  closestLandscapeCenter: { flex: 1, alignItems: "center", justifyContent: "center" },

  scoresScroll: { marginTop: 10 },
  scoresScrollLandscape: { marginTop: 0, flex: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridPortrait: { flexWrap: "nowrap" },
  gridLandscape: { flexDirection: "column", flexWrap: "nowrap", gap: 8 },

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
    color: "rgba(255,255,255,0.88)",
    fontWeight: "900",
    fontSize: 72,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  overlayTextLarge: { fontSize: 110 },
  closestOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "12%",
    alignItems: "center",
    pointerEvents: "none",
  },
  closestOverlayText: {
    color: "white",
    fontWeight: "900",
    fontSize: 56,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  ctbMissOverlayWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  ctbMissOverlayText: {
    color: "white",
    fontWeight: "900",
    fontSize: 72,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  ctbThrowOrderSetTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 72,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  ctbThrowOrderSetSub: {
    color: "rgba(255,255,255,0.9)",
    fontWeight: "700",
    fontSize: 28,
    marginTop: 12,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },

  turnIntroNameWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: "65%",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  turnIntroScoreWrap: {
    justifyContent: "center",
    alignItems: "center",
  },
  turnIntroScore: {
    width: "100%",
    textAlign: "center",
    color: "white",
    fontWeight: "900",
    fontSize: 110,
    lineHeight: 130,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  turnIntroPlayer: {
    color: "white",
    fontWeight: "900",
    fontSize: 58,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },

  actionRow: { flexDirection: "row", gap: 10, marginTop: 2 },

  btnMiniAlt: {
    flex: 0.5,
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
  autoBoardBtn: {
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
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  btnWideTextPrimary: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },

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
  pcardPortrait: { flex: 1, flexBasis: 0, minWidth: 0 },
  pcardActive: { borderColor: "#2563EB", borderWidth: 2 },
  pcardLandscape: { flexBasis: "auto", flexGrow: 0, minHeight: 100 },

  pcardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pname: { fontWeight: "900", fontSize: 18, flexShrink: 1, minWidth: 0 },
  pbig: { marginTop: 4, fontWeight: "900", fontSize: 28 },
  psub: { marginTop: 2, opacity: 0.7, fontWeight: "800", fontSize: 16 },
  pcardCheckout: { fontWeight: "900", fontSize: 20, color: "#111827", flexShrink: 0 },
  ptag: { marginTop: 4, opacity: 0.75, fontWeight: "900", fontSize: 16 },
  ptagScoreBonus: { fontWeight: "900", fontSize: 20, color: "#22c522" },
  ptagScoreJackpot: { fontWeight: "900", fontSize: 22, color: "#ff073a" },
  pcardTurnBlock: { marginTop: 4, gap: 4 },

  dartRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dartPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  dartPillText: { fontWeight: "900", fontSize: 14, opacity: 0.85 },

  noneText: { fontWeight: "900", opacity: 0.45, fontSize: 13 },
});

const stylesL = StyleSheet.create({
  h1: { fontSize: 30 },
  sub: { fontSize: 15 },
  closestModeLabel: { fontSize: 24 },
  subClosest: { fontSize: 20 },

  card: { padding: 18, borderRadius: 16 },
  turnTitle: { fontSize: 26 },

  checkoutHuge: { fontSize: 34, lineHeight: 36 },
  checkoutPlaceholder: { fontSize: 34, lineHeight: 36 },

  winner: { fontSize: 22 },
  winnerSub: { fontSize: 16 },

  overlayText: { fontSize: 120 },
  overlayTextLarge: { fontSize: 160 },

  turnIntroPlayer: { fontSize: 72 },
  turnIntroScore: { fontSize: 160, lineHeight: 190 },



  actionRow: { gap: 12 },

  btnMiniAlt: { flex: 0.45, paddingVertical: 16, borderRadius: 14 },
  btnMiniText: { fontSize: 22, letterSpacing: 0.5 },

  btnWideAlt: { flex: 1.05, paddingVertical: 16, borderRadius: 14 },

  btnWideTextAlt: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },

  btnWidePrimary: { flex: 1.25, paddingVertical: 16, borderRadius: 14 },
  btnWideTextPrimary: { fontSize: 20, letterSpacing: 0.5 },

  pcard: { flexBasis: "23%", padding: 16, borderRadius: 16, minHeight: 140 },
  pname: { fontSize: 22 },
  pbig: { fontSize: 32 },
  psub: { fontSize: 18 },
  pcardCheckout: { fontSize: 22 },
  ptag: { fontSize: 18 },
  ptagScoreBonus: { fontSize: 22, color: "#22c522" },
  ptagScoreJackpot: { fontSize: 24, color: "#ff073a" },

  noneText: { fontSize: 14 },
});
