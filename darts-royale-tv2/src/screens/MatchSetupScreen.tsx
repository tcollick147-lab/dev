// src/screens/MatchSetupScreen.tsx
import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import {
  loadPlayers,
  savePlayers,
  loadMatchSetup,
  saveMatchSetup,
  type PersistedSetup,
} from "../storage/setupStorage";





type Props = NativeStackScreenProps<RootStackParamList, "MatchSetup">;

type InRule = "STRAIGHT" | "DOUBLE" | "MASTER";
type OutRule = "STRAIGHT" | "DOUBLE" | "MASTER";

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

// ============================
// Screen
// ============================
export default function MatchSetupScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  // ✅ Keep last loaded setup so we don't accidentally wipe unrelated blocks (e.g. golf)
  const storedSetupRef = useRef<PersistedSetup | null>(null);

  // ✅ Keep handle to the debounce so we can flush on Start
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // =========================
  // PLAYER SYSTEM
  // =========================
  const [allPlayers, setAllPlayers] = useState<string[]>(["Player 1", "Player 2"]);
  const [players, setPlayers] = useState<string[]>([]);
  const masterInputRefs = useRef<(TextInput | null)[]>([]);

  function addToGame(name: string) {
    const n = name.trim();
    if (!n) return;
    if (players.includes(n)) return;
    if (players.length >= 6) {
      Alert.alert("Player limit", "You can only add up to 6 players to the game.");
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
  // MATCH SETTINGS
  // =========================
  const [startScoreText, setStartScoreText] = useState("501");
  const parsedStart = useMemo(() => Number(startScoreText), [startScoreText]);

  const [inRule, setInRule] = useState<InRule>("STRAIGHT");
  const [outRule, setOutRule] = useState<OutRule>("DOUBLE");
  const [closestToBull, setClosestToBull] = useState(false);

  const [side, setSide] = useState({
    gameWinnerOn: true,
    entry: 20,

    scoreBonusOn: true,
    scoreBonusThreshold: 80,
    scoreBonusValue: 5,

    scoreJackpotOn: true,
    scoreJackpotThreshold: 100,
    scoreJackpotValue: 10,

    checkoutBonusOn: true,
    checkoutBonusThreshold: 80,
    checkoutBonusValue: 5,

    checkoutJackpotOn: true,
    checkoutJackpotThreshold: 100,
    checkoutJackpotValue: 20,

    bullOn: true,
    bullValue: 20,
  });

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
      const stored = await loadMatchSetup();
      if (stored) {
        storedSetupRef.current = stored; // ✅ remember original blocks (e.g. golf)

        setStartScoreText(String(stored.startScore));
        setInRule(stored.inRule as any);
        setOutRule(stored.outRule as any);
        setClosestToBull(!!(stored as any).closestToBull);
        setSide(stored.side as any);

        // ✅ Restore last "In Game" players (play order)
        if (Array.isArray((stored as any).inGamePlayers)) {
          const saved = (stored as any).inGamePlayers
            .map((x: any) => String(x ?? "").trim())
            .filter(Boolean);

          setPlayers(saved);

          // ensure they also exist in All Players
          setAllPlayers((prev) => {
            const set = new Set(prev);
            const next = [...prev];
            for (const name of saved) if (!set.has(name)) next.push(name);
            return next;
          });
        }
      }
      setDidLoadPersisted(true);
    })();
  }, []);

  // ✅ Reload closestToBull (and other match prefs) when returning from game (lobby and back)
  useFocusEffect(
    React.useCallback(() => {
      if (!didLoadPersisted) return;
      loadMatchSetup().then((stored) => {
        if (stored && typeof (stored as any).closestToBull === "boolean") {
          setClosestToBull(!!(stored as any).closestToBull);
        }
      });
    }, [didLoadPersisted])
  );

  // ✅ autosave (debounced)
  useEffect(() => {
    if (!didLoadPersisted) return;

    const payload: PersistedSetup = {
      startScore: Number.isFinite(parsedStart) ? parsedStart : 501,
      inRule: inRule as any,
      outRule: outRule as any,
      side: side as any,

      // remember last in-game list
      inGamePlayers: players.map((p) => p.trim()).filter(Boolean),
      closestToBull,

      // ✅ IMPORTANT: do NOT wipe other setup blocks (e.g. golf) from this screen
      golf: storedSetupRef.current?.golf,
    };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMatchSetup(payload);
      saveTimerRef.current = null;
    }, 250);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [didLoadPersisted, parsedStart, inRule, outRule, side, players, closestToBull]);

  // =========================
  // START GAME
  // =========================
  async function onStart() {
  const cleaned = players.map((p) => p.trim()).filter(Boolean);

  if (cleaned.length < 1) {
    Alert.alert("Players", "Please add at least 1 player.");
    return;
  }

  if (!Number.isFinite(parsedStart) || parsedStart <= 0) {
    Alert.alert("Invalid start score", "Please enter a positive number (e.g. 301 or 501).");
    return;
  }

  // ✅ Flush any pending debounce so settings always persist even if you hit Start quickly
  if (saveTimerRef.current) {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }

  const payload: PersistedSetup = {
    startScore: Number.isFinite(parsedStart) ? parsedStart : 501,
    inRule: inRule as any,
    outRule: outRule as any,
    side: side as any,
    inGamePlayers: cleaned,
    closestToBull,
    golf: storedSetupRef.current?.golf,
  };

  await saveMatchSetup(payload);

  navigation.navigate("MatchGame", {
    setup: {
      players: cleaned,
      closestToBull,
      startScore: parsedStart,
      inRule,
      outRule,
      side,
    },
  });
}

  // Header back: navigate to Lobby so back works after Game → Results → back to Setup
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          onPress={() => navigation.navigate("Lobby")}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ fontSize: 17, color: "#2563EB", fontWeight: "600" }}>‹ Lobby</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  // =========================
  // UI
  // =========================
  return (
    <ScrollView
      contentContainerStyle={[styles.container, isLarge && stylesL.container]}
    >
      <Text style={[styles.title, isLarge && stylesL.title]}>Match Setup</Text>
      <Text style={[styles.sub, isLarge && stylesL.sub]}>
        Test app • 1–6 players • no teams
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
                const inGame = players.includes(name) || players.includes(trimmed);

                return (
                  <View
                    key={idx}
                    style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
                  >
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

              {!allPlayers.length && <Text style={styles.hint}>— No players yet —</Text>}
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
                <Text style={[styles.smallButtonText, isLarge && stylesL.smallButtonText]}>
                  + Add to All
                </Text>
              </Pressable>
            </View>
          </View>

          {/* RIGHT = In Game */}
          <View style={{ flex: 1 }}>
            <Text style={[styles.sub, { marginBottom: 4 }]}>In Game (Play Order)</Text>
            <ScrollView style={styles.playerBox}>
              {players.map((name, idx) => (
                <Pressable
                  key={`${name}-${idx}`}
                  style={[styles.playerRow, idx === 0 && { borderColor: "#16A34A" }]}
                  onPress={() => removeFromGame(name)}
                >
                  <Text style={styles.playerName}>
                    {idx + 1}. {name}
                  </Text>
                </Pressable>
              ))}
              {!players.length && <Text style={styles.hint}>Tap left to add players</Text>}
            </ScrollView>
            {!closestToBull && players.length > 1 && (
              <Pressable
                style={[styles.smallButton, styles.shuffleButton, isLarge && stylesL.smallButton]}
                onPress={() => {
                  const next = [...players];
                  for (let i = next.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [next[i], next[j]] = [next[j], next[i]];
                  }
                  setPlayers(next);
                }}
              >
                <Text style={[styles.smallButtonText, isLarge && stylesL.smallButtonText]}>Shuffle Players</Text>
              </Pressable>
            )}
            <Text style={[styles.hint, { marginTop: 8 }]}>
              Tap a player to remove from game.
            </Text>
          </View>
        </View>

        <Text style={[styles.hint, { marginTop: 10 }]}>
          Tip: Add from All Players (left). Remove from game by tapping on the right list.
        </Text>

        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Closest to Bull for throw order</Text>
          <Switch value={closestToBull} onValueChange={setClosestToBull} />
        </View>
      </View>

      {/* Start score */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>Start score</Text>

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

      {/* Rules */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>Rules</Text>

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

      {/* Side Games (Match) */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.cardTitle, isLarge && stylesL.cardTitle]}>
          Side Games (Match)
        </Text>

        {/* Match winner */}
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

        {/* Score bonus */}
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Score Rewards
        </Text>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Score Bonus</Text>
          <Switch
            value={side.scoreBonusOn}
            onValueChange={(v) => setSide((s) => ({ ...s, scoreBonusOn: v }))}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Bonus Threshold (≥)
          </Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.scoreBonusThreshold)}
            editable={side.scoreBonusOn}
            onChangeText={(t) => setSideNumber("scoreBonusThreshold", t)}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Bonus Value</Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.scoreBonusValue)}
            editable={side.scoreBonusOn}
            onChangeText={(t) => setSideNumber("scoreBonusValue", t)}
          />
        </View>

        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Score Jackpot
          </Text>
          <Switch
            value={side.scoreJackpotOn}
            onValueChange={(v) => setSide((s) => ({ ...s, scoreJackpotOn: v }))}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Jackpot Threshold (≥)
          </Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.scoreJackpotThreshold)}
            editable={side.scoreJackpotOn}
            onChangeText={(t) => setSideNumber("scoreJackpotThreshold", t)}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Jackpot Value
          </Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.scoreJackpotValue)}
            editable={side.scoreJackpotOn}
            onChangeText={(t) => setSideNumber("scoreJackpotValue", t)}
          />
        </View>

        {/* Checkout rewards */}
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Checkout Rewards
        </Text>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Checkout Bonus</Text>
          <Switch
            value={side.checkoutBonusOn}
            onValueChange={(v) => setSide((s) => ({ ...s, checkoutBonusOn: v }))}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Bonus Threshold (≥)
          </Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.checkoutBonusThreshold)}
            editable={side.checkoutBonusOn}
            onChangeText={(t) => setSideNumber("checkoutBonusThreshold", t)}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Bonus Value</Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.checkoutBonusValue)}
            editable={side.checkoutBonusOn}
            onChangeText={(t) => setSideNumber("checkoutBonusValue", t)}
          />
        </View>

        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Checkout Jackpot
          </Text>
          <Switch
            value={side.checkoutJackpotOn}
            onValueChange={(v) => setSide((s) => ({ ...s, checkoutJackpotOn: v }))}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Jackpot Threshold (≥)
          </Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.checkoutJackpotThreshold)}
            editable={side.checkoutJackpotOn}
            onChangeText={(t) => setSideNumber("checkoutJackpotThreshold", t)}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Jackpot Value
          </Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.checkoutJackpotValue)}
            editable={side.checkoutJackpotOn}
            onChangeText={(t) => setSideNumber("checkoutJackpotValue", t)}
          />
        </View>

        {/* Bull */}
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Bull</Text>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Bull Rewards</Text>
          <Switch
            value={side.bullOn}
            onValueChange={(v) => setSide((s) => ({ ...s, bullOn: v }))}
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Bull Value</Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput]}
            keyboardType="number-pad"
            value={String(side.bullValue)}
            editable={side.bullOn}
            onChangeText={(t) => setSideNumber("bullValue", t)}
          />
        </View>
      </View>

      <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={onStart}>
        <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Start Match</Text>
      </Pressable>
    </ScrollView>
  );
}

// =========================
// Styles (same as your original)
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

  sectionTitle: { fontSize: 16, fontWeight: "900", marginTop: 10 },
  hint: { marginTop: 2, opacity: 0.7, fontSize: 12 },
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

  actions: { flexDirection: "row", gap: 10 },
  smallButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
  },
  shuffleButton: {
    flex: 0,
    height: 44,
    justifyContent: "center",
    marginTop: 8,
  },
  smallButtonText: { color: "white", fontWeight: "800" },
  disabled: { opacity: 0.4 },

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
});

const stylesL = StyleSheet.create({
  container: { padding: 22, gap: 14 },
  title: { fontSize: 30 },
  sub: { fontSize: 15, marginTop: -4 },

  card: { padding: 18, borderRadius: 16, gap: 12 },
  cardTitle: { fontSize: 20 },

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

  sectionTitle: { fontSize: 22, fontWeight: "900", marginTop: 14 },

  playerBox: { maxHeight: 320, padding: 10 },
  playerName: { fontSize: 16 },
});
