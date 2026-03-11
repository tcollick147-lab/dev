// src/components/Dartboard.tsx

import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  LayoutChangeEvent,
  Pressable,
  Text,
  Animated,
  Dimensions,
} from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import type { DartCode } from "../engine/matchEngine";

const AnimatedPath = Animated.createAnimatedComponent(Path as any);
const AnimatedCircle = Animated.createAnimatedComponent(Circle as any);
const AnimatedG = Animated.createAnimatedComponent(G as any);

// Standard board order clockwise starting at top (20)
const BOARD_ORDER = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17,
  3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

// Classic colors
const BLACK = "#111827";
const CREAM = "#F7F3E8";
const RED = "#DC2626";
const GREEN = "#16A34A";
const WIRE = "#0B0F1A";
const FLASH = "#22C55E";

// ✅ Target highlight color (nice “aim here” amber)
const HILITE = "#FBBF24";

/**
 * ✅ Single source of truth for both:
 * - hit-testing thresholds (ringFromRadius)
 * - render radii (R_*)
 *
 * These ratios are relative to rOuter.
 */
const MANUAL_RATIOS = {
  DB: 0.07,
  SB: 0.16,
  T_IN: 0.46,
  T_OUT: 0.58,
  D_IN: 0.76,
  D_OUT: 0.88,
  WEDGE_IN: 0.14,
  NUMBERS: 1.04,
} as const;

// Regulation dimensions in mm (double outer = 170 mm). Auto treble and double rings 11 mm. Red bull a bit larger.
const REGULATION_MM = {
  DB: 7,
  SB: 16.5,
  T_IN: 88,
  T_OUT: 99,
  D_IN: 150,
  D_OUT: 161,
} as const;

type BoardProfile = "manual" | "standard";

type RatiosLike = {
  DB: number;
  SB: number;
  T_IN: number;
  T_OUT: number;
  D_IN: number;
  D_OUT: number;
  WEDGE_IN: number;
  NUMBERS: number;
};

// Angle math: 0° at top, clockwise
function angleDegFromTopClockwise(x: number, y: number): number {
  const rad = Math.atan2(x, -y);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function wedgeNumberFromAngle(deg: number): number {
  const wedgeSize = 360 / 20;
  const idx = Math.floor((deg + wedgeSize / 2) / wedgeSize) % 20;
  return BOARD_ORDER[idx];
}

function wedgeIndexFromAngle(deg: number): number {
  const wedgeSize = 360 / 20;
  const idx = Math.floor((deg + wedgeSize / 2) / wedgeSize) % 20;
  return idx;
}

export type Ring =
  | { kind: "MISS" }
  | { kind: "DB" }
  | { kind: "SB" }
  | { kind: "S_IN"; n: number }
  | { kind: "S_OUT"; n: number }
  | { kind: "D"; n: number }
  | { kind: "T"; n: number };

// rNorm = distance from center / outer radius (0..1+)
function ringFromRadius(
  rNorm: number,
  n: number,
  ratios: RatiosLike
): Ring {
  // ✅ MUST mirror render radii ratios
  const DB = ratios.DB;
  const SB = ratios.SB;
  const T_IN = ratios.T_IN;
  const T_OUT = ratios.T_OUT;
  const D_IN = ratios.D_IN;
  const D_OUT = ratios.D_OUT;

  if (rNorm > D_OUT) return { kind: "MISS" };
  if (rNorm <= DB) return { kind: "DB" };
  if (rNorm <= SB) return { kind: "SB" };

  if (rNorm >= D_IN) return { kind: "D", n };
  if (rNorm >= T_IN && rNorm <= T_OUT) return { kind: "T", n };

  // Singles split:
  if (rNorm < T_IN) return { kind: "S_IN", n };
  return { kind: "S_OUT", n };
}

// Match engine DartCode does not support inner/outer singles,
// so both map to "S{n}" for the legacy callback.
function ringToDartCode(r: Ring): DartCode {
  if (r.kind === "MISS") return "MISS";
  if (r.kind === "SB") return "SB";
  if (r.kind === "DB") return "DB";
  if (r.kind === "S_IN" || r.kind === "S_OUT") return `S${r.n}` as DartCode;
  return `${r.kind}${r.n}` as DartCode;
}

function ringToLabel(r: Ring): string {
  if (r.kind === "MISS") return "MISS";
  if (r.kind === "SB") return "SB";
  if (r.kind === "DB") return "DB";
  if (r.kind === "S_IN") return `S${r.n}i`;
  if (r.kind === "S_OUT") return `S${r.n}o`;
  return `${r.kind}${r.n}`;
}

// Wedge arc path (ring segment)
function describeArc(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number
) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = { x: cx + rOuter * Math.sin(toRad(startDeg)), y: cy - rOuter * Math.cos(toRad(startDeg)) };
  const p2 = { x: cx + rOuter * Math.sin(toRad(endDeg)), y: cy - rOuter * Math.cos(toRad(endDeg)) };
  const p3 = { x: cx + rInner * Math.sin(toRad(endDeg)), y: cy - rInner * Math.cos(toRad(endDeg)) };
  const p4 = { x: cx + rInner * Math.sin(toRad(startDeg)), y: cy - rInner * Math.cos(toRad(startDeg)) };

  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

export type HitMarker = { x: number; y: number };

type HighlightBed = string; // e.g. "T20" "D16" "S20" "SBULL" "DBULL"

function parseHighlightBed(b: HighlightBed):
  | { kind: "T" | "D" | "S"; n: number }
  | { kind: "SB" | "DB" }
  | null {
  const t = String(b || "").trim().toUpperCase();
  if (!t) return null;

  if (t === "DBULL" || t === "BULL") return { kind: "DB" };
  if (t === "SBULL") return { kind: "SB" };

  const m = /^([SDT])(\d{1,2})$/.exec(t);
  if (!m) return null;

  const n = Number(m[2]);
  if (!Number.isFinite(n) || n < 1 || n > 20) return null;

  return { kind: m[1] as "S" | "D" | "T", n };
}

/** Killer mode: per-number segment color, lives (wedge portions), and state */
export type KillerSegment = {
  number: number;
  color: string;
  lives: number;
  /** Max lives (from settings); wedge shrinks radially as lives decrease. */
  maxLives: number;
  isArmed: boolean;
  isEliminated: boolean;
  /** True when turn kill cap protects this player from being hit this turn */
  isProtected?: boolean;
  /** Remaining hits to arm (points mode only). Used for on-board status indicator. */
  armRemaining?: number;
};

export default function Dartboard(props: {
  size?: number;
  onDart: (dart: DartCode) => void;
  onDartDetail?: (ring: Ring) => void;
  disabled?: boolean;
  inputDisabled?: boolean;

  highlightTarget?: number | "BULL" | null;

  // ✅ bed-level highlight(s)
  highlightBeds?: HighlightBed[];

  /** Killer game: neon wedge + lives per number */
  killerSegments?: KillerSegment[];
  /** When in Killer mode, which segment numbers to pulse (e.g. targetable opponents, or own for replenish). If set, overrides highlightTarget for pulse. */
  killerPulseNumbers?: number[];

  hitMarkers?: HitMarker[];
  onHitMarker?: (pt: HitMarker) => void;
  maxMarkers?: number;

  showLast?: boolean;
  boardProfile?: BoardProfile;
}) {
  const [measuredSize, setMeasuredSize] = useState(280);
  const size = props.size ?? measuredSize;

  const maxMarkers = props.maxMarkers ?? 3;
  const showLast = props.showLast ?? true;

  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  const [last, setLast] = useState<string>("—");

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setMeasuredSize(Math.min(width, height));
  }

  const cx = size / 2;
  const cy = size / 2;

  const rOuter = size * (isLarge ? 0.47 : 0.43);
  const markerSize = isLarge ? 16 : 12;

  // Auto mode: fixed scale so 170mm = rOuter*0.88; changing REGULATION_MM moves treble and double.
  const REF_D_OUT_MM = 170;
  const isStandard = props.boardProfile === "standard";
  const { ratios, R_DB, R_SB, R_T_IN, R_T_OUT, R_D_IN, R_D_OUT, R_WEDGE_IN, R_NUMBERS } = useMemo(() => {
    if (isStandard) {
      const D_OUT_PX = rOuter * 0.88;
      const pxPerMm = D_OUT_PX / REF_D_OUT_MM;
      const rDb = REGULATION_MM.DB * pxPerMm;
      const rSb = REGULATION_MM.SB * pxPerMm;
      const rTIn = REGULATION_MM.T_IN * pxPerMm;
      const rTOut = REGULATION_MM.T_OUT * pxPerMm;
      const rDIn = REGULATION_MM.D_IN * pxPerMm;
      const rDOut = REGULATION_MM.D_OUT * pxPerMm;
      const rWedgeIn = REGULATION_MM.SB * pxPerMm;
      const ratiosStd: RatiosLike = {
        DB: rDb / rOuter,
        SB: rSb / rOuter,
        T_IN: rTIn / rOuter,
        T_OUT: rTOut / rOuter,
        D_IN: rDIn / rOuter,
        D_OUT: rDOut / rOuter,
        WEDGE_IN: rWedgeIn / rOuter,
        NUMBERS: 1.04,
      };
      return {
        ratios: ratiosStd,
        R_DB: rDb,
        R_SB: rSb,
        R_T_IN: rTIn,
        R_T_OUT: rTOut,
        R_D_IN: rDIn,
        R_D_OUT: rDOut,
        R_WEDGE_IN: rWedgeIn,
        R_NUMBERS: rOuter * 1.04,
      };
    }
    const ratiosMan = MANUAL_RATIOS;
    return {
      ratios: ratiosMan,
      R_DB: rOuter * ratiosMan.DB,
      R_SB: rOuter * ratiosMan.SB,
      R_T_IN: rOuter * ratiosMan.T_IN,
      R_T_OUT: rOuter * ratiosMan.T_OUT,
      R_D_IN: rOuter * ratiosMan.D_IN,
      R_D_OUT: rOuter * ratiosMan.D_OUT,
      R_WEDGE_IN: rOuter * ratiosMan.WEDGE_IN,
      R_NUMBERS: rOuter * (isLarge ? 0.97 : ratiosMan.NUMBERS),
    };
  }, [rOuter, isStandard, isLarge]);

  // Wedge flash
  const [flashWedgeIndex, setFlashWedgeIndex] = useState<number | null>(null);
  const wedgeFlash = useRef(new Animated.Value(0)).current;

  function flashWedge(idx: number) {
    setFlashWedgeIndex(idx);
    wedgeFlash.stopAnimation();
    wedgeFlash.setValue(1);

    Animated.timing(wedgeFlash, {
      toValue: 0,
      duration: 520,
      useNativeDriver: true,
    }).start(() => setFlashWedgeIndex(null));
  }

  // Pulse for highlights — only run when Killer mode is active and board not disabled (so pulse works when going straight to game after spin)
  const targetPulse = useRef(new Animated.Value(0)).current;
  const hasKillerSegments = (props.killerSegments?.length ?? 0) > 0;
  const shouldPulse = hasKillerSegments && !props.disabled;
  useEffect(() => {
    if (!shouldPulse) return;
    targetPulse.stopAnimation();
    targetPulse.setValue(0);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(targetPulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(targetPulse, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
      targetPulse.stopAnimation();
    };
  }, [targetPulse, shouldPulse]);

  const wedges = useMemo(() => {
    const wedgeSize = 360 / 20;
    return Array.from({ length: 20 }).map((_, i) => {
      const offset = wedgeSize / 2; // aligns 20 at top
      const start = i * wedgeSize - offset;
      const end = (i + 1) * wedgeSize - offset;
      return { i, start, end };
    });
  }, []);

  const numberFontSize = size * (isLarge ? 0.05 : 0.05);

  // Legacy wedge highlight
  const targetWedgeIndex = useMemo(() => {
    if (!props.highlightTarget || props.highlightTarget === "BULL") return null;
    const idx = BOARD_ORDER.indexOf(props.highlightTarget);
    return idx >= 0 ? idx : null;
  }, [props.highlightTarget]);

  const targetWedge = targetWedgeIndex !== null ? wedges[targetWedgeIndex] : null;

  const targetGlowOpacity = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.28],
  });

  const targetGlowOpacityStrong = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.45],
  });

  // Stronger pulse for bull (e.g. Closest to Bull) so it stands out more
  const bullGlowOpacity = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.65],
  });
  const bullGlowOpacityStrong = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0.85],
  });

  // Pulse for Killer (number + segment): 0.5 → 1
  const killerTargetNumberPulse = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  const markers = (props.hitMarkers ?? []).slice(0, maxMarkers);
  const pressDisabled = !!(props.inputDisabled ?? props.disabled);

  // Bed highlights compiled
  const bedHighlights = useMemo(() => {
    const list = (props.highlightBeds ?? []).map(parseHighlightBed).filter(Boolean) as Array<
      { kind: "T" | "D" | "S"; n: number } | { kind: "SB" | "DB" }
    >;

    const wedgesT = new Set<number>();
    const wedgesD = new Set<number>();
    const wedgesS = new Set<number>();
    let bullSB = false;
    let bullDB = false;

    for (const h of list) {
      if (h.kind === "SB") bullSB = true;
      else if (h.kind === "DB") bullDB = true;
      else if ("n" in h) {
        const idx = BOARD_ORDER.indexOf(h.n);
        if (idx < 0) continue;
        if (h.kind === "T") wedgesT.add(idx);
        if (h.kind === "D") wedgesD.add(idx);
        if (h.kind === "S") wedgesS.add(idx);
      }
    }

    return { wedgesT, wedgesD, wedgesS, bullSB, bullDB };
  }, [props.highlightBeds]);

  const killerByNumber = useMemo(() => {
    const map = new Map<number, KillerSegment>();
    for (const s of props.killerSegments ?? []) {
      if (s.number >= 1 && s.number <= 20) map.set(s.number, s);
    }
    return map;
  }, [props.killerSegments]);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Pressable
        disabled={pressDisabled}
        style={[
          styles.pressable,
          { width: size, height: size },
          props.disabled && { opacity: 0.5 },
        ]}
        onPress={(evt) => {
          const { locationX, locationY } = evt.nativeEvent;

          props.onHitMarker?.({ x: locationX, y: locationY });

          const dx = locationX - cx;
          const dy = locationY - cy;

          const dist = Math.sqrt(dx * dx + dy * dy);
          const rNorm = dist / rOuter;

          const deg = angleDegFromTopClockwise(dx, dy);
          const idx = wedgeIndexFromAngle(deg);
          flashWedge(idx);

          const n = wedgeNumberFromAngle(deg);
          const ring = ringFromRadius(rNorm, n, ratios);

          props.onDartDetail?.(ring);

          const dart = ringToDartCode(ring);
          setLast(ringToLabel(ring));
          props.onDart(dart);
        }}
      >
        <Svg width={size} height={size}>
          {/* Outer (number ring background) */}
          <Circle cx={cx} cy={cy} r={rOuter * 1.18} fill={BLACK} />

          {/* Main wedges */}
          <G>
            {wedges.map((w) => (
              <Path
                key={`w-${w.i}`}
                d={describeArc(cx, cy, R_WEDGE_IN, R_D_OUT, w.start, w.end)}
                fill={w.i % 2 === 0 ? BLACK : CREAM}
                stroke={WIRE}
                strokeWidth={0}
              />
            ))}
          </G>

          {/* Treble ring */}
          <G>
            {wedges.map((w) => (
              <Path
                key={`t-${w.i}`}
                d={describeArc(cx, cy, R_T_IN, R_T_OUT, w.start, w.end)}
                fill={w.i % 2 === 0 ? RED : GREEN}
                stroke={WIRE}
                strokeWidth={0}
              />
            ))}
          </G>

          {/* Double ring */}
          <G>
            {wedges.map((w) => (
              <Path
                key={`d-${w.i}`}
                d={describeArc(cx, cy, R_D_IN, R_D_OUT, w.start, w.end)}
                fill={w.i % 2 === 0 ? RED : GREEN}
                stroke={WIRE}
                strokeWidth={0}
              />
            ))}
          </G>

          {/* Bulls */}
          <Circle cx={cx} cy={cy} r={R_SB} fill={GREEN} stroke={WIRE} strokeWidth={0} />
          <Circle cx={cx} cy={cy} r={R_DB} fill={RED} stroke={WIRE} strokeWidth={0} />

          {/* =========================
              BED-LEVEL HIGHLIGHT OVERLAYS
             ========================= */}
          {!props.disabled && (
            <>
              {/* Singles: highlight BOTH inner and outer single areas for that wedge */}
              {Array.from(bedHighlights.wedgesS).map((idx) => {
                const w = wedges[idx];
                if (!w) return null;
                return (
                  <G key={`hs-${idx}`}>
                    <AnimatedPath
                      d={describeArc(cx, cy, R_SB, R_T_IN, w.start, w.end)}
                      fill={HILITE}
                      opacity={targetGlowOpacity}
                    />
                    <AnimatedPath
                      d={describeArc(cx, cy, R_T_OUT, R_D_IN, w.start, w.end)}
                      fill={HILITE}
                      opacity={targetGlowOpacity}
                    />
                  </G>
                );
              })}

              {/* Trebles */}
              {Array.from(bedHighlights.wedgesT).map((idx) => {
                const w = wedges[idx];
                if (!w) return null;
                return (
                  <AnimatedPath
                    key={`ht-${idx}`}
                    d={describeArc(cx, cy, R_T_IN, R_T_OUT, w.start, w.end)}
                    fill={HILITE}
                    opacity={targetGlowOpacityStrong}
                  />
                );
              })}

              {/* Doubles */}
              {Array.from(bedHighlights.wedgesD).map((idx) => {
                const w = wedges[idx];
                if (!w) return null;
                return (
                  <AnimatedPath
                    key={`hd-${idx}`}
                    d={describeArc(cx, cy, R_D_IN, R_D_OUT, w.start, w.end)}
                    fill={HILITE}
                    opacity={targetGlowOpacityStrong}
                  />
                );
              })}

              {/* Bulls from bed list */}
              {(bedHighlights.bullSB || bedHighlights.bullDB) && (
                <>
                  {bedHighlights.bullSB && (
                    <AnimatedCircle
                      cx={cx}
                      cy={cy}
                      r={R_SB + (isLarge ? 7 : 5)}
                      fill="transparent"
                      stroke={HILITE}
                      strokeWidth={isLarge ? 5 : 4}
                      opacity={targetGlowOpacity}
                    />
                  )}
                  {bedHighlights.bullDB && (
                    <AnimatedCircle
                      cx={cx}
                      cy={cy}
                      r={R_DB + (isLarge ? 6 : 4)}
                      fill="transparent"
                      stroke={HILITE}
                      strokeWidth={isLarge ? 5 : 4}
                      opacity={targetGlowOpacityStrong}
                    />
                  )}
                </>
              )}
            </>
          )}

          {/* ✅ Legacy target highlight (number wedge) */}
          {targetWedge && !props.disabled && (
            <>
              <AnimatedPath
                d={describeArc(cx, cy, R_WEDGE_IN, R_D_OUT, targetWedge.start, targetWedge.end)}
                fill={HILITE}
                opacity={targetGlowOpacity}
              />
              <AnimatedPath
                d={describeArc(cx, cy, R_D_IN, R_D_OUT, targetWedge.start, targetWedge.end)}
                fill={HILITE}
                opacity={targetGlowOpacityStrong}
              />
            </>
          )}

          {/* ✅ Legacy target highlight (bull) – stronger pulse so bull is more prominent */}
          {props.highlightTarget === "BULL" && !props.disabled && (
            <>
              <AnimatedCircle
                cx={cx}
                cy={cy}
                r={R_SB + (isLarge ? 10 : 7)}
                fill="transparent"
                stroke={HILITE}
                strokeWidth={isLarge ? 8 : 6}
                opacity={bullGlowOpacity}
              />
              <AnimatedCircle
                cx={cx}
                cy={cy}
                r={R_DB + (isLarge ? 8 : 6)}
                fill="transparent"
                stroke={HILITE}
                strokeWidth={isLarge ? 8 : 6}
                opacity={bullGlowOpacityStrong}
              />
            </>
          )}

          {/* Killer mode: neon wedge + lives. Wedge shrinks radially as lives decrease (same colour). Index 0 = innermost; depletion is outside-in. */}
          {!props.disabled &&
            (props.killerSegments ?? []).map((seg) => {
              const idx = BOARD_ORDER.indexOf(seg.number);
              if (idx < 0) return null;
              const w = wedges[idx];
              if (!w) return null;
              const pulseNumbers =
                Array.isArray(props.killerPulseNumbers) && props.killerPulseNumbers.length > 0
                  ? props.killerPulseNumbers
                  : props.highlightTarget != null && props.highlightTarget !== "BULL"
                  ? [props.highlightTarget as number]
                  : [];
              const isActiveSegment =
                (props.killerSegments?.length ?? 0) > 0 &&
                pulseNumbers.includes(seg.number) &&
                !props.disabled &&
                !seg.isEliminated;
              const fillColor = seg.isEliminated
                ? "#6B7280"
                : seg.isProtected
                ? "transparent"
                : seg.color;
              const strokeColor = seg.isEliminated
                ? "#4B5563"
                : seg.isProtected
                ? "transparent"
                : (() => {
                    const hex = seg.color;
                    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                    if (!m) return hex;
                    const f = 0.55;
                    const r = Math.max(0, Math.floor(parseInt(m[1], 16) * f));
                    const g = Math.max(0, Math.floor(parseInt(m[2], 16) * f));
                    const b = Math.max(0, Math.floor(parseInt(m[3], 16) * f));
                    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                  })();
              const opacity = seg.isEliminated ? 0.4 : seg.isProtected ? 0 : seg.isArmed ? 0.5 : 0.25;
              const lives = Math.max(0, seg.lives);
              const maxLives = Math.max(1, seg.maxLives ?? lives);
              const strokeW = Math.max(0.8, size * 0.005);
              // Inner radius at or outside the 25 ring so wedges don't overlap bull (manual profile has WEDGE_IN < SB)
              const rInner = Math.max(R_WEDGE_IN, R_SB);
              const rOuter = R_D_OUT;
              const span = rOuter - rInner;
              const rOuterEffective = seg.isEliminated
                ? rOuter
                : rInner + (lives / maxLives) * span;
              const spanEffective = rOuterEffective - rInner;
              const wedgeContent = (
                <>
                  <Path
                    d={describeArc(cx, cy, rInner, rOuterEffective, w.start, w.end)}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    opacity={opacity}
                  />
                  {lives > 0 &&
                    !seg.isEliminated &&
                    Array.from({ length: lives }).map((_, i) => {
                      const portions = lives;
                      const a = rInner + (spanEffective * i) / portions;
                      const b = rInner + (spanEffective * (i + 1)) / portions;
                      return (
                        <Path
                          key={`life-${i}`}
                          d={describeArc(cx, cy, a, b, w.start, w.end)}
                          fill={fillColor}
                          stroke={strokeColor}
                          strokeWidth={strokeW * 0.8}
                          opacity={0.55 + 0.15 * (i / Math.max(1, portions))}
                        />
                      );
                    })}
                  {seg.isProtected && !seg.isEliminated && (() => {
                    const midDeg = (w.start + w.end) / 2;
                    const midRad = (midDeg * Math.PI) / 180;
                    const rMid = (rInner + rOuterEffective) / 2;
                    return (
                      <SvgText
                        x={cx + rMid * Math.sin(midRad)}
                        y={cy - rMid * Math.cos(midRad)}
                        fill="white"
                        fontSize={Math.max(14, size * 0.06)}
                        fontWeight="900"
                        textAnchor="middle"
                        alignmentBaseline="middle"
                      >
                        🛡
                      </SvgText>
                    );
                  })()}
                </>
              );
              return (
                <G key={`killer-${seg.number}`}>
                  {isActiveSegment ? (
                    <AnimatedG opacity={killerTargetNumberPulse}>{wedgeContent}</AnimatedG>
                  ) : (
                    wedgeContent
                  )}
                </G>
              );
            })}

          {/* Wedge flash overlay */}
          {flashWedgeIndex !== null && wedges[flashWedgeIndex] && (
            <AnimatedPath
              d={describeArc(
                cx,
                cy,
                R_WEDGE_IN,
                R_D_OUT,
                wedges[flashWedgeIndex].start,
                wedges[flashWedgeIndex].end
              )}
              fill={FLASH}
              opacity={wedgeFlash.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.30],
              })}
            />
          )}

          {/* Numbers */}
          {BOARD_ORDER.map((num, i) => {
            const angle = (i * 360) / 20;
            const rad = (angle * Math.PI) / 180;

            const isTarget = props.highlightTarget === num && !props.disabled;
            const killer = killerByNumber.get(num);
            const killerPulseNums =
              Array.isArray(props.killerPulseNumbers) && props.killerPulseNumbers.length > 0
                ? props.killerPulseNumbers
                : props.highlightTarget != null && props.highlightTarget !== "BULL"
                ? [props.highlightTarget as number]
                : [];
            const isKillerActiveTarget =
              (props.killerSegments?.length ?? 0) > 0 && killerPulseNums.length > 0 && killerPulseNums.includes(num) && !props.disabled;
            const numColor = killer
              ? killer.isEliminated
                ? "#9CA3AF"
                : killer.color
              : isTarget
              ? HILITE
              : "white";

            // Killer: larger number + opacity pulse. Cricket/other: standard highlight size, no pulse.
            const numberEl = (
              <SvgText
                x={cx + R_NUMBERS * Math.sin(rad)}
                y={cy - R_NUMBERS * Math.cos(rad)}
                fill={numColor}
                fontSize={isKillerActiveTarget ? numberFontSize * 1.15 : (isTarget || killer ? numberFontSize * 1.08 : numberFontSize)}
                fontWeight={isTarget || killer ? "900" : "800"}
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {num}
              </SvgText>
            );

            // Indicator inside the number, just outside double ring; always upright
            const R_INDICATOR = R_D_OUT + (R_NUMBERS - R_D_OUT) * 0.28;
            const indX = cx + R_INDICATOR * Math.sin(rad);
            const indY = cy - R_INDICATOR * Math.cos(rad);
            const statusEl =
              killer && (props.killerSegments?.length ?? 0) > 0 ? (
                <G transform={`translate(${indX}, ${indY})`}>
                  <SvgText
                    x={0}
                    y={0}
                    fill="#6B7280"
                    fontSize={numberFontSize * 0.65}
                    fontWeight="900"
                    textAnchor="middle"
                    alignmentBaseline="middle"
                  >
                    {killer.isEliminated ? "💔" : killer.isArmed ? "⚔" : killer.armRemaining != null ? String(killer.armRemaining) : ""}
                  </SvgText>
                </G>
              ) : null;

            const numberWithPulse = isKillerActiveTarget ? (
              <AnimatedG opacity={killerTargetNumberPulse}>{numberEl}</AnimatedG>
            ) : (
              numberEl
            );
            const content = statusEl ? (
              <G key={num}>{numberWithPulse}{statusEl}</G>
            ) : (
              <G key={num}>{numberWithPulse}</G>
            );
            return content;
          })}
        </Svg>

        {/* Markers */}
        {markers.map((m, i) => (
          <View
            key={`${m.x}-${m.y}-${i}`}
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: m.x - markerSize / 2,
                top: m.y - markerSize / 2,
                width: markerSize,
                height: markerSize,
                borderRadius: markerSize / 2,
              },
            ]}
          />
        ))}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6 },
  pressable: { borderRadius: 9999, overflow: "hidden" },

  last: { fontSize: 12, fontWeight: "700", opacity: 0.8 },
  lastLarge: { fontSize: 16, fontWeight: "800", opacity: 0.85 },

  marker: {
    position: "absolute",
    backgroundColor: GREEN,
    borderWidth: 2,
    borderColor: "white",
  },
});
