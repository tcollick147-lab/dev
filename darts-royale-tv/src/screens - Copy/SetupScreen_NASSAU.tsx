// src/screens/SetupScreen.tsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  Dimensions,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import {
  loadPlayers,
  savePlayers,
  loadSetup,
  saveSetup,
  type PersistedSetup,
} from "../storage/setupStorage";

type Props = NativeStackScreenProps<RootStackParamList, "Setup">;

type InRule = "STRAIGHT" | "DOUBLE" | "MASTER";
type OutRule = "STRAIGHT" | "DOUBLE" | "MASTER";
type Hole = number | "BULL";
type GolfCellMode = "HOLE" | "TOTAL";

/** holes list from selection */
function holesFromSelection(selected: boolean[], bullOn: boolean): Hole[] {
  const holes: Hole[] = [];
  for (let i = 1; i <= 18; i++) if (selected[i]) holes.push(i);
  if (bullOn) holes.push("BULL");
  return holes;
}

/** presets */
function setPresetSelection(
  preset: "1_9" | "1_18" | "1_18_BULL",
  setSelected: React.Dispatch<React.SetStateAction<boolean[]>>,
  setBullOn: React.Dispatch<React.SetStateAction<boolean>>
) {
  setSelected(() => {
    const next = Array(19).fill(false) as boolean[];
    if (preset === "1_9") for (let i = 1; i <= 9; i++) next[i] = true;
    if (preset === "1_18" || preset === "1_18_BULL")
      for (let i = 1; i <= 18; i++) next[i] = true;
    return next;
  });
  setBullOn(preset === "1_18_BULL");
}

function isExactly18PlusBull(selected: boolean[], bullOn: boolean) {
  if (!bullOn) return false;
  for (let i = 1; i <= 18; i++) if (!selected[i]) return false;
  return true;
}

function isPresetActive(
  preset: "1_9" | "1_18" | "1_18_BULL",
  selected: boolean[],
  bullOn: boolean
) {
  if (preset === "1_9") {
    if (bullOn) return false;
    for (let i = 1; i <= 9; i++) if (!selected[i]) return false;
    for (let i = 10; i <= 18; i++) if (selected[i]) return false;
    return true;
  }
  if (preset === "1_18") {
    if (bullOn) return false;
    for (let i = 1; i <= 18; i++) if (!selected[i]) return false;
    return true;
  }
  if (!bullOn) return false;
  for (let i = 1; i <= 18; i++) if (!selected[i]) return false;
  return true;
}

function selectedSummary(selected: boolean[], bullOn: boolean) {
  const nums: number[] = [];
  for (let i = 1; i <= 18; i++) if (selected[i]) nums.push(i);
  const parts = nums.length ? nums.join(", ") : "none";
  return bullOn ? `${parts}, Bull` : parts;
}

// ---------- Podium helpers ----------
function ensureDefaultPlacement(n: number) {
  const arr = Array.from({ length: n }, (_, i) =>
    i === 0 ? 10 : i === n - 1 ? -10 : 0
  );
  const sum = arr.reduce((a, b) => a + b, 0);
  arr[n - 1] -= sum;
  return arr;
}

function placementSum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
  isLarge?: boolean;
}) {
  const isLarge = !!props.isLarge;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.h, isLarge && stylesL.h]}>{props.label}</Text>
      <View style={styles.segment}>
        {props.options.map((o) => {
          const active = o.value === props.value;
          return (
            <Pressable
              key={o.value}
              style={[
                styles.segmentBtn,
                isLarge && stylesL.segmentBtn,
                active && styles.segmentBtnActive,
              ]}
              onPress={() => props.onChange(o.value)}
            >
              <Text
                style={[
                  styles.segmentText,
                  isLarge && stylesL.segmentText,
                  active && styles.segmentTextActive,
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function QuickPick(props: {
  value: number;
  current: number;
  onPick: (v: number) => void;
  isLarge?: boolean;
}) {
  const isLarge = !!props.isLarge;
  const active = props.value === props.current;
  return (
    <Pressable
      style={[styles.pill, isLarge && stylesL.pill, active && styles.pillActive]}
      onPress={() => props.onPick(props.value)}
    >
      <Text
        style={[
          styles.pillText,
          isLarge && stylesL.pillText,
          active && styles.pillTextActive,
        ]}
      >
        {props.value}
      </Text>
    </Pressable>
  );
}

function toNum(text: string, fallback: number) {
  const cleaned = text.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

export default function SetupScreen({ navigation, route }: Props) {
  const mode = route.params?.mode ?? "MATCH";
  const isGolf = mode === "GOLF";

  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  // =========================
  // PLAYER SYSTEM (MASTER + IN-GAME)
  // =========================
  const [allPlayers, setAllPlayers] = useState<string[]>([
    "Player 1",
    "Player 2",
  ]);
  const [players, setPlayers] = useState<string[]>([]);

  // =========================
  // MATCH SETTINGS
  // =========================
  const [startScoreText, setStartScoreText] = useState("501");
  const parsedStart = useMemo(() => Number(startScoreText), [startScoreText]);
  const [inRule, setInRule] = useState<InRule>("STRAIGHT");
  const [outRule, setOutRule] = useState<OutRule>("DOUBLE");

  const [side, setSide] = useState({
    gameWinnerOn: false,
    entry: 20,

    scoreBonusOn: true,
    scoreBonusThreshold: 60,
    scoreBonusValue: 30,

    scoreJackpotOn: true,
    scoreJackpotThreshold: 120,
    scoreJackpotValue: 50,

    checkoutBonusOn: false,
    checkoutBonusThreshold: 60,
    checkoutBonusValue: 50,

    checkoutJackpotOn: false,
    checkoutJackpotThreshold: 120,
    checkoutJackpotValue: 100,

    bullOn: false,
    bullValue: 200,
  });

  // =========================
  // GOLF SETTINGS
  // =========================
  const [golfSelected, setGolfSelected] = useState<boolean[]>(() => {
    const arr = Array(19).fill(false) as boolean[];
    for (let i = 1; i <= 18; i++) arr[i] = true;
    return arr;
  });
  const [golfBullOn, setGolfBullOn] = useState(true);
  const [golfNassau, setGolfNassau] = useState(false);
  const prevGolfNassau = useRef<boolean>(golfNassau);
  const [golfCellMode, setGolfCellMode] = useState<GolfCellMode>("HOLE");

  const [golfSide, setGolfSide] = useState({
    enabled: false,

    // Podium
    placementOn: false,
    placement: [] as number[],

    // Option A Nassau legs + multiplier
    nassauFrontOn: true,
    nassauBackOn: true,
    nassauOverallOn: true,
    nassauBackMultiplier: 2 as 1 | 2, // default 2× to match your old "double" toggle

    // Nassau
    nassauOn: false,

    // Tie / playoff
    allowTie: false,
    tieDivisor: 5,

    // Eagle streak
    eagleBonusOn: false,
    eagleBonusValue: 30,
    eagleBonusCount: 2,

    eagleJackpotOn: false,
    eagleJackpotValue: 50,
    eagleJackpotCount: 3,

    // Round score
    roundBonusOn: false,
    roundBonusValue: 30,
    roundBonusThreshold: 5,

    roundJackpotOn: false,
    roundJackpotValue: 50,
    roundJackpotThreshold: 0,
  });

  // =========================
  // HELPERS — PLAYER MANAGEMENT
  // =========================
  const masterInputRefs = useRef<(TextInput | null)[]>([]);

  function addToGame(name: string) {
    const n = name.trim();
    if (!n) return;
    if (players.includes(n)) return;
    setPlayers((p) => [...p, n]);
  }

  function removeFromGame(name: string) {
    const n = name.trim();
    setPlayers((p) => p.filter((x) => x !== n));
  }

  function removeFromMaster(name: string) {
    const n = name.trim();
    setAllPlayers((p) => p.filter((x) => x !== name));
    setPlayers((p) => p.filter((x) => x !== n));
  }

  function addToMaster() {
    setAllPlayers((p) => {
      const next = [...p, ""];
      requestAnimationFrame(() => {
        const idx = next.length - 1;
        masterInputRefs.current[idx]?.focus();
      });
      return next;
    });
  }

  // =========================
  // SYNC PLACEMENT LENGTH
  // =========================
  useEffect(() => {
    const cleanedCount = players.map((p) => p.trim()).filter(Boolean).length;
    const n = Math.max(2, cleanedCount || players.length);
    setGolfSide((s) => {
      const nextPlacement =
        s.placement.length === n ? s.placement : ensureDefaultPlacement(n);
      return { ...s, placement: nextPlacement };
    });
  }, [players]);

  // =========================
  // NASSAU AUTO RULES
  // =========================
  useEffect(() => {
    if (!golfNassau) return;
    setGolfSelected(() => {
      const next = Array(19).fill(false) as boolean[];
      for (let i = 1; i <= 18; i++) next[i] = true;
      return next;
    });
    setGolfBullOn(true);
  }, [golfNassau]);

  useEffect(() => {
    const was = prevGolfNassau.current;
    prevGolfNassau.current = golfNassau;

    if (!golfNassau) return;
    if (!was && golfNassau) return;

    if (!isExactly18PlusBull(golfSelected, golfBullOn)) {
      setGolfNassau(false);
    }
  }, [golfSelected, golfBullOn, golfNassau]);

  // =========================
  // PERSISTENCE
  // =========================
  const [didLoadPersisted, setDidLoadPersisted] = useState(false);

  useEffect(() => {
    (async () => {
      const storedPlayers = await loadPlayers();
      if (storedPlayers) {
        setAllPlayers(storedPlayers);
      }
    })();
  }, []);

  useEffect(() => {
    savePlayers(allPlayers);
  }, [allPlayers]);

  useEffect(() => {
    (async () => {
      const stored = await loadSetup();
      if (stored) {
        setStartScoreText(String(stored.startScore));
        setInRule(stored.inRule as any);
        setOutRule(stored.outRule as any);
        setSide(stored.side as any);

        if (stored.golf) {
          if (
            Array.isArray(stored.golf.selected) &&
            stored.golf.selected.length === 19
          ) {
            setGolfSelected(stored.golf.selected);
          }
          setGolfBullOn(!!stored.golf.bullOn);
          setGolfNassau(!!stored.golf.nassau);

          if (stored.golf.side) {
            setGolfSide((s) => {
              const patch = stored.golf!.side as any;
              return {
                ...s,
                ...patch,
                placement: Array.isArray(patch?.placement)
                  ? patch.placement
                  : s.placement,
                tieDivisor: Number.isFinite(Number(patch?.tieDivisor))
                  ? Math.max(1, Math.floor(Number(patch.tieDivisor)))
                  : s.tieDivisor,
              };
            });
          }
        }
      }
      setDidLoadPersisted(true);
    })();
  }, []);

    // ✅ save everything (debounced)
  useEffect(() => {
    if (!didLoadPersisted) return;

    const payload: PersistedSetup = {
      startScore: Number.isFinite(parsedStart) ? parsedStart : 501,
      inRule: inRule as any,
      outRule: outRule as any,
      side: side as any,
      golf: {
        selected: golfSelected,
        bullOn: golfBullOn,
        nassau: golfNassau,
        cellMode: golfCellMode as any,
        side: golfSide as any,
      } as any,
    };

    const t = setTimeout(() => saveSetup(payload), 250);
    return () => clearTimeout(t);
  }, [
    didLoadPersisted,
    parsedStart,
    inRule,
    outRule,
    side,
    golfSelected,
    golfBullOn,
    golfNassau,
    golfCellMode,
    golfSide,
  ]);

  // ✅ Nassau validity (must be 18 + bull)
  const nassauValid = isExactly18PlusBull(golfSelected, golfBullOn);

  // ✅ If Nassau MODE is ON, Podium finishing rewards should be disabled
  const nassauUsingPodium = golfSide.enabled && golfNassau && nassauValid;

  // ✅ Auto-turn OFF Podium finishing rewards if Nassau rewards are turned on
  useEffect(() => {
    if (!isGolf) return;
    if (!nassauUsingPodium) return;
    setGolfSide((s) => (s.placementOn ? { ...s, placementOn: false } : s));
  }, [isGolf, nassauUsingPodium]);

  const setSideNumber = (
    key:
      | "scoreBonusThreshold"
      | "scoreBonusValue"
      | "scoreJackpotThreshold"
      | "scoreJackpotValue"
      | "checkoutBonusThreshold"
      | "checkoutBonusValue"
      | "checkoutJackpotThreshold"
      | "checkoutJackpotValue"
      | "bullValue"
      | "entry",
    text: string
  ) => {
    const n = parseInt(text.replace(/[^\d]/g, ""), 10);
    setSide((s) => ({ ...s, [key]: Number.isFinite(n) ? n : 0 }));
  };

  function onStart() {
    const cleaned = players.map((p) => p.trim()).filter(Boolean);

    if (cleaned.length < 2) {
      Alert.alert("Players", "Please select at least 2 players.");
      return;
    }

    if (!isGolf) {
      if (!Number.isFinite(parsedStart) || parsedStart <= 0) {
        Alert.alert(
          "Invalid start score",
          "Please enter a positive number (e.g. 301 or 501)."
        );
        return;
      }
    }

    const playerCount = cleaned.length;

    const placement =
      golfSide.placement.length === playerCount
        ? golfSide.placement
        : ensureDefaultPlacement(playerCount);

    const placementEnabled = golfSide.placementOn && !nassauUsingPodium;

    // ✅ Podium + Nassau both use the placement table → must sum to 0
    if (
      isGolf &&
      golfSide.enabled &&
      (placementEnabled || golfSide.nassauOn) &&
      placementSum(placement) !== 0
    ) {
      Alert.alert(
        "Rewards must balance",
        `Podium / Nassau rewards must sum to 0.\n\nCurrent sum: ${placementSum(
          placement
        )}`
      );
      return;
    }

    // ✅ Eagle streak sanity
    if (
      isGolf &&
      golfSide.enabled &&
      golfSide.eagleBonusOn &&
      golfSide.eagleJackpotOn
    ) {
      const bonusValue = Number(golfSide.eagleBonusValue);
      const jackpotValue = Number(golfSide.eagleJackpotValue);
      const bonusCount = Number(golfSide.eagleBonusCount);
      const jackpotCount = Number(golfSide.eagleJackpotCount);

      if (jackpotValue <= bonusValue) {
        Alert.alert(
          "Eagle Streak values",
          "Jackpot Value must be greater than Bonus Value."
        );
        return;
      }
      if (jackpotCount <= bonusCount) {
        Alert.alert(
          "Eagle Streak counts",
          "Jackpot must require more consecutive eagles than the Bonus."
        );
        return;
      }
    }

    // ✅ Round score sanity
    if (
      isGolf &&
      golfSide.enabled &&
      golfSide.roundBonusOn &&
      golfSide.roundJackpotOn
    ) {
      const bonusValue = Number(golfSide.roundBonusValue);
      const jackpotValue = Number(golfSide.roundJackpotValue);
      const bonusThreshold = Number(golfSide.roundBonusThreshold);
      const jackpotThreshold = Number(golfSide.roundJackpotThreshold);

      if (jackpotValue <= bonusValue) {
        Alert.alert(
          "Round Score values",
          "Jackpot Value must be greater than Bonus Value."
        );
        return;
      }
      if (jackpotThreshold >= bonusThreshold) {
        Alert.alert(
          "Round Score thresholds",
          "Jackpot Threshold must be lower (harder) than Bonus Threshold.\n\nExample:\nBonus ≤ +5\nJackpot ≤ 0"
        );
        return;
      }
    }

    const setupPayload: any = {
      players: cleaned,
      startScore: parsedStart,
      inRule,
      outRule,
      side,

      golf: {
        holes: holesFromSelection(golfSelected, golfBullOn),
        nassau: golfNassau,
        cellMode: golfCellMode,

        side: golfSide.enabled
          ? // inside setupPayload.golf.side when enabled === true:
{
  enabled: true,

  placementOn: placementEnabled,
  placement,

  nassauOn: !!golfSide.nassauOn && !!golfNassau && nassauValid,

  // ✅ send the leg toggles (these were missing)
  nassauFrontOn: !!golfSide.nassauFrontOn,
  nassauBackOn: !!golfSide.nassauBackOn,
  nassauOverallOn: !!golfSide.nassauOverallOn,

  // ✅ send multiplier in the NEW format
  nassauBackMultiplier: (golfSide.nassauBackMultiplier ?? 1) as 1 | 2,


              // ✅ TIE / PLAYOFF POLICY (engine field names)
              tiesAllowed: !!golfSide.allowTie,
              playoffsAllowed: true,
              tieDivisor: Math.max(
                1,
                Math.floor(Number(golfSide.tieDivisor) || 5)
              ),

              // ✅ Nassau timing

              eagleBonusOn: !!golfSide.eagleBonusOn,
              eagleBonusValue: golfSide.eagleBonusValue,
              eagleBonusCount: golfSide.eagleBonusCount,

              eagleJackpotOn: !!golfSide.eagleJackpotOn,
              eagleJackpotValue: golfSide.eagleJackpotValue,
              eagleJackpotCount: golfSide.eagleJackpotCount,

              roundBonusOn: !!golfSide.roundBonusOn,
              roundBonusValue: golfSide.roundBonusValue,
              roundBonusThreshold: golfSide.roundBonusThreshold,

              roundJackpotOn: !!golfSide.roundJackpotOn,
              roundJackpotValue: golfSide.roundJackpotValue,
              roundJackpotThreshold: golfSide.roundJackpotThreshold,
            }
          : {
              enabled: false,
              placementOn: false,
              placement,
              nassauOn: false,
              nassauBack9Double: false,

              tiesAllowed: false,
              playoffsAllowed: true,
              tieDivisor: Math.max(
                1,
                Math.floor(Number(golfSide.tieDivisor) || 5)
              ),
              nassauFrontResolveAt9: false,

              eagleBonusOn: false,
              eagleBonusValue: golfSide.eagleBonusValue,
              eagleBonusCount: golfSide.eagleBonusCount,

              eagleJackpotOn: false,
              eagleJackpotValue: golfSide.eagleJackpotValue,
              eagleJackpotCount: golfSide.eagleJackpotCount,

              roundBonusOn: false,
              roundBonusValue: golfSide.roundBonusValue,
              roundBonusThreshold: golfSide.roundBonusThreshold,

              roundJackpotOn: false,
              roundJackpotValue: golfSide.roundJackpotValue,
              roundJackpotThreshold: golfSide.roundJackpotThreshold,
            },
      },
    };

    if (isGolf) navigation.navigate("GolfGame", { setup: setupPayload });
    else navigation.navigate("MatchGame", { setup: setupPayload });
  }

  // =========================
  // UI
  // =========================
  const availablePlayers = useMemo(
    () => allPlayers.filter((p) => !players.includes(p)),
    [allPlayers, players]
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.container, isLarge && stylesL.container]}
    >
      <Text style={[styles.title, isLarge && stylesL.title]}>
        {isGolf ? "Golf Setup" : "Match Setup"}
      </Text>
      <Text style={[styles.sub, isLarge && stylesL.sub]}>
        Manual test app • 2–6 players • no teams
      </Text>

      {/* Players */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
          Players
        </Text>

        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          {/* LEFT = All Players */}
          <View style={{ flex: 1 }}>
            <Text style={styles.sub}>All Players</Text>

            <ScrollView style={styles.playerBox}>
              {allPlayers.map((name, idx) => {
                const trimmed = name.trim();
                const inGame = players.includes(name);

                return (
                  <View
                    key={idx}
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    {/* Edit name */}
                    <View style={[styles.playerRow, { flex: 1 }]}>
                      <TextInput
                        ref={(el) => {
                          masterInputRefs.current[idx] = el;
                        }}
                        value={name}
                        placeholder={`Player ${idx + 1}`}
                        onChangeText={(t) => {
                          const copy = [...allPlayers];
                          copy[idx] = t;
                          setAllPlayers(copy);
                        }}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          if (!trimmed) return;
                          if (!inGame) addToGame(trimmed);
                        }}
                        style={styles.playerName}
                      />
                    </View>

                    {/* Add / Remove pill */}
                    {!inGame ? (
                      <Pressable
                        onPress={() => {
                          if (!trimmed) return;
                          addToGame(trimmed);
                        }}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "#DCFCE7",
                          borderWidth: 1,
                          borderColor: "#86EFAC",
                        }}
                      >
                        <Text
                          style={{
                            color: "#166534",
                            fontWeight: "900",
                            fontSize: 12,
                          }}
                        >
                          Add
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => removeFromGame(trimmed)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "#E5E7EB",
                          borderWidth: 1,
                          borderColor: "#D1D5DB",
                        }}
                      >
                        <Text
                          style={{
                            color: "#111827",
                            fontWeight: "900",
                            fontSize: 12,
                          }}
                        >
                          Remove
                        </Text>
                      </Pressable>
                    )}

                    {/* Delete pill */}
                    <Pressable
                      onPress={() => removeFromMaster(name)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 999,
                        backgroundColor: "#FEE2E2",
                        borderWidth: 1,
                        borderColor: "#FCA5A5",
                      }}
                    >
                      <Text
                        style={{
                          color: "#991B1B",
                          fontWeight: "900",
                          fontSize: 12,
                        }}
                      >
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                );
              })}

              {!allPlayers.length && (
                <Text style={styles.hint}>— No players yet —</Text>
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                style={[
                  styles.smallButton,
                  isLarge && stylesL.smallButton,
                  !(allPlayers.length < 20) && styles.disabled,
                ]}
                disabled={!(allPlayers.length < 8)}
                onPress={addToMaster}
              >
                <Text
                  style={[
                    styles.smallButtonText,
                    isLarge && stylesL.smallButtonText,
                  ]}
                >
                  + Add to All
                </Text>
              </Pressable>
            </View>
          </View>

          {/* RIGHT = In Game */}
          <View style={{ flex: 1 }}>
            <Text style={styles.sub}>In Game (Play Order)</Text>

            <ScrollView style={styles.playerBox}>
              {players.map((name, idx) => (
                <Pressable
                  key={name}
                  style={[
                    styles.playerRow,
                    idx === 0 && { borderColor: "#16A34A" },
                  ]}
                  onPress={() => removeFromGame(name)}
                >
                  <Text style={styles.playerName}>
                    {idx + 1}. {name}
                  </Text>
                </Pressable>
              ))}
              {!players.length && (
                <Text style={styles.hint}>Tap left to add players</Text>
              )}
            </ScrollView>

            <Text style={[styles.hint, { marginTop: 8 }]}>
              Tap a player to remove from game.
            </Text>
          </View>
        </View>

        <Text style={[styles.hint, { marginTop: 10 }]}>
          Tip: Add from All Players (left). Remove from game by tapping on the
          right list.
        </Text>
      </View>

      {/* Golf-only */}
      {isGolf && (
        <>
          <View style={[styles.card, isLarge && stylesL.card]}>
            <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
              Round
            </Text>

            <Text style={[styles.h, isLarge && stylesL.h]}>Quick presets</Text>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              {(["1_9", "1_18", "1_18_BULL"] as const).map((p) => {
                const label =
                  p === "1_9" ? "1–9" : p === "1_18" ? "1–18" : "1–18 + Bull";
                const active = isPresetActive(p, golfSelected, golfBullOn);

                return (
                  <Pressable
                    key={p}
                    style={[
                      styles.pill,
                      isLarge && stylesL.pill,
                      active && styles.pillActive,
                    ]}
                    onPress={() =>
                      setPresetSelection(p, setGolfSelected, setGolfBullOn)
                    }
                  >
                    <Text
                      style={[
                        styles.pillText,
                        isLarge && stylesL.pillText,
                        active && styles.pillTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Select holes
            </Text>
            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Selected: {selectedSummary(golfSelected, golfBullOn)}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => {
                const on = !!golfSelected[n];
                return (
                  <Pressable
                    key={n}
                    style={[
                      styles.pill,
                      isLarge && stylesL.pill,
                      on && styles.pillActive,
                    ]}
                    onPress={() => {
                      setGolfSelected((prev) => {
                        const next = [...prev];
                        next[n] = !next[n];
                        return next;
                      });
                    }}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        isLarge && stylesL.pillText,
                        on && styles.pillTextActive,
                      ]}
                    >
                      {n}
                    </Text>
                  </Pressable>
                );
              })}

              <Pressable
                style={[
                  styles.pill,
                  isLarge && stylesL.pill,
                  golfBullOn && styles.pillActive,
                ]}
                onPress={() => setGolfBullOn((v) => !v)}
              >
                <Text
                  style={[
                    styles.pillText,
                    isLarge && stylesL.pillText,
                    golfBullOn && styles.pillTextActive,
                  ]}
                >
                  Bull
                </Text>
              </Pressable>
            </View>

            <Pressable
              style={[
                styles.pill,
                isLarge && stylesL.pill,
                {
                  backgroundColor: "#FEE2E2",
                  borderColor: "#FCA5A5",
                  alignSelf: "flex-start",
                  marginTop: 10,
                },
              ]}
              onPress={() => {
                setGolfSelected(() => Array(19).fill(false) as boolean[]);
                setGolfBullOn(false);
                setGolfNassau(false);
              }}
            >
              <Text
                style={[
                  styles.pillText,
                  isLarge && stylesL.pillText,
                  { color: "#991B1B", fontWeight: "900" },
                ]}
              >
                Clear Holes
              </Text>
            </Pressable>

            <View style={[styles.row, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                  Nassau Mode
                </Text>
                <Text style={[styles.hint, isLarge && stylesL.hint]}>
                  When enabled, round defaults to 1–18 + Bull.
                </Text>
              </View>

              <Switch value={golfNassau} onValueChange={setGolfNassau} />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Nassau requires exactly 1–18 + Bull.
            </Text>
          </View>

          {/* ✅ Golf Score Display */}
          <View style={[styles.card, isLarge && stylesL.card]}>
            <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
              Score Display
            </Text>

            <Segmented
              label="Score display on holes"
              value={golfCellMode}
              onChange={setGolfCellMode}
              isLarge={isLarge}
              options={[
                { label: "Hole Score", value: "HOLE" },
                { label: "Total Score", value: "TOTAL" },
              ]}
            />

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Hole Score shows only the hole result. Total Score shows running total.
            </Text>
          </View>

          {/* ✅ Golf Side Games */}
          <View style={[styles.card, isLarge && stylesL.card]}>
            <View style={[styles.row, { marginTop: 2 }]}>
              <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
                Side Games (Golf)
              </Text>
              <Switch
                value={golfSide.enabled}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, enabled: v }))}
              />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              When OFF, no rewards are active (even if values are set).
            </Text>

            {/* Podium */}
            <View style={[styles.row, { marginTop: 10 }]}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Podium Rewards
              </Text>
              <Switch
                value={golfSide.placementOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, placementOn: v }))}
                disabled={!golfSide.enabled || nassauUsingPodium}
              />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              {nassauUsingPodium
                ? "Nassau Rewards are ON — Podium table is used for Nassau legs, so Podium finishing rewards are disabled."
                : "Enter values for 1st..Nth. When enabled, totals must sum to 0."}
            </Text>

            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 10,
                opacity: golfSide.enabled && !nassauUsingPodium ? 1 : 0.5,
              }}
            >
              {golfSide.placement.map((v, i) => (
                <View
                  key={i}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <View style={[styles.pill, isLarge && stylesL.pill]}>
                    <Text style={[styles.pillText, isLarge && stylesL.pillText]}>
                      {i + 1}
                      {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}
                    </Text>
                  </View>

                  <TextInput
                    style={[styles.smallInput, isLarge && stylesL.smallInput]}
                    keyboardType="numbers-and-punctuation"
                    value={String(v)}
                    editable={golfSide.enabled && !nassauUsingPodium}
                    onChangeText={(t) => {
                      const next = [...golfSide.placement];
                      next[i] = toNum(t, 0);
                      setGolfSide((s) => ({ ...s, placement: next }));
                    }}
                  />
                </View>
              ))}
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint, { marginTop: 10 }]}>
              Sum: {placementSum(golfSide.placement)}
            </Text>

            {/* Nassau Settings (Option A) */}
            <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
              Nassau Settings
            </Text>

            <View style={[styles.row, { marginTop: 16 }]}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Nassau Rewards
              </Text>
              <Switch
                value={golfSide.nassauOn}
                onValueChange={(v) =>
                  setGolfSide((s) => ({
                    ...s,
                    nassauOn: v,
                    // sensible default: enable all legs when turning on
                    nassauFrontOn: v ? (s.nassauFrontOn ?? true) : false,
                    nassauBackOn: v ? (s.nassauBackOn ?? true) : false,
                    nassauOverallOn: v ? (s.nassauOverallOn ?? true) : false,
                  }))
                }
                disabled={!golfSide.enabled || !golfNassau || !nassauValid}
              />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Available only in Nassau mode with 18 holes + Bull. Uses the Placement Rewards table for each enabled leg.
            </Text>

            {/* Leg toggles */}
            <View
              style={[
                styles.row,
                { marginTop: 10, opacity: golfSide.nassauOn ? 1 : 0.5 },
              ]}
            >
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Front 9
              </Text>
              <Switch
                value={!!golfSide.nassauFrontOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, nassauFrontOn: v }))}
                disabled={!golfSide.enabled || !golfNassau || !nassauValid || !golfSide.nassauOn}
              />
            </View>

            <View
              style={[
                styles.row,
                { marginTop: 6, opacity: golfSide.nassauOn ? 1 : 0.5 },
              ]}
            >
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Back 9
              </Text>
              <Switch
                value={!!golfSide.nassauBackOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, nassauBackOn: v }))}
                disabled={!golfSide.enabled || !golfNassau || !nassauValid || !golfSide.nassauOn}
              />
            </View>

            <View
              style={[
                styles.row,
                { marginTop: 6, opacity: golfSide.nassauOn ? 1 : 0.5 },
              ]}
            >
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Overall (18 + Bull)
              </Text>
              <Switch
                value={!!golfSide.nassauOverallOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, nassauOverallOn: v }))}
                disabled={!golfSide.enabled || !golfNassau || !nassauValid || !golfSide.nassauOn}
              />
            </View>

            {/* Back 9 multiplier */}
            <View style={{ marginTop: 10, opacity: golfSide.nassauOn ? 1 : 0.5 }}>
              <Text style={[styles.h, isLarge && stylesL.h]}>Back 9 multiplier</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                {[1, 2].map((m) => {
                  const active = (golfSide.nassauBackMultiplier ?? 1) === m;
                  return (
                    <Pressable
                      key={m}
                      style={[
                        styles.pill,
                        isLarge && stylesL.pill,
                        active && styles.pillActive,
                      ]}
                      onPress={() =>
                        setGolfSide((s) => ({ ...s, nassauBackMultiplier: m as 1 | 2 }))
                      }
                      disabled={!golfSide.enabled || !golfSide.nassauOn}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          isLarge && stylesL.pillText,
                          active && styles.pillTextActive,
                        ]}
                      >
                        {m}×
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>



            <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
              Playoffs / Ties
            </Text>

            <View style={[styles.row, { marginTop: 16 }]}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Allow Tie (instead of playoff)
              </Text>
              <Switch
                value={golfSide.allowTie}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, allowTie: v }))}
                disabled={!golfSide.enabled}
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Tie divisor
              </Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(golfSide.tieDivisor)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({
                    ...s,
                    tieDivisor: Math.max(1, Math.floor(toNum(t, 5))),
                  }))
                }
              />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Tie option appears only when the leg payout can be split evenly by this divisor.
            </Text>

            {/* Eagle Streak + Round Score blocks */}
            <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
              Eagle Streak
            </Text>

            <View style={styles.row}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Eagle Streak Bonus
              </Text>
              <Switch
                value={golfSide.eagleBonusOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, eagleBonusOn: v }))}
                disabled={!golfSide.enabled}
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Bonus Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(golfSide.eagleBonusValue)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({ ...s, eagleBonusValue: toNum(t, 30) }))
                }
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Consecutive Eagles
              </Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(golfSide.eagleBonusCount)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({
                    ...s,
                    eagleBonusCount: Math.max(1, Math.floor(toNum(t, 2))),
                  }))
                }
              />
            </View>

            <View style={[styles.row, { marginTop: 10 }]}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Eagle Streak Jackpot
              </Text>
              <Switch
                value={golfSide.eagleJackpotOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, eagleJackpotOn: v }))}
                disabled={!golfSide.enabled}
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Jackpot Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(golfSide.eagleJackpotValue)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({ ...s, eagleJackpotValue: toNum(t, 50) }))
                }
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Consecutive Eagles
              </Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(golfSide.eagleJackpotCount)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({
                    ...s,
                    eagleJackpotCount: Math.max(1, Math.floor(toNum(t, 3))),
                  }))
                }
              />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Jackpot supersedes Bonus.
            </Text>

            <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
              Total Round Score
            </Text>

            <View style={styles.row}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Round Score Bonus
              </Text>
              <Switch
                value={golfSide.roundBonusOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, roundBonusOn: v }))}
                disabled={!golfSide.enabled}
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Bonus Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(golfSide.roundBonusValue)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({ ...s, roundBonusValue: toNum(t, 30) }))
                }
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold (≤)</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(golfSide.roundBonusThreshold)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({ ...s, roundBonusThreshold: toNum(t, 5) }))
                }
              />
            </View>

            <View style={[styles.row, { marginTop: 10 }]}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
                Round Score Jackpot
              </Text>
              <Switch
                value={golfSide.roundJackpotOn}
                onValueChange={(v) => setGolfSide((s) => ({ ...s, roundJackpotOn: v }))}
                disabled={!golfSide.enabled}
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Jackpot Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(golfSide.roundJackpotValue)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({ ...s, roundJackpotValue: toNum(t, 50) }))
                }
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold (≤)</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(golfSide.roundJackpotThreshold)}
                editable={golfSide.enabled}
                onChangeText={(t) =>
                  setGolfSide((s) => ({ ...s, roundJackpotThreshold: toNum(t, 0) }))
                }
              />
            </View>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Paid at game end. Jackpot supersedes Bonus.
            </Text>
          </View>
        </>
      )}

      {/* Match-only */}
      {!isGolf && (
        <>
          <View style={[styles.card, isLarge && stylesL.card]}>
            <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
              Start score
            </Text>

            <Text style={[styles.h, isLarge && stylesL.h]}>Quick pick</Text>
            <View style={styles.pillRow}>
              <QuickPick
                value={301}
                current={Number.isFinite(parsedStart) ? parsedStart : 0}
                onPick={(v) => setStartScoreText(String(v))}
                isLarge={isLarge}
              />
              <QuickPick
                value={501}
                current={Number.isFinite(parsedStart) ? parsedStart : 0}
                onPick={(v) => setStartScoreText(String(v))}
                isLarge={isLarge}
              />
            </View>

            <Text style={[styles.h, isLarge && stylesL.h]}>Custom</Text>
            <TextInput
              value={startScoreText}
              onChangeText={setStartScoreText}
              keyboardType="number-pad"
              style={[styles.input, isLarge && stylesL.input]}
              placeholder="501"
            />
          </View>

          <View style={[styles.card, isLarge && stylesL.card]}>
            <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
              Rules
            </Text>

            <Segmented
              label="In rule"
              value={inRule}
              onChange={setInRule}
              isLarge={isLarge}
              options={[
                { label: "Straight", value: "STRAIGHT" },
                { label: "Double", value: "DOUBLE" },
                { label: "Master", value: "MASTER" },
              ]}
            />

            <View style={{ height: 8 }} />

            <Segmented
              label="Out rule"
              value={outRule}
              onChange={setOutRule}
              isLarge={isLarge}
              options={[
                { label: "Straight", value: "STRAIGHT" },
                { label: "Double", value: "DOUBLE" },
                { label: "Master", value: "MASTER" },
              ]}
            />
          </View>

          {/* ✅ FULL Match Side Games settings (not just Match Winner) */}
          <View style={[styles.card, isLarge && stylesL.card]}>
            <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
              Side Games (Match)
            </Text>

            <View style={[styles.row, { marginTop: 6 }]}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
                Match Winner Rewards
              </Text>
              <Switch
                value={side.gameWinnerOn}
                onValueChange={(v) => setSide((s) => ({ ...s, gameWinnerOn: v }))}
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Entry</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.entry)}
                onChangeText={(t) => setSideNumber("entry", t)}
              />
            </View>

            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Score Bonus
            </Text>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Enabled</Text>
              <Switch
                value={side.scoreBonusOn}
                onValueChange={(v) => setSide((s) => ({ ...s, scoreBonusOn: v }))}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.scoreBonusThreshold)}
                onChangeText={(t) => setSideNumber("scoreBonusThreshold", t)}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.scoreBonusValue)}
                onChangeText={(t) => setSideNumber("scoreBonusValue", t)}
              />
            </View>

            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Score Jackpot
            </Text>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Enabled</Text>
              <Switch
                value={side.scoreJackpotOn}
                onValueChange={(v) => setSide((s) => ({ ...s, scoreJackpotOn: v }))}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.scoreJackpotThreshold)}
                onChangeText={(t) => setSideNumber("scoreJackpotThreshold", t)}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.scoreJackpotValue)}
                onChangeText={(t) => setSideNumber("scoreJackpotValue", t)}
              />
            </View>

            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Checkout Bonus
            </Text>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Enabled</Text>
              <Switch
                value={side.checkoutBonusOn}
                onValueChange={(v) => setSide((s) => ({ ...s, checkoutBonusOn: v }))}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.checkoutBonusThreshold)}
                onChangeText={(t) => setSideNumber("checkoutBonusThreshold", t)}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.checkoutBonusValue)}
                onChangeText={(t) => setSideNumber("checkoutBonusValue", t)}
              />
            </View>

            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Checkout Jackpot
            </Text>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Enabled</Text>
              <Switch
                value={side.checkoutJackpotOn}
                onValueChange={(v) => setSide((s) => ({ ...s, checkoutJackpotOn: v }))}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.checkoutJackpotThreshold)}
                onChangeText={(t) => setSideNumber("checkoutJackpotThreshold", t)}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.checkoutJackpotValue)}
                onChangeText={(t) => setSideNumber("checkoutJackpotValue", t)}
              />
            </View>

            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Bull Reward
            </Text>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Enabled</Text>
              <Switch
                value={side.bullOn}
                onValueChange={(v) => setSide((s) => ({ ...s, bullOn: v }))}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Value</Text>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput]}
                keyboardType="number-pad"
                value={String(side.bullValue)}
                onChangeText={(t) => setSideNumber("bullValue", t)}
              />
            </View>
          </View>
        </>
      )}

      <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={onStart}>
        <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>
          {isGolf ? "Start Golf" : "Start Match"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// =========================
// Styles
// =========================

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
  cardTitle: { fontSize: 16, fontWeight: "900" },

  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowIndex: { width: 22, opacity: 0.7, fontWeight: "700" },

  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "white",
  },

  rowLabel: { flex: 1, fontSize: 16 },

  smallInput: {
    width: 110,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: "right",
  },

  toggleLabel: { flex: 1, fontSize: 16, fontWeight: "900" },
  sectionTitle: { fontSize: 16, fontWeight: "900", marginTop: 10 },

  hint: { marginTop: 2, opacity: 0.7, fontSize: 12 },

  actions: { flexDirection: "row", gap: 10 },
  smallButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
  },
  smallButtonText: { color: "white", fontWeight: "800" },
  disabled: { opacity: 0.4 },

  h: { fontSize: 12, opacity: 0.7, fontWeight: "700" },

  pillRow: { flexDirection: "row", gap: 10 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillActive: { backgroundColor: "#111827" },
  pillText: { fontWeight: "900" },
  pillTextActive: { color: "white" },

  segment: { flexDirection: "row", gap: 8 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  segmentBtnActive: { backgroundColor: "#111827" },
  segmentText: { fontWeight: "800" },
  segmentTextActive: { color: "white" },

  primary: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },

  // --- Players panel styles used in Part 2 ---
  playerBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    maxHeight: 220,
    padding: 6,
    backgroundColor: "white",
  },
  playerRow: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 6,
    backgroundColor: "#F9FAFB",
  },
  playerName: {
    fontSize: 14,
    fontWeight: "700",
  },
  smallDanger: {
    width: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEE2E2",
    marginBottom: 6,
  },
  smallDangerText: { fontSize: 16 },
});

const stylesL = StyleSheet.create({
  container: { padding: 22, gap: 14 },
  title: { fontSize: 30 },
  sub: { fontSize: 15, marginTop: -4 },

  card: { padding: 18, borderRadius: 16, gap: 12 },
  cardTitle: { fontSize: 20 },

  rowIndex: { width: 28, fontSize: 16 },
  input: { paddingVertical: 14, fontSize: 20, borderRadius: 12 },

  rowLabel: { fontSize: 18 },
  smallInput: { width: 140, paddingVertical: 12, fontSize: 18, borderRadius: 10 },

  hint: { fontSize: 14 },
  h: { fontSize: 14 },

  pill: { paddingVertical: 14, paddingHorizontal: 18 },
  pillText: { fontSize: 16 },

  segmentBtn: { paddingVertical: 16, borderRadius: 14 },
  segmentText: { fontSize: 16 },

  smallButton: { paddingVertical: 14, borderRadius: 14 },
  smallButtonText: { fontSize: 16 },

  primary: { paddingVertical: 18, borderRadius: 14 },
  primaryText: { fontSize: 18 },

  toggleLabel: { fontSize: 18, fontWeight: "900" },
  sectionTitle: { fontSize: 22, fontWeight: "900", marginTop: 14 },

  // scale player box a bit for large screens
  playerBox: { maxHeight: 320, padding: 10 },
  playerName: { fontSize: 16 },
});
