// src/screens/KillerGameScreen.tsx
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
  SafeAreaView,
  Platform,
  Animated,
  Easing,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import type { DartCode } from "../engine/matchEngine";
import {
  createKillerState,
  applyKillerDart,
  endKillerTurn,
  removeLastDart,
  backTurn,
  getTurnHistoryLen,
  getCurrentPlayer,
  type KillerGameState,
  type KillerPlayer,
} from "../engine/killerEngine";
import Dartboard, { type KillerSegment } from "../components/Dartboard";
import { AUTO_BASE_URL, AUTO_WS_URL } from "../config/autodarts";
import { useTakeoutStallWarning } from "../autodarts/useTakeoutStallWarning";
import { useDartSounds } from "../hooks/useDartSounds";

type Props = NativeStackScreenProps<RootStackParamList, "KillerGame">;

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Standard board order clockwise from top (20) — used for balanced layout (Killer only)
const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/**
 * Balanced layout (Killer only): evenly spaced around the board, varying between games.
 * Builds one canonical evenly-spaced set of board indices, then applies a random rotation
 * so the same cardinal-style positions (e.g. 20, 6, 2, 11) are not used every time.
 */
function allocateNumbersBalanced(playerCount: number): number[] {
  const n = Math.min(Math.max(1, playerCount), 20);
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    used.add(Math.round((i * 20) / n) % 20);
  }
  for (let j = 0; j < 20 && used.size < n; j++) {
    used.add(j);
  }
  const baseIndices = [...used].slice(0, n);
  const rotation = Math.floor(Math.random() * 20);
  const rotated = baseIndices.map((idx) => (idx + rotation) % 20);
  return rotated.map((idx) => BOARD_ORDER[idx]);
}

function allocateNumbers(
  playerCount: number,
  layout: "shuffle" | "balanced" = "shuffle"
): number[] {
  if (layout === "balanced") {
    return allocateNumbersBalanced(playerCount);
  }
  return shuffleArray(Array.from({ length: 20 }, (_, i) => i + 1)).slice(0, playerCount);
}

type AutoDartsSegment = { name?: string; number?: number; multiplier?: number };
type AutoDartsThrow = { segment?: AutoDartsSegment; coords?: { x: number; y: number } };

function segmentToDartCode(seg: AutoDartsSegment | undefined | null): DartCode | null {
  if (!seg) return null;
  const rawName = String(seg.name ?? "").trim();
  if (rawName.toUpperCase().startsWith("M")) return "MISS";
  const n = Number(seg.number ?? NaN);
  const mult = Number(seg.multiplier ?? NaN);
  if (rawName.toLowerCase() === "bull" || n === 25) {
    if (mult === 2) return "DB";
    return "SB";
  }
  const m = rawName.match(/^([SDT])\s*(\d{1,2})$/i);
  if (m) {
    const letter = m[1].toUpperCase() as "S" | "D" | "T";
    const num = Number(m[2]);
    if (Number.isFinite(num) && num >= 1 && num <= 20) return `${letter}${num}` as DartCode;
  }
  if (Number.isFinite(n) && n >= 1 && n <= 20) {
    if (mult === 3) return `T${n}` as DartCode;
    if (mult === 2) return `D${n}` as DartCode;
    if (mult === 1) return `S${n}` as DartCode;
  }
  return "MISS";
}

function EliminatedOverlay() {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const popIn = Animated.parallel([
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.12, duration: 120, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]),
      Animated.timing(opacityAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]);
    const shake = Animated.timing(shakeAnim, { toValue: 1, duration: 120, useNativeDriver: true });
    Animated.sequence([
      popIn,
      Animated.delay(50),
      shake,
    ]).start();
  }, [scaleAnim, shakeAnim, opacityAnim]);

  const translateX = shakeAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -3, 3, -2, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.eliminatedOverlay,
        {
          opacity: opacityAnim,
          transform: [
            { scale: scaleAnim },
            { translateX },
          ],
        },
      ]}
    >
      <Text style={styles.eliminatedShield}>💔</Text>
    </Animated.View>
  );
}

export default function KillerGameScreen({ navigation, route }: Props) {
  const setup = route.params.setup;
  const screenWidth = useWindowDimensions().width;
  const screenHeight = useWindowDimensions().height;
  const isLandscape = screenWidth > screenHeight;
  const base = Math.min(screenWidth, screenHeight);
  const isLarge = base >= 900;

  const [darkMode] = useState(() => route.params.setup.darkMode ?? true);
  const [state, setState] = useState<KillerGameState | null>(() => {
    if (setup.closestToBull) return null;
    const layout = setup.numberLayout ?? "shuffle";
    const nums = allocateNumbers(setup.players.length, layout);
    const playersWithNumbers = setup.players.map((p, i) => ({
      ...p,
      assignedNumber: nums[i] ?? 1,
    }));
    return createKillerState({
      ...setup,
      players: playersWithNumbers,
    });
  });
  const [spinAnim] = useState(() => new Animated.Value(0));
  const [isSpinning, setIsSpinning] = useState(false);
  const [hitMarkers, setHitMarkers] = useState<{ x: number; y: number }[]>([]);
  const [throwsThisTurn, setThrowsThisTurn] = useState(0);
  const throwsThisTurnRef = useRef(0);
  const takeoutHandledThisTurnRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { playHit, playKilled, playBonus } = useDartSounds();
  const playHitRef = useRef(playHit);
  const playKilledRef = useRef(playKilled);
  const playBonusRef = useRef(playBonus);
  useEffect(() => {
    playHitRef.current = playHit;
    playKilledRef.current = playKilled;
    playBonusRef.current = playBonus;
  }, [playHit, playKilled, playBonus]);

  const scrollViewRef = useRef<ScrollView>(null);
  const cardYOffsetsRef = useRef<number[]>([]);

  const prevEliminatedCountRef = useRef(0);
  useEffect(() => {
    if (!state) return;
    const eliminatedCount = state.players.filter((p) => p.isEliminated).length;
    if (eliminatedCount > prevEliminatedCountRef.current) {
      playKilledRef.current?.();
    }
    prevEliminatedCountRef.current = eliminatedCount;
  }, [state]);

  const placementRewardPlayedRef = useRef(false);
  useEffect(() => {
    if (!state || !state.winnerId || !state.settings.placementRewardsEnabled) return;
    if (placementRewardPlayedRef.current) return;
    placementRewardPlayedRef.current = true;
    playBonusRef.current?.();
  }, [state]);

  const current = state ? getCurrentPlayer(state) : null;
  const winner =
    state && state.winnerId
      ? state.players.find((p) => p.id === state.winnerId)
      : null;
  const winnerName = winner?.name ?? null;

  // Scroll active player card into view when turn changes
  useEffect(() => {
    if (!state || winner != null) return;
    const idx = state.currentPlayerIndex;
    const timer = setTimeout(() => {
      const y = cardYOffsetsRef.current[idx];
      if (typeof y === "number" && scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          y: Math.max(0, y - 16),
          animated: true,
        });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [state?.currentPlayerIndex, winner]);

  const armPoints = state?.settings.armPoints ?? 3;
  const maxLives = state?.settings.lives ?? 3;
  const armMode = state?.settings.armMode ?? "points";
  const fullLivesToArm = state?.settings.fullLivesToArm ?? false;
  const placementOn = state?.settings.placementRewardsEnabled ?? false;
  const killRewardsOn = state?.settings.killRewardsEnabled ?? false;

  // Board sizing: same as MatchGameScreen (landscape = fill left column; portrait = 75% width, cap by height)
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

  const [boardProfileMode, setBoardProfileMode] = useState<"auto" | "manual">("auto");
  const usingAutoBoard = boardProfileMode === "auto";

  const [closestToBullActive, setClosestToBullActive] = useState<boolean>(!!setup.closestToBull);
  const [closestToBullOrder] = useState<string[]>(() =>
    shuffleArray(setup.players.map((p) => p.name))
  );
  const [closestToBullIndex, setClosestToBullIndex] = useState(0);
  const [closestToBullResults, setClosestToBullResults] = useState<Record<string, number>>({});
  const closestToBullActiveRef = useRef<boolean>(!!setup.closestToBull);
  const closestToBullIndexRef = useRef(0);
  const closestToBullResultsRef = useRef<Record<string, number>>({});
  const closestAwaitingFinalTakeoutRef = useRef(false);
  const [showCtBMissOverlay, setShowCtBMissOverlay] = useState(false);
  const ctbMissOpacityRef = useRef(new Animated.Value(0)).current;
  const triggerCtBMissOverlayRef = useRef<() => void>(() => {});
  const pendingNextCtBIndexRef = useRef<number | null>(null);
  const [showThrowOrderSetOverlay, setShowThrowOrderSetOverlay] = useState(false);
  const [throwOrderSetWinnerName, setThrowOrderSetWinnerName] = useState<string | null>(null);
  const showThrowOrderSetOverlayRef = useRef<(winnerName: string) => void>(() => {});
  const takeoutInProgressRef = useRef(false);

  useEffect(() => {
    closestToBullActiveRef.current = closestToBullActive;
  }, [closestToBullActive]);
  useEffect(() => {
    closestToBullIndexRef.current = closestToBullIndex;
  }, [closestToBullIndex]);
  useEffect(() => {
    showThrowOrderSetOverlayRef.current = (winnerName: string) => {
      setShowThrowOrderSetOverlay(true);
      setThrowOrderSetWinnerName(winnerName);
    };
    return () => {
      showThrowOrderSetOverlayRef.current = () => {};
    };
  }, []);
  useEffect(() => {
    triggerCtBMissOverlayRef.current = () => setShowCtBMissOverlay(true);
    return () => {
      triggerCtBMissOverlayRef.current = () => {};
    };
  }, []);

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
    const playersOrdered = ordered
      .map((name) => setup.players.find((p) => p.name === name))
      .filter((p): p is { name: string; playerColor: string } => !!p);
    if (playersOrdered.length !== setup.players.length) return;
    const layout = setup.numberLayout ?? "shuffle";
    const nums = allocateNumbers(playersOrdered.length, layout);
    const playersWithNumbers = playersOrdered.map((p, i) => ({
      ...p,
      assignedNumber: nums[i] ?? 1,
    }));
    setState(
      createKillerState({
        ...setup,
        players: playersWithNumbers,
      })
    );
    setClosestToBullActive(false);
    closestToBullActiveRef.current = false;
    setClosestToBullIndex(0);
    closestToBullIndexRef.current = 0;
    closestAwaitingFinalTakeoutRef.current = false;
    setHitMarkers([]);
    setIsSpinning(true);
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 5000,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start(() => setIsSpinning(false));
  }, [closestToBullOrder, setup]);

  const recordClosestToBullThrow = useCallback(
    (dist: number, deferAdvance?: boolean) => {
      if (!closestToBullActiveRef.current) return;
      if (closestAwaitingFinalTakeoutRef.current) return;
      const player = closestToBullOrder[closestToBullIndexRef.current];
      if (!player) return;
      const nextResults = { ...closestToBullResultsRef.current, [player]: dist };
      closestToBullResultsRef.current = nextResults;
      setClosestToBullResults(nextResults);
      const nextIndex = closestToBullIndexRef.current + 1;
      const triggerThrowOrderOverlay = () => {
        const res = closestToBullResultsRef.current;
        const indexOf = new Map<string, number>();
        closestToBullOrder.forEach((p, i) => indexOf.set(p, i));
        const ordered = [...closestToBullOrder].sort((a, b) => {
          const da = res[a] ?? Number.POSITIVE_INFINITY;
          const db = res[b] ?? Number.POSITIVE_INFINITY;
          if (da !== db) return da - db;
          return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
        });
        showThrowOrderSetOverlayRef.current?.(ordered[0] ?? "—");
      };
      if (deferAdvance) {
        closestToBullIndexRef.current = nextIndex;
        if (nextIndex >= closestToBullOrder.length) {
          closestAwaitingFinalTakeoutRef.current = true;
          triggerThrowOrderOverlay();
        }
        pendingNextCtBIndexRef.current = nextIndex;
        return;
      }
      if (nextIndex >= closestToBullOrder.length) {
        closestAwaitingFinalTakeoutRef.current = true;
        triggerThrowOrderOverlay();
        return;
      }
      setClosestToBullIndex(nextIndex);
      closestToBullIndexRef.current = nextIndex;
    },
    [closestToBullOrder]
  );

  const undoLastCtBThrow = useCallback(() => {
    if (!closestToBullActiveRef.current) return;
    const idx = closestToBullIndexRef.current;
    const prevIndex =
      showThrowOrderSetOverlay || idx >= closestToBullOrder.length
        ? closestToBullOrder.length - 1
        : idx - 1;
    if (prevIndex < 0) return;
    const playerToRemove = closestToBullOrder[prevIndex];
    if (!playerToRemove) return;
    const nextResults = { ...closestToBullResultsRef.current };
    delete nextResults[playerToRemove];
    closestToBullResultsRef.current = nextResults;
    setClosestToBullResults(nextResults);
    setClosestToBullIndex(prevIndex);
    closestToBullIndexRef.current = prevIndex;
    if (showThrowOrderSetOverlay || idx >= closestToBullOrder.length) {
      closestAwaitingFinalTakeoutRef.current = false;
      setShowThrowOrderSetOverlay(false);
    }
    setHitMarkers((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, [closestToBullOrder, showThrowOrderSetOverlay]);

  const canUndoCtB = closestToBullActive && (closestToBullIndex > 0 || showThrowOrderSetOverlay);

  const forceBoardReset = useCallback(async () => {
    try {
      await fetch(`${AUTO_BASE_URL}/api/reset`, { method: "POST" });
      seenThrowKeysRef.current = new Set();
    } catch (_) {}
  }, []);

  const markerFromAutoCoords = useCallback(
    (coords?: { x?: number; y?: number } | null) => {
      const x = coords?.x;
      const y = coords?.y;
      if (typeof x !== "number" || typeof y !== "number") return null;
      const absMax = Math.max(Math.abs(x), Math.abs(y));
      if (absMax <= 1.5) {
        const nx = Math.max(-1.25, Math.min(1.25, x));
        const ny = Math.max(-1.25, Math.min(1.25, y));
        const profileScale = usingAutoBoard ? 1.0 : 0.94;
        const rOuter = boardSize * (isLarge ? 0.47 : 0.43) * profileScale;
        const cx = boardSize / 2;
        const cy = boardSize / 2;
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

  const highlightTarget = state && current && !winner ? current.assignedNumber : null;

  // When armed: pulse targetable opponents; if recharge ON and can replenish, pulse own number and targets simultaneously
  const targetableNumbers = useMemo(() => {
    if (!state || !current?.isArmed || winner) return [];
    const targetable = state.targetableThisTurn;
    if (!targetable) return [];
    return state.players
      .filter((p) => !p.isEliminated && p.id !== current.id && targetable.has(p.id))
      .map((p) => p.assignedNumber);
  }, [state, current?.id, current?.isArmed, winner]);

  const killerPulseNumbers = useMemo((): number[] | undefined => {
    if (!state || !current || winner) return undefined;
    if (!current.isArmed) return [current.assignedNumber]; // unarmed: always pulse own number only
    const targetable = targetableNumbers;
    const ownNum = current.assignedNumber;
    const canReplenish = state.settings.recharge && current.livesRemaining < state.settings.lives;
    if (canReplenish) {
      // Recharge on + can replenish: pulse own number and target numbers simultaneously
      const combined = new Set([ownNum, ...targetable]);
      return Array.from(combined);
    }
    return targetable;
  }, [state, current, winner, targetableNumbers]);

  // Arm remaining only: max(0, ArmReq - armProgress). Used for player card.
  const armRemainingOnly = useCallback(
    (p: { armProgress: number; isArmed: boolean; isEliminated: boolean }) => {
      if (p.isEliminated || p.isArmed) return 0;
      return armMode === "points" ? Math.max(0, armPoints - p.armProgress) : 1;
    },
    [armPoints, armMode]
  );

  // Ring/header: total required = livesMissing + armRemaining. When Full Lives to Arm OFF, just armRemaining.
  const totalHitsToArm = useCallback(
    (p: { livesRemaining: number; armProgress: number; isArmed: boolean; isEliminated: boolean }) => {
      if (p.isEliminated || p.isArmed) return 0;
      const armRem = armMode === "points" ? Math.max(0, armPoints - p.armProgress) : 1;
      if (!fullLivesToArm) return armRem;
      const livesMissing = Math.max(0, maxLives - p.livesRemaining);
      return livesMissing + armRem;
    },
    [maxLives, armPoints, armMode, fullLivesToArm]
  );

  const killerSegments: KillerSegment[] = useMemo(() => {
    if (!state) return [];
    const currentId = current?.id ?? null;
    const targetable = state.targetableThisTurn;
    return state.players.map((p) => {
      const total = totalHitsToArm(p);
      return {
        number: p.assignedNumber,
        color: p.color,
        lives: p.livesRemaining,
        maxLives: state.settings.lives,
        isArmed: p.isArmed,
        isEliminated: p.isEliminated,
        armRemaining: !p.isArmed && !p.isEliminated && total > 0 ? total : undefined,
        isProtected:
          !!current?.isArmed &&
          !p.isEliminated &&
          currentId != null &&
          p.id !== currentId &&
          !(targetable != null && targetable.has(p.id)),
      };
    });
  }, [state, current?.id, current?.isArmed, totalHitsToArm]);

  const handleDart = useCallback(
    (dart: DartCode) => {
      if (!state || state.winnerId) return;
      if (throwsThisTurnRef.current >= 3) return;
      setState((s) => (s ? applyKillerDart(s, dart) : s));
      throwsThisTurnRef.current += 1;
      setThrowsThisTurn((n) => Math.min(3, n + 1));
    },
    [state?.winnerId]
  );

  const handleNextTurn = useCallback(() => {
    if (!state || state.winnerId) return;
    takeoutHandledThisTurnRef.current = false;
    throwsThisTurnRef.current = 0;
    setThrowsThisTurn(0);
    setHitMarkers([]);
    seenThrowKeysRef.current = new Set();
    setState((s) => (s ? endKillerTurn(s) : s));
  }, [state?.winnerId]);

  const spinRotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "1440deg"],
  });

  useEffect(() => {
    if (setup.closestToBull) return;
    setIsSpinning(true);
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 5000,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start(() => setIsSpinning(false));
  }, [setup.closestToBull]);

  // AutoDarts
  const [autoConnected, setAutoConnected] = useState(false);
  const [autoStatus, setAutoStatus] = useState("");
  const [autoNumThrows, setAutoNumThrows] = useState(0);
  const [autoResetting, setAutoResetting] = useState(false);
  const seenThrowKeysRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetLabel = useMemo(() => {
    if (autoResetting) return "…";
    const s = (autoStatus ?? "").toLowerCase();
    if (s.includes("takeout")) return "Reset (Takeout)";
    const n = autoNumThrows ?? 0;
    if (n === 1) return "Reset (1/3)";
    if (n === 2) return "Reset (2/3)";
    if (n >= 3) return "Reset (3/3)";
    return "Reset";
  }, [autoStatus, autoNumThrows, autoResetting]);

  const restartLabel = useMemo(() => {
    if (autoResetting) return "…";
    const s = (autoStatus ?? "").toLowerCase();
    if (s.includes("stopped")) return "Restart (Stopped)";
    return "Restart";
  }, [autoStatus, autoResetting]);

  const resetAutoDarts = useCallback(async () => {
    if (autoResetting) return;
    setAutoResetting(true);
    try {
      await fetch(`${AUTO_BASE_URL}/api/reset`, { method: "POST" });
      seenThrowKeysRef.current = new Set();
    } catch (e) {
      console.warn("AutoDarts reset failed", e);
    } finally {
      setAutoResetting(false);
    }
  }, [autoResetting]);

  const restartAutoDarts = useCallback(async () => {
    if (autoResetting) return;
    setAutoResetting(true);
    try {
      await fetch(`${AUTO_BASE_URL}/api/start`, { method: "PUT" });
      seenThrowKeysRef.current = new Set();
    } catch (e) {
      console.warn("AutoDarts restart failed", e);
    } finally {
      setAutoResetting(false);
    }
  }, [autoResetting]);

  const isTakeoutInProgress = useMemo(() => {
    const s = (autoStatus ?? "").toLowerCase();
    return s.includes("takeout") && s.includes("progress");
  }, [autoStatus]);
  const onResetTakeoutKiller = useCallback(() => {
    takeoutInProgressRef.current = false;
    forceBoardReset().catch(() => {});
  }, [forceBoardReset]);
  const { takeoutStallModal } = useTakeoutStallWarning({
    isTakeoutInProgress,
    onResetTakeout: onResetTakeoutKiller,
    turnKey: state?.currentPlayerIndex ?? -1,
  });

  useEffect(() => {
    function connect() {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      const ws = new WebSocket(AUTO_WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setAutoConnected(true);
        fetch(`${AUTO_BASE_URL}/api/state`)
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
        wsRef.current = null;
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        setAutoConnected(false);
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 3000);
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
        const statusStr = nextStatus.toLowerCase();
        const isTakeout =
          statusStr.includes("takeout") && statusStr.includes("progress");
        takeoutInProgressRef.current = isTakeout;
        if (isTakeout) setHitMarkers([]);

        if (isTakeout && closestAwaitingFinalTakeoutRef.current) {
          finalizeClosestToBull();
          return;
        }
        if (
          isTakeout &&
          !takeoutHandledThisTurnRef.current &&
          throwsThisTurnRef.current >= 1 &&
          stateRef.current
        ) {
          takeoutHandledThisTurnRef.current = true;
          seenThrowKeysRef.current = new Set();
          throwsThisTurnRef.current = 0;
          setThrowsThisTurn(0);
          setHitMarkers([]);
          setState((prev) => {
            if (!prev || prev.winnerId) return prev;
            return endKillerTurn(prev);
          });
          takeoutHandledThisTurnRef.current = false;
          return;
        }

        const throwsArr: AutoDartsThrow[] = Array.isArray(data.throws) ? data.throws : [];
        if (!throwsArr.length) return;

        if (closestToBullActiveRef.current) {
          if (takeoutInProgressRef.current) return;
          const newMarkersCtB: { x: number; y: number }[] = [];
          for (let i = 0; i < throwsArr.length; i++) {
            const t = throwsArr[i];
            const key = `ctb-${t?.segment?.name ?? ""}-${t?.segment?.number ?? ""}-${i}`;
            if (seenThrowKeysRef.current.has(key)) continue;
            seenThrowKeysRef.current.add(key);
            const dist = distanceFromAutoCoords((t as any)?.coords);
            const isMiss = typeof dist !== "number" || !Number.isFinite(dist);
            if (isMiss) triggerCtBMissOverlayRef.current?.();
            recordClosestToBullThrow(
              typeof dist === "number" && Number.isFinite(dist) ? dist : Number.POSITIVE_INFINITY,
              isMiss
            );
            const m = markerFromAutoCoords((t as any)?.coords);
            if (m) newMarkersCtB.push(m);
            playHitRef.current?.();
          }
          if (newMarkersCtB.length) {
            setHitMarkers((prev) => [...prev, ...newMarkersCtB].slice(-Math.max(3, closestToBullOrder.length)));
          }
          const nextIdx = closestToBullIndexRef.current;
          if (nextIdx > 0 && nextIdx < closestToBullOrder.length && nextIdx % 3 === 0 && !closestAwaitingFinalTakeoutRef.current) {
            setTimeout(() => forceBoardReset().catch(() => {}), 150);
          }
          return;
        }

        if (!stateRef.current || stateRef.current.winnerId) return;
        const toProcess: { t: AutoDartsThrow; key: string }[] = [];
        for (let i = 0; i < Math.min(throwsArr.length, 3); i++) {
          const t = throwsArr[i];
          const key = `${t?.segment?.name ?? ""}-${t?.segment?.number ?? ""}-${i}`;
          if (seenThrowKeysRef.current.has(key)) continue;
          toProcess.push({ t, key });
        }
        const slotsLeft = Math.max(0, 3 - throwsThisTurnRef.current);
        const toProcessLimited = toProcess.slice(0, slotsLeft);
        if (!toProcessLimited.length) return;
        toProcessLimited.forEach(({ key }) => seenThrowKeysRef.current.add(key));
        setState((prev) => {
          if (!prev || prev.winnerId) return prev;
          let cur = prev;
          for (const { t } of toProcessLimited) {
            const code = segmentToDartCode(t?.segment);
            if (code) cur = applyKillerDart(cur, code);
            if (cur.winnerId) break;
          }
          return cur;
        });
        throwsThisTurnRef.current += toProcessLimited.length;
        setThrowsThisTurn((n) => Math.min(3, n + toProcessLimited.length));
        const newMarkers: { x: number; y: number }[] = [];
        for (const { t } of toProcessLimited) {
          const m = markerFromAutoCoords(t?.coords);
          if (m) newMarkers.push(m);
          playHitRef.current?.();
        }
        if (newMarkers.length) {
          setHitMarkers((prev) => [...prev, ...newMarkers].slice(-3));
        }
      };
    }
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [
    AUTO_WS_URL,
    AUTO_BASE_URL,
    markerFromAutoCoords,
    distanceFromAutoCoords,
    finalizeClosestToBull,
    recordClosestToBullThrow,
    forceBoardReset,
    closestToBullOrder.length,
  ]);

  const onExit = useCallback(() => {
    navigation.reset({
      index: 1,
      routes: [
        { name: "Lobby" },
        { name: "KillerSetup" },
      ],
    });
  }, [navigation]);

  const theme = darkMode
    ? {
        safe: { backgroundColor: "#0F172A" },
        container: { backgroundColor: "#0F172A" },
        boardBorder: {
          borderWidth: 1.5,
          borderColor: "rgba(148, 163, 184, 0.25)",
          shadowColor: "rgba(148, 163, 184, 0.2)",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 4,
        },
        headerRow: {},
        exitLink: { backgroundColor: "#1E293B", borderColor: "#334155" },
        exitLinkText: { color: "#E2E8F0" },
        h1: { color: "#F8FAFC" },
        sub: { color: "#FFFFFF" },
        card: { backgroundColor: "#1E293B", borderColor: "#334155" },
        turnTitle: { color: "#F8FAFC" },
        winner: { color: "#F8FAFC" },
        winnerSub: { color: "#94A3B8" },
        pcard: { backgroundColor: "#1E293B", borderColor: "#334155" },
        pcardEliminated: { backgroundColor: "#1E293B" },
        pname: { color: "#F8FAFC" },
        psub: { color: "#CBD5E1" },
        ptag: { color: "#CBD5E1" },
        liveBadge: { color: "#34D399" },
        killerPillText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" as const },
        killerPillIcon: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" as const },
        autoResetBtn: { backgroundColor: "#334155" },
        autoRestartBtn: { backgroundColor: "#334155" },
        btnMiniAlt: { backgroundColor: "#334155" },
        btnWideAlt: { backgroundColor: "#334155" },
        btnWidePrimary: { backgroundColor: "#334155" },
      }
    : {
        safe: { backgroundColor: "#F1F5F9" },
        container: { backgroundColor: "#F1F5F9" },
        boardBorder: {
          borderWidth: 1.5,
          borderColor: "rgba(100, 116, 139, 0.35)",
        },
        liveBadge: { color: "#16A34A" },
      };

  const topBar = (
    <View style={[styles.header, styles.headerRow, theme.headerRow]}>
      <Pressable style={[styles.exitLink, theme.exitLink]} onPress={onExit}>
        <Text style={[styles.exitLinkText, theme.exitLinkText]}>‹ Killer Setup</Text>
      </Pressable>
      <Text style={[styles.h1, isLarge && stylesL.h1, { marginLeft: 10 }, theme.h1]}>Killer</Text>
      <View style={[styles.headerThrowingWrap, { flex: 1, marginLeft: 10 }]}>
        {winner ? (
          <Text style={[styles.headerSub, isLarge && stylesL.headerSub, theme.sub]} numberOfLines={1}>
            Winner: {winnerName ?? "—"}
          </Text>
        ) : closestToBullActive ? (
          <Text style={[styles.headerSub, isLarge && stylesL.headerSub, theme.sub]} numberOfLines={1}>
            {closestToBullOrder.length} Players · Closest to Bull • Throwing: {closestToBullOrder[closestToBullIndex] ?? "—"}
          </Text>
        ) : current ? (
          <Text style={[styles.headerSub, isLarge && stylesL.headerSub, theme.sub]} numberOfLines={1}>
            {`Throwing: ${current.name} (#${current.assignedNumber}) • `}
            {current.isEliminated ? (
              "💔 ELIMINATED"
            ) : current.isArmed ? (
              <Text style={[styles.headerSub, isLarge && stylesL.headerSub, theme.sub]}>
                <Text style={[styles.headerSub, isLarge && stylesL.headerSub, styles.liveBadge, theme.liveBadge, darkMode && { color: "#FBBF24" }]}>⚔</Text>
                <Text style={[styles.headerSub, isLarge && stylesL.headerSub, styles.liveBadge, theme.liveBadge]}> Armed</Text>
              </Text>
            ) : fullLivesToArm && current.livesRemaining < maxLives && armRemainingOnly(current) === 0 ? (
              "Full lives to Arm"
            ) : (
              `🎯 ${totalHitsToArm(current)} → Arm`
            )}
            {current.isEliminated ? "" : ` • ❤️ ${current.livesRemaining} ${current.livesRemaining === 1 ? "life" : "lives"}`}
          </Text>
        ) : (
          <Text style={[styles.headerSub, isLarge && stylesL.headerSub, theme.sub]}>—</Text>
        )}
      </View>
      <View style={styles.autoRight}>
        {!closestToBullActive && (
          <Pressable
            style={[styles.autoBoardBtn, theme.autoResetBtn, autoResetting && { opacity: 0.5 }]}
            onPress={() => setBoardProfileMode((m) => (m === "auto" ? "manual" : "auto"))}
            disabled={autoResetting}
          >
            <Text style={styles.autoResetText}>{usingAutoBoard ? "Board: Auto" : "Board: Manual"}</Text>
          </Pressable>
        )}
        {closestToBullActive && (
          <Pressable
            style={[styles.autoResetBtn, theme.autoResetBtn, !canUndoCtB && { opacity: 0.5 }]}
            onPress={undoLastCtBThrow}
            disabled={!canUndoCtB}
          >
            <Text style={styles.autoResetText}>Undo</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.autoResetBtn, theme.autoResetBtn, autoResetting && { opacity: 0.5 }]}
          onPress={resetAutoDarts}
          disabled={autoResetting}
        >
          <Text style={styles.autoResetText}>{resetLabel}</Text>
        </Pressable>
        <Pressable
          style={[styles.autoRestartBtn, theme.autoRestartBtn, autoResetting && { opacity: 0.5 }]}
          onPress={restartAutoDarts}
          disabled={autoResetting}
        >
          <Text style={styles.autoResetText}>{restartLabel}</Text>
        </Pressable>
        <View style={[styles.autoDot, autoConnected ? styles.autoDotOn : styles.autoDotOff]} />
      </View>
    </View>
  );

  const hasKillerRewards = (placementOn || killRewardsOn) && !!state;
  const openKillerResultsDetail = useCallback(() => {
    if (!state || !winner) return;
    const eliminatedOrder = [...state.eliminationOrder].reverse().map((id) => state!.players.find((p) => p.id === id)).filter(Boolean) as typeof state.players;
    const order = [winner, ...eliminatedOrder];
    const playerResults = order.map((p, idx) => ({
      name: p.name,
      place: idx + 1,
      placementReward: p.placementReward,
      killRewardsBalance: p.killRewardsBalance,
      totalRewards: p.placementReward + p.killRewardsBalance,
    }));
    navigation.navigate("GameResultsDetail", {
      gameTitle: "Killer",
      playerNames: state.players.map((p) => p.name),
      winnerIndex: state.players.findIndex((p) => p.id === state!.winnerId),
      payload: { gameType: "killer", playerResults },
    });
  }, [state, winner, navigation]);

  const showKillerUi = !closestToBullActive;
  const cardBlock = showKillerUi && (winner || current) ? (
    <View style={[styles.card, isLarge && stylesL.card, theme.card]}>
      {winner ? (
        hasKillerRewards ? (
          <Pressable onPress={openKillerResultsDetail} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <Text style={[styles.winner, isLarge && stylesL.winner, theme.winner]}>
              🏆 Winner: {winnerName ?? "—"}
            </Text>
            <Text style={[styles.winnerSub, isLarge && stylesL.winnerSub, theme.winnerSub]}>
              Rewards: {winner.placementReward + winner.killRewardsBalance >= 0 ? "+" : ""}{winner.placementReward + winner.killRewardsBalance} · Tap for breakdown
            </Text>
          </Pressable>
        ) : (
          <>
            <Text style={[styles.winner, isLarge && stylesL.winner, theme.winner]}>
              🏆 Winner: {winnerName ?? "—"}
            </Text>
            <Text style={[styles.winnerSub, isLarge && stylesL.winnerSub, theme.winnerSub]}>
              Rewards: {winner.placementReward + winner.killRewardsBalance >= 0 ? "+" : ""}{winner.placementReward + winner.killRewardsBalance}
            </Text>
          </>
        )
      ) : (
        <Text style={[styles.turnTitle, isLarge && stylesL.turnTitle, theme.turnTitle]}>
          Throwing: {current!.name}
        </Text>
      )}
    </View>
  ) : null;

  const canBackspace = !!state && (state.turnDarts?.length ?? 0) > 0;
  const canBackTurn = !!state && getTurnHistoryLen(state) > 0;

  const actionRows = (
    <>
      {!winner && current && (
        <View style={[styles.actionRow, isLarge && stylesL.actionRow]}>
          <Pressable
            style={[
              styles.btnMiniAlt,
              isLarge && stylesL.btnMiniAlt,
              theme.btnMiniAlt,
              !canBackspace && { opacity: 0.35 },
            ]}
            disabled={!canBackspace}
        onPress={() => {
          setState((s) => (s ? removeLastDart(s) : s));
          setHitMarkers((m) => m.slice(0, -1));
          if (throwsThisTurnRef.current > 0) {
            throwsThisTurnRef.current -= 1;
            setThrowsThisTurn((n) => Math.max(0, n - 1));
          }
        }}
          >
            <Text style={[styles.btnMiniText, isLarge && stylesL.btnMiniText]}>⌫</Text>
          </Pressable>

          <Pressable
            style={[
              styles.btnWideAlt,
              isLarge && stylesL.btnWideAlt,
              theme.btnWideAlt,
              !canBackTurn && { opacity: 0.35 },
            ]}
            disabled={!canBackTurn}
            onPress={() => {
              seenThrowKeysRef.current = new Set();
              throwsThisTurnRef.current = 0;
              setThrowsThisTurn(0);
              setHitMarkers([]);
              setState((s) => (s != null ? backTurn(s) : s));
            }}
          >
            <Text style={[styles.btnWideTextAlt, isLarge && stylesL.btnWideTextAlt]}>
              Back
            </Text>
          </Pressable>

          <Pressable
            style={[styles.btnWidePrimary, isLarge && stylesL.btnWidePrimary, theme.btnWidePrimary]}
            onPress={handleNextTurn}
          >
            <Text style={[styles.btnWideTextPrimary, isLarge && stylesL.btnWideTextPrimary]}>
              Next Turn
            </Text>
          </Pressable>
        </View>
      )}

      {winner && state && (
        <View style={[styles.actionRow, isLarge && stylesL.actionRow]}>
          <Pressable
            style={[
              styles.btnMiniAlt,
              isLarge && stylesL.btnMiniAlt,
              theme.btnMiniAlt,
              !canBackspace && { opacity: 0.35 },
            ]}
            disabled={!canBackspace}
            onPress={() => {
              setState((s) => (s ? removeLastDart(s) : s));
              setHitMarkers((m) => m.slice(0, -1));
              if (throwsThisTurnRef.current > 0) {
                throwsThisTurnRef.current -= 1;
                setThrowsThisTurn((n) => Math.max(0, n - 1));
              }
            }}
          >
            <Text style={[styles.btnMiniText, isLarge && stylesL.btnMiniText]}>⌫</Text>
          </Pressable>
          <Pressable
            style={[
              styles.btnWideAlt,
              isLarge && stylesL.btnWideAlt,
              theme.btnWideAlt,
              !canBackTurn && { opacity: 0.35 },
            ]}
            disabled={!canBackTurn}
            onPress={() => {
              seenThrowKeysRef.current = new Set();
              throwsThisTurnRef.current = 0;
              setThrowsThisTurn(0);
              setHitMarkers([]);
              setState((s) => (s ? backTurn(s) : s));
            }}
          >
            <Text style={[styles.btnWideTextAlt, isLarge && stylesL.btnWideTextAlt]}>
              Back
            </Text>
          </Pressable>
        </View>
      )}
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
      <View
        style={[
          styles.boardBorderWrap,
          theme.boardBorder,
          {
            width: boardSize,
            height: boardSize,
            borderRadius: boardSize / 2,
          },
        ]}
      >
        <Animated.View
          style={[
            { position: "relative" },
            isSpinning && { transform: [{ rotate: spinRotation }] },
          ]}
        >
          <Dartboard
            size={boardSize}
            disabled={!!winner || isSpinning}
            boardProfile={closestToBullActive ? "standard" : usingAutoBoard ? "standard" : "manual"}
            highlightTarget={closestToBullActive ? "BULL" : highlightTarget}
            highlightBeds={closestToBullActive ? ["BULL"] : undefined}
            killerSegments={killerSegments}
            killerPulseNumbers={closestToBullActive ? undefined : killerPulseNumbers}
            hitMarkers={hitMarkers}
            maxMarkers={closestToBullActive ? Math.max(3, closestToBullOrder.length) : 3}
            onHitMarker={(pt) => {
              if (closestToBullActive) {
                const cx = boardSize / 2;
                const cy = boardSize / 2;
                const rOuter = boardSize * (isLarge ? 0.47 : 0.43);
                const dist = Math.hypot(pt.x - cx, pt.y - cy) / Math.max(1, rOuter);
                recordClosestToBullThrow(dist);
                setHitMarkers((prev) => [...prev, pt].slice(-Math.max(3, closestToBullOrder.length)));
                playHitRef.current?.();
                return;
              }
              if (throwsThisTurnRef.current >= 3) return;
              setHitMarkers((prev) => [...prev, pt].slice(-3));
            }}
            onDart={(dart) => {
              if (closestToBullActive) return;
              if (throwsThisTurnRef.current >= 3) return;
              playHitRef.current?.();
              handleDart(dart);
            }}
          />
          {closestToBullActive && !showThrowOrderSetOverlay && (
            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
              <View style={styles.closestOverlay}>
                <Text style={styles.closestOverlayText}>{closestToBullOrder[closestToBullIndex] ?? "—"}</Text>
              </View>
            </View>
          )}
          {closestToBullActive && showCtBMissOverlay && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, styles.ctbMissOverlayWrap, { opacity: ctbMissOpacityRef }]}
            >
              <Text style={styles.ctbMissOverlayText}>Miss</Text>
            </Animated.View>
          )}
          {closestToBullActive && showThrowOrderSetOverlay && (
            <Pressable
              style={[StyleSheet.absoluteFillObject, styles.ctbMissOverlayWrap]}
              onPress={finalizeClosestToBull}
            >
              <View pointerEvents="none">
                <Text style={styles.ctbThrowOrderSetTitle}>Throw Order Set</Text>
                <Text style={styles.ctbThrowOrderSetSub}>
                  {throwOrderSetWinnerName ?? "—"} is closest to the bull
                </Text>
              </View>
            </Pressable>
          )}
        </Animated.View>
      </View>
    </View>
  );

  const rightColumn = (
    <View style={styles.rightColumnContent}>
      {cardBlock}
      {state && (
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.grid,
          styles.gridLandscape,
          { paddingBottom: Platform.OS === "ios" ? 10 : 6 },
        ]}
        style={styles.scoresScrollLandscape}
      >
        {state.players.map((p, idx) => {
          const active = idx === state.currentPlayerIndex && !winner;
          const turnPills = active ? state.turnPills : [];
          const showColorAndNumber = !isSpinning;

          return (
            <View
              key={p.id}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                cardYOffsetsRef.current[idx] = y;
              }}
              style={[
                styles.pcard,
                isLarge && stylesL.pcard,
                isLandscape && styles.pcardLandscape,
                theme.pcard,
                p.isEliminated && styles.pcardEliminated,
                p.isEliminated && theme.pcardEliminated,
                {
                  borderWidth: p.isEliminated ? 1 : active ? 3 : 1,
                  borderColor: p.isEliminated ? "#6B7280" : showColorAndNumber ? p.color : "#9CA3AF",
                },
                active &&
                  !p.isEliminated &&
                  showColorAndNumber && {
                    shadowColor: p.color,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.3,
                    shadowRadius: 6,
                    elevation: 4,
                  },
              ]}
            >
              {p.isEliminated && <EliminatedOverlay />}
              <View style={styles.pcardTopRow}>
                <Text style={[styles.pname, isLarge && stylesL.pname, theme.pname]} numberOfLines={1}>
                  {p.name}
                </Text>
                <View style={[styles.numberPill, { backgroundColor: showColorAndNumber ? p.color : "#9CA3AF" }]}>
                  <Text style={[styles.numberPillText, isLarge && stylesL.numberPillText]}>{showColorAndNumber ? `#${p.assignedNumber}` : "—"}</Text>
                </View>
              </View>

              <View style={styles.iconRowWithRight}>
                <View style={styles.iconRow}>
                  <Text style={[styles.iconLabel, theme.psub]}>{p.isArmed ? "⚔" : "🎯"}</Text>
                  {!p.isArmed ? (
                    <Text style={[styles.psub, isLarge && stylesL.psub, theme.psub]}>
                      {fullLivesToArm && p.livesRemaining < maxLives && armRemainingOnly(p) === 0 ? "Full lives to Arm" : `${armRemainingOnly(p)} → Arm`}
                    </Text>
                  ) : (
                    <Text style={[styles.psub, isLarge && stylesL.psub, styles.liveBadge, theme.liveBadge]}>
                      Armed
                    </Text>
                  )}
                </View>
                <Text style={[styles.psub, isLarge && stylesL.psub, theme.psub]}>
                  Kills: {p.killsCount}
                </Text>
              </View>
              <View style={styles.iconRowWithRight}>
                <View style={styles.iconRow}>
                  <Text style={[styles.iconLabel, theme.psub]}>
                    {p.isEliminated ? "💔" : "❤️"}
                  </Text>
                  <Text style={[styles.psub, isLarge && stylesL.psub, theme.psub]}>
                    {p.livesRemaining === 0
                      ? "OUT"
                      : `${p.livesRemaining} ${p.livesRemaining === 1 ? "life" : "lives"}`}
                  </Text>
                </View>
                {(placementOn || killRewardsOn) && (
                  <Text style={[styles.psub, isLarge && stylesL.psub, theme.psub]}>
                    Rewards: {(p.placementReward + p.killRewardsBalance) >= 0 ? "+" : ""}{p.placementReward + p.killRewardsBalance}
                  </Text>
                )}
              </View>

              {!winner && active && turnPills.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.ptag, isLarge && stylesL.ptag, theme.ptag]}>This turn:</Text>
                  <View style={styles.dartRow}>
                    {turnPills.map((pill, i) => {
                      const isOwn = pill.targetPlayerId === p.id;
                      const isArming = isOwn && !pill.blockedByCap;
                      const isHitOnOther = !pill.blockedByCap && !isArming;
                      const pillColor = pill.blockedByCap
                        ? "#9CA3AF"
                        : isArming
                        ? "transparent"
                        : pill.targetColor;
                      const multPrefix = pill.multiplier === 2 ? "2x " : pill.multiplier === 3 ? "3x " : "";
                      const armingLabel =
                        isArming && pill.multiplier === 2 ? "2 🎯" : isArming && pill.multiplier === 3 ? "3 🎯" : isArming ? "🎯" : null;
                      const hitOnOtherLabel =
                        isHitOnOther && pill.multiplier === 2 ? "2 ❤️" : isHitOnOther && pill.multiplier === 3 ? "3 ❤️" : isHitOnOther ? "❤️" : null;
                      return (
                        <View
                          key={i}
                          style={[
                            styles.killerPill,
                            { backgroundColor: pillColor },
                            isArming && styles.killerPillTarget,
                          ]}
                        >
                          {pill.blockedByCap ? (
                            <Text style={[styles.killerPillText, theme.killerPillText]}>{multPrefix}🛡 Protected</Text>
                          ) : isArming ? (
                            <Text style={[styles.killerPillIcon, theme.killerPillIcon]}>{armingLabel}</Text>
                          ) : isHitOnOther ? (
                            <Text style={[styles.killerPillIcon, styles.killerPillIconWhite, theme.killerPillIcon]}>{hitOnOtherLabel}</Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      )}
      {actionRows}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, theme.safe]}>
      {takeoutStallModal}
      <View style={[styles.container, isLandscape && styles.containerLandscape, theme.container]}>
        {topBar}
        {closestToBullActive ? (
          <View style={[styles.closestCenter, isLandscape && styles.closestLandscapeCenter]}>
            {boardBlock}
          </View>
        ) : isLandscape ? (
          <View style={styles.landscapeContentRow}>
            <View style={[styles.leftColumn, styles.leftColumnLandscape]}>
              {boardBlock}
            </View>
            <View style={[styles.rightColumn, styles.rightColumnLandscape]}>
              {rightColumn}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.leftColumn}>
              {boardBlock}
            </View>
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
  containerLandscape: { padding: 10, gap: 8 },
  landscapeContentRow: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    gap: 8,
  },
  closestCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closestLandscapeCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  leftColumn: {
    flex: 3,
    minWidth: 0,
    gap: 8,
    justifyContent: "flex-start",
  },
  leftColumnLandscape: { flex: 7 },
  rightColumn: { flex: 2, minWidth: 0 },
  rightColumnLandscape: { flex: 3 },
  rightColumnContent: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },
  header: { gap: 2 },
  headerThrowingWrap: { justifyContent: "center", gap: 0 },
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
  closestOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "12%",
    alignItems: "center",
    justifyContent: "center",
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
  autoResetText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.3,
  },
  autoDot: { width: 10, height: 10, borderRadius: 999 },
  autoDotOn: { backgroundColor: "#16A34A" },
  autoDotOff: { backgroundColor: "#9CA3AF" },
  h1: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 16, fontWeight: "800", opacity: 0.9 },
  headerSub: { fontSize: 20, fontWeight: "800", opacity: 0.9 },
  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  turnTitle: { fontSize: 22, fontWeight: "900", flexShrink: 1 },
  winner: { fontSize: 22, fontWeight: "900" },
  winnerSub: { marginTop: 8, opacity: 0.7, fontWeight: "800", fontSize: 18 },
  boardArea: { alignItems: "center", justifyContent: "center", marginTop: -26, marginLeft: -12 },
  boardAreaLandscape: { flex: 1, justifyContent: "center", marginTop: -22, marginLeft: -10 },
  boardAreaClosest: { marginTop: 0, marginLeft: 0 },
  boardBorderWrap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scoresScrollLandscape: { marginTop: 0, flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridLandscape: { flexDirection: "column", flexWrap: "nowrap", gap: 8 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  btnMiniAlt: {
    flex: 0.5,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  btnMiniText: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },
  btnWideAlt: {
    flex: 1.05,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  btnWideTextAlt: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },
  btnWidePrimary: {
    flex: 1.2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  btnWideTextPrimary: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.4 },
  pcard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    minWidth: 140,
    position: "relative",
  },
  pcardLandscape: { minWidth: 0 },
  pcardEliminated: { opacity: 0.65 },
  pcardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  iconRowWithRight: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  iconRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconLabel: { fontSize: 18, opacity: 0.9, fontWeight: "900" },
  liveBadge: { fontWeight: "900", color: "#16A34A" },
  eliminatedOverlay: {
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
  },
  eliminatedShield: {
    fontSize: 56,
    opacity: 0.85,
  },
  pname: { fontSize: 22, fontWeight: "900", flex: 1 },
  numberPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  numberPillText: { color: "white", fontWeight: "900", fontSize: 17 },
  psub: { fontSize: 17, opacity: 0.85, marginTop: 2, fontWeight: "900" },
  ptag: { fontSize: 17, fontWeight: "900", marginTop: 4 },
  dartRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  killerPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  killerPillTarget: {
    borderWidth: 1.5,
    borderColor: "rgba(100, 116, 139, 0.5)",
  },
  killerPillInner: {
    width: 20,
    height: 8,
    borderRadius: 4,
  },
  killerPillText: { color: "white", fontWeight: "900" as const, fontSize: 16 },
  killerPillIcon: { fontSize: 18, fontWeight: "900" as const },
  killerPillIconWhite: { color: "white" },
});

const stylesL = StyleSheet.create({
  h1: { fontSize: 26 },
  sub: { fontSize: 18, fontWeight: "800" },
  headerSub: { fontSize: 24 },
  card: { padding: 16, borderRadius: 16 },
  turnTitle: { fontSize: 26 },
  winner: { fontSize: 26 },
  winnerSub: { fontSize: 20 },
  actionRow: { marginTop: 6 },
  btnMiniAlt: { flex: 0.45, paddingVertical: 16, borderRadius: 14 },
  btnMiniText: { fontSize: 22, letterSpacing: 0.5 },
  btnWideAlt: { flex: 1.05, paddingVertical: 16, borderRadius: 14 },
  btnWideTextAlt: { fontSize: 18 },
  btnWidePrimary: { flex: 1.25, paddingVertical: 16, borderRadius: 14 },
  btnWideTextPrimary: { fontSize: 20 },
  pcard: { padding: 14, borderRadius: 14 },
  pname: { fontSize: 24 },
  numberPillText: { fontSize: 19 },
  psub: { fontSize: 19 },
  ptag: { fontSize: 19 },
});
