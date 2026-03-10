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

// Standard board order clockwise starting at top (20)
const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

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
const RATIOS = {
  DB: 0.07,
  SB: 0.16,
  T_IN: 0.46,
  T_OUT: 0.58,
  D_IN: 0.76,
  D_OUT: 0.88,
  WEDGE_IN: 0.14,
  NUMBERS: 1.04,
} as const;

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
function ringFromRadius(rNorm: number, n: number): Ring {
  // ✅ MUST mirror render radii ratios
  const DB = RATIOS.DB;
  const SB = RATIOS.SB;
  const T_IN = RATIOS.T_IN;
  const T_OUT = RATIOS.T_OUT;
  const D_IN = RATIOS.D_IN;
  const D_OUT = RATIOS.D_OUT;

  if (rNorm > D_OUT) return { kind: "MISS" };
  if (rNorm <= DB) return { kind: "DB" };
  if (rNorm <= SB) return { kind: "SB" };

  if (rNorm >= D_IN) return { kind: "D", n };
  if (rNorm >= T_IN && rNorm <= T_OUT) return { kind: "T", n };

  // Singles split:
  // - inner single: between outer bull and treble ring
  // - outer single: between treble ring and double ring
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

// Helpful for debugging/labels
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

export default function Dartboard(props: {
  size?: number;
  onDart: (dart: DartCode) => void; // legacy (Match) callback
  onDartDetail?: (ring: Ring) => void; // ✅ use this for Golf (inner/outer singles)
  disabled?: boolean;

  // ✅ NEW: highlight target (Golf)
  highlightTarget?: number | "BULL" | null;
}) {
  const [measuredSize, setMeasuredSize] = useState(280);
  const size = props.size ?? measuredSize;

  // ✅ detect iPad / large screens for scaling
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  const [last, setLast] = useState<string>("—");

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setMeasuredSize(Math.min(width, height));
  }

  const cx = size / 2;
  const cy = size / 2;

  /**
   * ✅ Make the board itself larger on iPad.
   * This DOES NOT change hit-testing vs drawing because both use rOuter.
   */
  const rOuter = size * (isLarge ? 0.47 : 0.43);

  // ✅ marker scales a bit on iPad too
  const markerSize = isLarge ? 16 : 12;

  // Marker animation
  const [marker, setMarker] = useState<{ x: number; y: number; id: number } | null>(null);
  const markerOpacity = useRef(new Animated.Value(0)).current;
  const markerScale = useRef(new Animated.Value(0.6)).current;

  function flashMarker(x: number, y: number) {
    const id = Date.now();
    setMarker({ x, y, id });

    markerOpacity.stopAnimation();
    markerScale.stopAnimation();

    markerOpacity.setValue(1);
    markerScale.setValue(0.6);

    Animated.parallel([
      Animated.timing(markerScale, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(markerOpacity, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setMarker((m) => (m?.id === id ? null : m));
    });
  }

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

  // ✅ Target pulse (for highlight)
  const targetPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
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
  }, [targetPulse]);

  const wedges = useMemo(() => {
    const wedgeSize = 360 / 20;
    return Array.from({ length: 20 }).map((_, i) => {
      const offset = wedgeSize / 2; // aligns 20 at top
      const start = i * wedgeSize - offset;
      const end = (i + 1) * wedgeSize - offset;
      return { i, start, end };
    });
  }, []);

  // ✅ Ring radii derived from the same RATIOS used for hit-testing
  const R_DB = rOuter * RATIOS.DB;
  const R_SB = rOuter * RATIOS.SB;
  const R_T_IN = rOuter * RATIOS.T_IN;
  const R_T_OUT = rOuter * RATIOS.T_OUT;
  const R_D_IN = rOuter * RATIOS.D_IN;
  const R_D_OUT = rOuter * RATIOS.D_OUT;

  // Where wedge fill starts (keep bull clear)
  const R_WEDGE_IN = rOuter * RATIOS.WEDGE_IN;

  // ✅ Slightly more breathing room for numbers on iPad
  const R_NUMBERS = rOuter * (isLarge ? 0.97 : RATIOS.NUMBERS);

  // ✅ numbers a bit larger on iPad
  const numberFontSize = size * (isLarge ? 0.05 : 0.05);

  // ✅ Which wedge should be highlighted?
  const targetWedgeIndex = useMemo(() => {
    if (!props.highlightTarget || props.highlightTarget === "BULL") return null;
    const idx = BOARD_ORDER.indexOf(props.highlightTarget);
    return idx >= 0 ? idx : null;
  }, [props.highlightTarget]);

  const targetWedge = targetWedgeIndex !== null ? wedges[targetWedgeIndex] : null;

  // Opacity ramps for nice glow
  const targetGlowOpacity = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.28],
  });

  const targetGlowOpacityStrong = targetPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.45],
  });

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Pressable
        disabled={props.disabled}
        style={[
          styles.pressable,
          { width: size, height: size },
          props.disabled && { opacity: 0.5 },
        ]}
        onPress={(evt) => {
          const { locationX, locationY } = evt.nativeEvent;

          flashMarker(locationX, locationY);

          const dx = locationX - cx;
          const dy = locationY - cy;

          const dist = Math.sqrt(dx * dx + dy * dy);
          const rNorm = dist / rOuter;

          const deg = angleDegFromTopClockwise(dx, dy);
          const idx = wedgeIndexFromAngle(deg);
          flashWedge(idx);

          const n = wedgeNumberFromAngle(deg);
          const ring = ringFromRadius(rNorm, n);

          // ✅ detailed callback for Golf
          props.onDartDetail?.(ring);

          // legacy DartCode for Match engine
          const dart = ringToDartCode(ring);

          setLast(ringToLabel(ring));
          props.onDart(dart);
        }}
      >
        <Svg width={size} height={size}>
          {/* Outer (number ring background) */}
          <Circle cx={cx} cy={cy} r={rOuter * 1.18} fill={BLACK} />

          {/* Main wedges (even=BLACK, odd=CREAM) so 20 is black */}
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

          {/* Treble ring segments: 20 (i=0) red, 1 (i=1) green */}
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

          {/* Double ring segments: 20 (i=0) red, 1 (i=1) green */}
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

          {/* ✅ TARGET HIGHLIGHT (number wedge) */}
          {targetWedge && !props.disabled && (
            <>
              {/* Soft fill glow across the scoring area */}
              <AnimatedPath
                d={describeArc(cx, cy, R_WEDGE_IN, R_D_OUT, targetWedge.start, targetWedge.end)}
                fill={HILITE}
                opacity={targetGlowOpacity}
              />
              {/* Slightly stronger ring-only glow to “frame” the target */}
              <AnimatedPath
                d={describeArc(cx, cy, R_D_IN, R_D_OUT, targetWedge.start, targetWedge.end)}
                fill={HILITE}
                opacity={targetGlowOpacityStrong}
              />
            </>
          )}

          {/* ✅ TARGET HIGHLIGHT (bull) */}
          {props.highlightTarget === "BULL" && !props.disabled && (
            <>
              <AnimatedCircle
                cx={cx}
                cy={cy}
                r={R_SB + (isLarge ? 7 : 5)}
                fill="transparent"
                stroke={HILITE}
                strokeWidth={isLarge ? 5 : 4}
                opacity={targetGlowOpacity}
              />
              <AnimatedCircle
                cx={cx}
                cy={cy}
                r={R_DB + (isLarge ? 6 : 4)}
                fill="transparent"
                stroke={HILITE}
                strokeWidth={isLarge ? 5 : 4}
                opacity={targetGlowOpacityStrong}
              />
            </>
          )}

          {/* Wedge flash overlay */}
          {flashWedgeIndex !== null && wedges[flashWedgeIndex] && (
            <AnimatedPath
              d={describeArc(cx, cy, R_WEDGE_IN, R_D_OUT, wedges[flashWedgeIndex].start, wedges[flashWedgeIndex].end)}
              fill={FLASH}
              opacity={wedgeFlash.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.30],
              })}
            />
          )}

          {/* Numbers (outside segments) */}
          {BOARD_ORDER.map((num, i) => {
            const angle = (i * 360) / 20;
            const rad = (angle * Math.PI) / 180;

            const isTarget = props.highlightTarget === num && !props.disabled;

            return (
              <SvgText
                key={num}
                x={cx + R_NUMBERS * Math.sin(rad)}
                y={cy - R_NUMBERS * Math.cos(rad)}
                fill={isTarget ? HILITE : "white"}
                fontSize={isTarget ? numberFontSize * 1.12 : numberFontSize}
                fontWeight={isTarget ? "900" : "800"}
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {num}
              </SvgText>
            );
          })}
        </Svg>

        {marker && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: marker.x - markerSize / 2,
                top: marker.y - markerSize / 2,
                width: markerSize,
                height: markerSize,
                borderRadius: markerSize / 2,
                opacity: markerOpacity,
                transform: [{ scale: markerScale }],
              },
            ]}
          />
        )}
      </Pressable>

      <Text style={[styles.last, isLarge && styles.lastLarge]}>Last: {last}</Text>
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
