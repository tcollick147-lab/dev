// src/screens/GolfSetupScreen.tsx
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
  loadGolfSetup,
  saveGolfSetup,
} from "../storage/setupStorage";



type Props = NativeStackScreenProps<RootStackParamList, "GolfSetup">;
type Hole = number | "BULL";
type GolfCellMode = "HOLE" | "TOTAL";


// ----------------------------
// Helpers — Holes / Presets
// ----------------------------
function holesFromSelection(selected: boolean[], bullOn: boolean): Hole[] {
  const holes: Hole[] = [];
  for (let i = 1; i <= 18; i++) if (selected[i]) holes.push(i);
  if (bullOn) holes.push("BULL");
  return holes;
}

function setPresetSelection(
  p: "1_9_BULL" | "10_18_BULL" | "1_18_BULL",
  setSelected: React.Dispatch<React.SetStateAction<boolean[]>>,
  setBullOn: React.Dispatch<React.SetStateAction<boolean>>
) {
  const next = Array(19).fill(false) as boolean[];

  if (p === "1_9_BULL") {
    for (let i = 1; i <= 9; i++) next[i] = true;
    setBullOn(true);
  }

  if (p === "10_18_BULL") {
    for (let i = 10; i <= 18; i++) next[i] = true;
    setBullOn(true);
  }

  if (p === "1_18_BULL") {
    for (let i = 1; i <= 18; i++) next[i] = true;
    setBullOn(true);
  }

  setSelected(next);
}


function isExactly18PlusBull(selected: boolean[], bullOn: boolean) {
  if (!bullOn) return false;
  for (let i = 1; i <= 18; i++) if (!selected[i]) return false;
  return true;
}

function isPresetActive(
  p: "1_9_BULL" | "10_18_BULL" | "1_18_BULL",
  selected: boolean[],
  bullOn: boolean
) {
  if (!bullOn) return false;

  if (p === "1_9_BULL") {
    for (let i = 1; i <= 9; i++) if (!selected[i]) return false;
    for (let i = 10; i <= 18; i++) if (selected[i]) return false;
    return true;
  }

  if (p === "10_18_BULL") {
    for (let i = 10; i <= 18; i++) if (!selected[i]) return false;
    for (let i = 1; i <= 9; i++) if (selected[i]) return false;
    return true;
  }

  // 1_18_BULL
  for (let i = 1; i <= 18; i++) if (!selected[i]) return false;
  return true;
}


function selectedSummary(selected: boolean[], bullOn: boolean) {
  const nums: number[] = [];
  for (let i = 1; i <= 18; i++) if (selected[i]) nums.push(i);
  const parts = nums.length ? nums.join(", ") : "none";
  return bullOn ? `${parts}, Bull` : parts;
}

// ---------- Placement Table helpers ----------
function ensureDefaultPlacement(n: number) {
  // default: +10 for 1st, -10 for last, 0 otherwise (balanced to 0)
  const arr = Array.from({ length: n }, (_, i) =>
    i === 0 ? 10 : i === n - 1 ? -10 : 0
  );
  const sum = arr.reduce<number>((a, b) => a + b, 0);
  arr[n - 1] -= sum; // force sum==0
  return arr;
}

function placementSum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

function toNum(text: string, fallback: number) {
  const cleaned = text.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

// ----------------------------
// UI helpers
// ----------------------------
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

// ============================
// Screen
// ============================
export default function GolfSetupScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  // =========================
  // PLAYER SYSTEM
  // =========================
  const [allPlayers, setAllPlayers] = useState<string[]>([
    "Player 1",
    "Player 2",
  ]);
  const [players, setPlayers] = useState<string[]>([]);
  const masterInputRefs = useRef<(TextInput | null)[]>([]);

  function addToGame(name: string) {
    const n = name.trim();
    if (!n) return;
    if (players.includes(n)) return;
    if (players.length >= 8) {
      Alert.alert("Player limit", "You can only add up to 8 players to the game.");
      return;
    }
    setPlayers((p) => [...p, n]);
  }

  function removeFromGame(name: string) {
    const n = name.trim();
    setPlayers((p) => p.filter((x) => x !== n));
  }

  function removeFromMaster(name: string) {
    const n = name.trim();
    setAllPlayers((p) => p.filter((x) => x.trim() !== n));
    setPlayers((p) => p.filter((x) => x.trim() !== n));
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
  // GOLF SETTINGS
  // =========================
  const [golfSelected, setGolfSelected] = useState<boolean[]>(() => {
    const arr = Array(19).fill(false) as boolean[];
    for (let i = 1; i <= 18; i++) arr[i] = true;
    return arr;
  });
  const [golfBullOn, setGolfBullOn] = useState(true);

  // "Nassau Mode" master (Classic is simply the opposite)
  const [golfNassau, setGolfNassau] = useState(true);
  const prevGolfNassau = useRef<boolean>(golfNassau);

  const classicModeOn = !golfNassau;
  const [golfCellMode, setGolfCellMode] = useState<GolfCellMode>("TOTAL");

  const [golfSide, setGolfSide] = useState({
    enabled: true,

    // Placement (shared table)
    placementOn: false,
    placement: [] as number[],

    // Back 9 multiplier (used when Nassau is active)
    nassauBackMultiplier: 2 as 1 | 2,

    // Tie / playoff
    allowTie: true,
    tieDivisor: 5,

    // Eagle streak
    eagleBonusOn: true,
    eagleBonusValue: 5,
    eagleBonusCount: 2,

    eagleJackpotOn: true,
    eagleJackpotValue: 10,
    eagleJackpotCount: 3,

    // Round score
    roundBonusOn: true,
    roundBonusValue: 5,
    roundBonusThreshold: 9,

    roundJackpotOn: true,
    roundJackpotValue: 10,
    roundJackpotThreshold: 5,
  });

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
      if (storedPlayers) setAllPlayers(storedPlayers);
    })();
  }, []);

  useEffect(() => {
    savePlayers(allPlayers);
  }, [allPlayers]);

  useEffect(() => {
  (async () => {
    const stored = await loadGolfSetup();
    if (stored) {
      if (Array.isArray(stored.inGamePlayers)) {
        const saved = stored.inGamePlayers.map((x) => String(x ?? "").trim()).filter(Boolean);
        setPlayers(saved);
        setAllPlayers((prev) => {
          const set = new Set(prev);
          const next = [...prev];
          for (const name of saved) if (!set.has(name)) next.push(name);
          return next;
        });
      }

      if (stored.golf) {
        if (Array.isArray(stored.golf.selected) && stored.golf.selected.length === 19) {
          setGolfSelected(stored.golf.selected);
        }
        setGolfBullOn(!!stored.golf.bullOn);
        setGolfNassau(!!stored.golf.nassau);

        if (stored.golf.cellMode === "HOLE" || stored.golf.cellMode === "TOTAL") {
          setGolfCellMode(stored.golf.cellMode);
        }

        if (stored.golf.side) {
          setGolfSide((s) => {
            const patch = stored.golf.side as any;
            return {
              ...s,
              ...patch,
              placement: Array.isArray(patch?.placement) ? patch.placement : s.placement,
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


// =========================
// SAVE GOLF SETUP (debounced)
// =========================
useEffect(() => {
  if (!didLoadPersisted) return;

  const t = setTimeout(() => {
    saveGolfSetup({
      inGamePlayers: players.map((p) => p.trim()).filter(Boolean),
      golf: {
        selected: golfSelected,
        bullOn: golfBullOn,
        nassau: golfNassau,
        cellMode: golfCellMode,
        side: golfSide,
      },
    });
  }, 250);

  return () => clearTimeout(t);
}, [
  didLoadPersisted,
  players,
  golfSelected,
  golfBullOn,
  golfNassau,
  golfCellMode,
  golfSide,
]);




  // =========================
  // VALIDATION
  // =========================
  const nassauValid = isExactly18PlusBull(golfSelected, golfBullOn);

  // =========================
  // START GAME
  // =========================
  function onStart() {
    const cleaned = players.map((p) => p.trim()).filter(Boolean);

    if (cleaned.length < 2) {
      Alert.alert("Players", "Please select at least 2 players.");
      return;
    }

    const playerCount = cleaned.length;

    const placement =
      golfSide.placement.length === playerCount
        ? golfSide.placement
        : ensureDefaultPlacement(playerCount);

    const placementRewardsOn = !!golfSide.enabled && !!golfSide.placementOn;
    const classicPlacementOn = placementRewardsOn && !golfNassau;
    const nassauRewardsOn = placementRewardsOn && golfNassau && nassauValid;

    const anyTableRewardsActive = classicPlacementOn || nassauRewardsOn;

    if (anyTableRewardsActive && placementSum(placement) !== 0) {
      Alert.alert(
        "Rewards must balance",
        `Placement / Nassau rewards must sum to 0.\n\nCurrent sum: ${placementSum(
          placement
        )}`
      );
      return;
    }

    const setupPayload: any = {
      players: cleaned,
      golf: {
        holes: holesFromSelection(golfSelected, golfBullOn),
        nassau: golfNassau,
        cellMode: golfCellMode,
        side: golfSide.enabled
          ? {
              enabled: true,

              placementOn: classicPlacementOn,
              placement,

              // Nassau derived flags:
              nassauOn: nassauRewardsOn,
              nassauFrontOn: nassauRewardsOn,
              nassauBackOn: nassauRewardsOn,
              nassauOverallOn: nassauRewardsOn,

              nassauBackMultiplier:
                (golfSide.nassauBackMultiplier ?? 1) as 1 | 2,

              tiesAllowed: !!golfSide.allowTie,
              playoffsAllowed: true,
              tieDivisor: Math.max(
                1,
                Math.floor(Number(golfSide.tieDivisor) || 5)
              ),

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

              tiesAllowed: false,
              playoffsAllowed: true,
              tieDivisor: Math.max(
                1,
                Math.floor(Number(golfSide.tieDivisor) || 5)
              ),

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
              roundJackpotValue: golfSide.roundBonusValue,
              roundJackpotThreshold: golfSide.roundJackpotThreshold,
            },
      },
    };

    navigation.navigate("GolfGame", { setup: setupPayload });
  }

  // =========================
  // UI
  // =========================
  const availablePlayers = useMemo(
    () => allPlayers.filter((p) => !players.includes(p)),
    [allPlayers, players]
  );

  return (
    <ScrollView contentContainerStyle={[styles.container, isLarge && stylesL.container]}>
      <Text style={[styles.title, isLarge && stylesL.title]}>Golf Setup</Text>
      <Text style={[styles.sub, isLarge && stylesL.sub]}>
        Manual test app • 2–8 players • no teams
      </Text>

      {/* Players */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
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

                    {/* Add / Remove */}
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

                    {/* Delete */}
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
                  !(allPlayers.length < 50) && styles.disabled,
                ]}
                disabled={!(allPlayers.length < 50)}
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

      {/* Round */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Round
        </Text>

        <Text style={[styles.h, isLarge && stylesL.h]}>Quick presets</Text>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {(["1_9_BULL", "10_18_BULL", "1_18_BULL"] as const).map((p) => {
            const label =
  p === "1_9_BULL"
    ? "1–9 + Bull"
    : p === "10_18_BULL"
    ? "10–18 + Bull"
    : "1–18 + Bull";
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
                  golfNassau && { opacity: 0.5 }, // lock feel while Nassau mode on
                ]}
                onPress={() => {
                  if (golfNassau) return; // lock selection in Nassau mode
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
              golfNassau && { opacity: 0.5 },
            ]}
            onPress={() => {
              if (golfNassau) return; // lock bull in Nassau mode
              setGolfBullOn((v) => !v);
            }}
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
              opacity: golfNassau ? 0.5 : 1,
            },
          ]}
          onPress={() => {
            if (golfNassau) return; // lock while Nassau on
            setGolfSelected(() => Array(19).fill(false) as boolean[]);
            setGolfBullOn(false);
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

        {/* Classic Mode (mutually exclusive with Nassau Mode) */}
        <View style={[styles.row, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
              Classic Mode
            </Text>
            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Plays a single leg using your selected holes above.
            </Text>
          </View>

          <Switch
            value={classicModeOn}
            onValueChange={(v) => {
              // radio-style: Classic ON => Nassau OFF; Classic OFF => Nassau ON
              setGolfNassau(!v);
            }}
          />
        </View>

        {/* Nassau Mode */}
        <View style={[styles.row, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
              Nassau Mode
            </Text>
            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Requires exactly 1–18 + Bull and plays 3 legs (Front 9, Back 9 +
              Bull, Overall).
            </Text>
          </View>

          <Switch
            value={golfNassau}
            onValueChange={(v) => {
              setGolfNassau(v);
            }}
          />
        </View>

        <Text style={[styles.hint, isLarge && stylesL.hint]}>
          Nassau requires exactly 1–18 + Bull.
        </Text>
      </View>

      {/* Score Display */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Score Display
        </Text>

        <Segmented
          label="Score display on holes"
          value={golfCellMode}
          onChange={setGolfCellMode}
          isLarge={isLarge}
          options={[
            { label: "Total Score", value: "TOTAL" },
            { label: "Hole Score", value: "HOLE" },
          ]}
        />

        <Text style={[styles.hint, isLarge && stylesL.hint]}>
          Hole Score shows only the hole result. Total Score shows running
          total.
        </Text>
      </View>

      {/* Side Games */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <View
          style={[
            styles.row,
            {
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 2,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              isLarge && stylesL.sectionTitle,
              { marginTop: 0 },
            ]}
          >
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

        {/* Placement */}
        <View
          style={[
            styles.row,
            {
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 10,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              isLarge && stylesL.sectionTitle,
              { marginTop: 0 },
            ]}
          >
            Placement Rewards
          </Text>

          <Switch
            value={golfSide.placementOn}
            onValueChange={(v) => setGolfSide((s) => ({ ...s, placementOn: v }))}
            disabled={!golfSide.enabled}
          />
        </View>

        <Text
          style={[
            styles.h,
            isLarge && stylesL.h,
            { marginTop: 8, marginBottom: -10, lineHeight: 14 },
          ]}
        >
          Full Round
        </Text>

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 10,
            opacity: golfSide.enabled ? 1 : 0.5,
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
                editable={golfSide.enabled}
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

        {golfNassau && (
          <View style={{ marginTop: 12, opacity: 0.6 }}>
            {/* Front 9 (display-only) */}
            <Text style={[styles.h, isLarge && stylesL.h]}>Front 9 (auto)</Text>

            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 8,
              }}
            >
              {golfSide.placement.map((v, i) => (
                <View
                  key={`front-${i}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <View style={[styles.pill, isLarge && stylesL.pill]}>
                    <Text style={[styles.pillText, isLarge && stylesL.pillText]}>
                      {i + 1}
                      {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.smallInput,
                      isLarge && stylesL.smallInput,
                      styles.readOnlyBox,
                    ]}
                  >
                    <Text style={styles.readOnlyText}>{String(v)}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Back 9 (display-only) */}
            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 12 }]}>
              Back 9 (auto) • ×{golfSide.nassauBackMultiplier ?? 1}
            </Text>

            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 8,
              }}
            >
              {golfSide.placement.map((v, i) => {
                const m = golfSide.nassauBackMultiplier ?? 1;
                const backVal = v * m;
                return (
                  <View
                    key={`back-${i}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                    <View style={[styles.pill, isLarge && stylesL.pill]}>
                      <Text
                        style={[styles.pillText, isLarge && stylesL.pillText]}
                      >
                        {i + 1}
                        {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.smallInput,
                        isLarge && stylesL.smallInput,
                        styles.readOnlyBox,
                      ]}
                    >
                      <Text style={styles.readOnlyText}>{String(backVal)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {golfNassau && (
          <>
            <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
              Nassau Rewards
            </Text>

            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Nassau rewards are automatic only when Nassau Mode + Placement
              Rewards are ON (Front 9, Back 9 + Bull, Overall). Uses the
              placement table for each leg.
            </Text>

            {/* Back 9 multiplier */}
            <View
              style={{
                marginTop: 10,
                opacity: golfSide.enabled && golfNassau && nassauValid ? 1 : 0.5,
              }}
            >
              <Text style={[styles.h, isLarge && stylesL.h]}>
                Back 9 multiplier
              </Text>

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
                        setGolfSide((s) => ({
                          ...s,
                          nassauBackMultiplier: m as 1 | 2,
                        }))
                      }
                      disabled={!golfSide.enabled || !golfNassau || !nassauValid}
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
          </>
        )}

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
          Tie option appears only when the leg payout can be split evenly by
          this divisor.
        </Text>

        {/* Eagle Streak */}
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Eagle Streak
        </Text>

        <View style={styles.row}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel]}>
            Eagle Streak Bonus
          </Text>
          <Switch
            value={golfSide.eagleBonusOn}
            onValueChange={(v) =>
              setGolfSide((s) => ({ ...s, eagleBonusOn: v }))
            }
            disabled={!golfSide.enabled}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Bonus Value
          </Text>
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
            onValueChange={(v) =>
              setGolfSide((s) => ({ ...s, eagleJackpotOn: v }))
            }
            disabled={!golfSide.enabled}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Jackpot Value
          </Text>
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

        {/* Total Round Score */}
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
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Bonus Value
          </Text>
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
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Threshold (≤)
          </Text>
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
            onValueChange={(v) =>
              setGolfSide((s) => ({ ...s, roundJackpotOn: v }))
            }
            disabled={!golfSide.enabled}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Jackpot Value
          </Text>
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
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Threshold (≤)
          </Text>
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

  <Pressable
    style={[styles.primary, isLarge && stylesL.primary]}
    onPress={onStart}
  >
    <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>
      Start Golf
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

readOnlyBox: {
  justifyContent: "center",
  backgroundColor: "#F3F4F6",
  borderColor: "#E5E7EB",
},
readOnlyText: {
  textAlign: "right",
  fontWeight: "800",
  opacity: 0.8,
},

// --- Players panel styles ---
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

playerBox: { maxHeight: 320, padding: 10 },
playerName: { fontSize: 16 },
});

