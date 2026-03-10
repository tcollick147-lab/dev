// src/screens/CricketSetupScreen.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
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
import {
  RootStackParamList,
  CricketTarget,
  CricketTargetsPreset,
  CricketMode,
} from "../types/navigation";
import { loadPlayers, savePlayers } from "../storage/setupStorage";

type Props = NativeStackScreenProps<RootStackParamList, "CricketSetup">;

function toNum(text: string, fallback: number) {
  const cleaned = text.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
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

function cricketTargetsFromPreset(p: CricketTargetsPreset): CricketTarget[] {
  if (p === "17-20+T+B") return [17, 18, 19, 20, "T", "BULL"];
  if (p === "17-20+D+T+B") return [17, 18, 19, 20, "D", "T", "BULL"];
  return [];
}

export default function CricketSetupScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  const [mode, setMode] = useState<CricketMode>("CLASSIC");
  const [autoConcede, setAutoConcede] = useState(false);
  const [closestToBull, setClosestToBull] = useState(false);

    // ✅ Auto Concede only applies to CUTTHROAT
  useEffect(() => {
    if (mode !== "CUTTHROAT" && autoConcede) {
      setAutoConcede(false);
    }
  }, [mode, autoConcede]);

  // ... then your Players state, sidegames state, etc

  // -------------------
  // Players
  // -------------------
  const [allPlayers, setAllPlayers] = useState<string[]>(["Player 1", "Player 2"]);
  const [players, setPlayers] = useState<string[]>([]);
  const masterInputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    (async () => {
      const storedPlayers = await loadPlayers();
      if (storedPlayers) setAllPlayers(storedPlayers);
    })();
  }, []);

  useEffect(() => {
    savePlayers(allPlayers);
  }, [allPlayers]);

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

  useEffect(() => {
  let alive = true;

  (async () => {
    try {
      const raw = await AsyncStorage.getItem(CRICKET_SETUP_DRAFT_KEY);
      if (!alive || !raw) return;

      const draft = JSON.parse(raw);

      // Restore in-game players
      if (Array.isArray(draft?.players)) {
        const cleaned = draft.players
          .map((x: any) => String(x ?? "").trim())
          .filter((x: string) => x.length > 0);

        // Optional: cap to 6 like your UI rules
        setPlayers(cleaned.slice(0, 6));
      }
      if (typeof draft?.closestToBull === "boolean") {
        setClosestToBull(draft.closestToBull);
      }
    } catch {
      // ignore
    }
  })();

  return () => {
    alive = false;
  };
}, []);

useEffect(() => {
  (async () => {
    try {
      await AsyncStorage.setItem(
        CRICKET_SETUP_DRAFT_KEY,
        JSON.stringify({ players, closestToBull })
      );
    } catch {
      // ignore
    }
  })();
}, [players, closestToBull]);


  // -------------------
  // Targets + mode
  // -------------------
  const [targetsPreset, setTargetsPreset] = useState<CricketTargetsPreset>("17-20+T+B");

  const [customSel, setCustomSel] = useState({
    n12: false,
    n13: false,
    n14: false,
    n15: true,
    n16: true,
    n17: true,
    n18: true,
    n19: true,
    n20: true,
    d: false,
    t: true,
    bull: true,
  });

  const CRICKET_SETUP_DRAFT_KEY = "cricket:setupDraft:v1";

  // -------------------
  // Side games
  // -------------------
  const [sideEnabled, setSideEnabled] = useState(true);

  const [matchWinnerRewardsOn, setMatchWinnerRewardsOn] = useState(true);
  const [matchWinnerRewardValue, setMatchWinnerRewardValue] = useState(20);

  const [comboStrikeBonusOn, setComboStrikeBonusOn] = useState(true);
  const [comboStrikeBonusValue, setComboStrikeBonusValue] = useState(5);
  const [comboStrikeBonusThreshold, setComboStrikeBonusThreshold] = useState(5);

  const [comboStrikeJackpotOn, setComboStrikeJackpotOn] = useState(true);
  const [comboStrikeJackpotValue, setComboStrikeJackpotValue] = useState(10);
  const [comboStrikeJackpotThreshold, setComboStrikeJackpotThreshold] = useState(7);

  const [doubleBonusOn, setDoubleBonusOn] = useState(true);
  const [doubleBonusValue, setDoubleBonusValue] = useState(5);
  const [doubleBonusThreshold, setDoubleBonusThreshold] = useState(3);

  const [trebleBonusOn, setTrebleBonusOn] = useState(true);
  const [trebleBonusValue, setTrebleBonusValue] = useState(5);
  const [trebleBonusThreshold, setTrebleBonusThreshold] = useState(3);

  const [bullBonusOn, setBullBonusOn] = useState(true);
  const [bullBonusValue, setBullBonusValue] = useState(5);
  const [bullBonusThreshold, setBullBonusThreshold] = useState(3);

  const [bullJackpotOn, setBullJackpotOn] = useState(true);
  const [bullJackpotValue, setBullJackpotValue] = useState(10);
  const [bullJackpotThreshold, setBullJackpotThreshold] = useState(5);

  function customTargets(): CricketTarget[] {
    const out: CricketTarget[] = [];
    const pushNum = (n: number, on: boolean) => {
      if (on) out.push(n);
    };
    pushNum(12, customSel.n12);
    pushNum(13, customSel.n13);
    pushNum(14, customSel.n14);
    pushNum(15, customSel.n15);
    pushNum(16, customSel.n16);
    pushNum(17, customSel.n17);
    pushNum(18, customSel.n18);
    pushNum(19, customSel.n19);
    pushNum(20, customSel.n20);
    if (customSel.d) out.push("D");
    if (customSel.t) out.push("T");
    if (customSel.bull) out.push("BULL");
    return out;
  }

  const resolvedTargets = useMemo(() => {
    return targetsPreset === "CUSTOM" ? customTargets() : cricketTargetsFromPreset(targetsPreset);
  }, [targetsPreset, customSel]);

  function onStart() {
    const cleaned = players.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length < 1) {
      Alert.alert("Players", "Please add at least 1 player.");
      return;
    }
    if (!resolvedTargets.length) {
      Alert.alert("Targets", "Please select at least one target.");
      return;
    }

    navigation.navigate("CricketGame", {
      setup: {
        players: cleaned,
        closestToBull,
        targets: resolvedTargets,
        mode,
        autoConcede,
        sideGames: {
          enabled: sideEnabled,

          matchWinnerRewardsOn,
          matchWinnerRewardValue,

          comboStrikeBonusOn,
          comboStrikeBonus: { value: comboStrikeBonusValue, threshold: comboStrikeBonusThreshold },

          comboStrikeJackpotOn,
          comboStrikeJackpot: { value: comboStrikeJackpotValue, threshold: comboStrikeJackpotThreshold },

          doubleBonusOn,
          doubleBonus: { value: doubleBonusValue, threshold: doubleBonusThreshold },

          trebleBonusOn,
          trebleBonus: { value: trebleBonusValue, threshold: trebleBonusThreshold },

          bullBonusOn,
          bullBonus: { value: bullBonusValue, threshold: bullBonusThreshold },

          bullJackpotOn,
          bullJackpot: { value: bullJackpotValue, threshold: bullJackpotThreshold },
        },
      },
    });
  }

  // Fix header back: after Game → Results → back → Setup, native stack back can be stale.
  // Override to always navigate to Lobby so the back button works.
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

  return (
    <ScrollView contentContainerStyle={[styles.container, isLarge && stylesL.container]}>
      <Text style={[styles.title, isLarge && stylesL.title]}>Cricket Setup</Text>
      <Text style={[styles.sub, isLarge && stylesL.sub]}>Test app • 1–6 players • no teams</Text>

      {/* Players */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Players</Text>

        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          {/* LEFT = All Players */}
          <View style={{ flex: 1 }}>
            <Text style={styles.sub}>All Players</Text>

            <ScrollView style={styles.playerBox}>
              {allPlayers.map((name, idx) => {
                const trimmed = name.trim();
                const inGame = players.includes(trimmed);

                return (
                  <View key={idx} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
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
                      <Pressable onPress={() => {
                        if (trimmed) addToGame(trimmed);
                      }} style={pillBtn("#DCFCE7", "#86EFAC")}>
                        <Text style={pillBtnText("#166534")}>Add</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => removeFromGame(trimmed)} style={pillBtn("#E5E7EB", "#D1D5DB")}>
                        <Text style={pillBtnText("#111827")}>Remove</Text>
                      </Pressable>
                    )}

                    <Pressable onPress={() => removeFromMaster(name)} style={pillBtn("#FEE2E2", "#FCA5A5")}>
                      <Text style={pillBtnText("#991B1B")}>Delete</Text>
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
                <Text style={[styles.smallButtonText, isLarge && stylesL.smallButtonText]}>+ Add to All</Text>
              </Pressable>
            </View>
          </View>

          {/* RIGHT = In Game */}
          <View style={{ flex: 1 }}>
            <Text style={[styles.sub, { marginBottom: 4 }]}>In Game (Play Order)</Text>
            <ScrollView style={styles.playerBox}>
              {players.map((name, idx) => (
                <Pressable
                  key={name}
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
            <Text style={[styles.hint, { marginTop: 8 }]}>Tap a player to remove from game.</Text>
          </View>
        </View>

        <Text style={[styles.hint, { marginTop: 10 }]}>
          Tip: Add from All Players (left). Remove from game by tapping on the right list.
        </Text>

        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>
            Closest to Bull for throw order
          </Text>
          <Switch value={closestToBull} onValueChange={setClosestToBull} />
        </View>
      </View>

      {/* Targets */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Targets</Text>

        <Segmented
          label="Preset"
          value={targetsPreset}
          onChange={setTargetsPreset}
          isLarge={isLarge}
          options={[
            { label: "20–17 + T + B", value: "17-20+T+B" },
            { label: "20–17 + D + T + B", value: "17-20+D+T+B" },
            { label: "Custom", value: "CUSTOM" },
          ]}
        />

        {targetsPreset === "CUSTOM" && (
          <>
            <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 10 }]}>
              Select targets (12–20, D, T, Bull)
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {([12, 13, 14, 15, 16, 17, 18, 19, 20] as const).map((n) => {
                const key = `n${n}` as const;
                const on = (customSel as any)[key] as boolean;
                return (
                  <Pressable
                    key={n}
                    style={[styles.pill, isLarge && stylesL.pill, on && styles.pillActive]}
                    onPress={() => setCustomSel((s) => ({ ...s, [key]: !on }))}
                  >
                    <Text style={[styles.pillText, isLarge && stylesL.pillText, on && styles.pillTextActive]}>
                      {n}
                    </Text>
                  </Pressable>
                );
              })}

              {(["D", "T"] as const).map((k) => {
                const key = k === "D" ? "d" : "t";
                const on = (customSel as any)[key] as boolean;
                return (
                  <Pressable
                    key={k}
                    style={[styles.pill, isLarge && stylesL.pill, on && styles.pillActive]}
                    onPress={() => setCustomSel((s) => ({ ...s, [key]: !on }))}
                  >
                    <Text style={[styles.pillText, isLarge && stylesL.pillText, on && styles.pillTextActive]}>
                      {k}
                    </Text>
                  </Pressable>
                );
              })}

              <Pressable
                style={[styles.pill, isLarge && stylesL.pill, customSel.bull && styles.pillActive]}
                onPress={() => setCustomSel((s) => ({ ...s, bull: !s.bull }))}
              >
                <Text style={[styles.pillText, isLarge && stylesL.pillText, customSel.bull && styles.pillTextActive]}>
                  Bull
                </Text>
              </Pressable>
            </View>
          </>
        )}

        <Text style={[styles.hint, isLarge && stylesL.hint]}>Selected: {resolvedTargets.map(String).join(", ")}</Text>
      </View>

      {/* Mode */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Mode</Text>

        <Segmented
          label="Classic / Cutthroat"
          value={mode}
          onChange={setMode}
          isLarge={isLarge}
          options={[
            { label: "Classic", value: "CLASSIC" },
            { label: "Cutthroat", value: "CUTTHROAT" },
          ]}
        />

        {mode === "CUTTHROAT" && (
  <View style={[styles.row, { marginTop: 12, opacity: mode === "CUTTHROAT" ? 1 : 0.5 }]}>
  <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Auto Concede</Text>
  <Switch
    value={autoConcede}
    onValueChange={setAutoConcede}
    disabled={mode !== "CUTTHROAT"}
  />
</View>
)}

      </View>

      {/* Side games */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle, { marginTop: 0 }]}>
            Side Games (Cricket)
          </Text>
          <Switch value={sideEnabled} onValueChange={setSideEnabled} />
        </View>

        <Text style={[styles.hint, isLarge && stylesL.hint]}>When OFF, no rewards are active (even if values are set).</Text>

        <RowToggle
          label="Match Winner Rewards"
          value={matchWinnerRewardsOn}
          onChange={setMatchWinnerRewardsOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />

        {/* Winner reward value */}
        <View style={{ marginTop: 6, opacity: !sideEnabled || !matchWinnerRewardsOn ? 0.5 : 1 }}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Winner Value</Text>
            <TextInput
              style={[styles.smallInput, isLarge && stylesL.smallInput]}
              keyboardType="numbers-and-punctuation"
              value={String(matchWinnerRewardValue)}
              editable={sideEnabled && matchWinnerRewardsOn}
              onChangeText={(t) => setMatchWinnerRewardValue(toNum(t, matchWinnerRewardValue))}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Combo Strike Bonus</Text>
        <RowToggle
          label="Enabled"
          value={comboStrikeBonusOn}
          onChange={setComboStrikeBonusOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />
        <RowValueThreshold
          value={comboStrikeBonusValue}
          threshold={comboStrikeBonusThreshold}
          setValue={(v) => setComboStrikeBonusValue(v)}
          setThreshold={(t) => setComboStrikeBonusThreshold(t)}
          disabled={!sideEnabled || !comboStrikeBonusOn}
          isLarge={isLarge}
        />

        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Combo Strike Jackpot</Text>
        <RowToggle
          label="Enabled"
          value={comboStrikeJackpotOn}
          onChange={setComboStrikeJackpotOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />
        <RowValueThreshold
          value={comboStrikeJackpotValue}
          threshold={comboStrikeJackpotThreshold}
          setValue={(v) => setComboStrikeJackpotValue(v)}
          setThreshold={(t) => setComboStrikeJackpotThreshold(t)}
          disabled={!sideEnabled || !comboStrikeJackpotOn}
          isLarge={isLarge}
        />

        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Double Bonus</Text>
        <RowToggle
          label="Enabled"
          value={doubleBonusOn}
          onChange={setDoubleBonusOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />
        <RowValueThreshold
          value={doubleBonusValue}
          threshold={doubleBonusThreshold}
          setValue={setDoubleBonusValue}
          setThreshold={setDoubleBonusThreshold}
          disabled={!sideEnabled || !doubleBonusOn}
          isLarge={isLarge}
        />

        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Treble Bonus</Text>
        <RowToggle
          label="Enabled"
          value={trebleBonusOn}
          onChange={setTrebleBonusOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />
        <RowValueThreshold
          value={trebleBonusValue}
          threshold={trebleBonusThreshold}
          setValue={setTrebleBonusValue}
          setThreshold={setTrebleBonusThreshold}
          disabled={!sideEnabled || !trebleBonusOn}
          isLarge={isLarge}
        />

        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Bull Bonus</Text>
        <RowToggle
          label="Enabled"
          value={bullBonusOn}
          onChange={setBullBonusOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />
        <RowValueThreshold
          value={bullBonusValue}
          threshold={bullBonusThreshold}
          setValue={setBullBonusValue}
          setThreshold={setBullBonusThreshold}
          disabled={!sideEnabled || !bullBonusOn}
          isLarge={isLarge}
        />

        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>Bull Jackpot</Text>
        <RowToggle
          label="Enabled"
          value={bullJackpotOn}
          onChange={setBullJackpotOn}
          disabled={!sideEnabled}
          isLarge={isLarge}
        />
        <RowValueThreshold
          value={bullJackpotValue}
          threshold={bullJackpotThreshold}
          setValue={setBullJackpotValue}
          setThreshold={setBullJackpotThreshold}
          disabled={!sideEnabled || !bullJackpotOn}
          isLarge={isLarge}
        />
      </View>

      <Pressable style={[styles.primary, isLarge && stylesL.primary]} onPress={onStart}>
        <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Start Cricket</Text>
      </Pressable>
    </ScrollView>
  );
}

function RowToggle(props: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  isLarge?: boolean;
}) {
  const isLarge = !!props.isLarge;
  return (
    <View style={[styles.row, { marginTop: 8, opacity: props.disabled ? 0.5 : 1 }]}>
      <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>{props.label}</Text>
      <Switch value={props.value} onValueChange={props.onChange} disabled={props.disabled} />
    </View>
  );
}

function RowValueThreshold(props: {
  value: number;
  threshold: number;
  setValue: (v: number) => void;
  setThreshold: (v: number) => void;
  disabled?: boolean;
  isLarge?: boolean;
}) {
  const isLarge = !!props.isLarge;
  return (
    <View style={{ gap: 8, marginTop: 6, opacity: props.disabled ? 0.5 : 1 }}>
      <View style={styles.row}>
        <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Value</Text>
        <TextInput
          style={[styles.smallInput, isLarge && stylesL.smallInput]}
          keyboardType="numbers-and-punctuation"
          value={String(props.value)}
          editable={!props.disabled}
          onChangeText={(t) => props.setValue(toNum(t, props.value))}
        />
      </View>

      <View style={styles.row}>
        <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel]}>Threshold (≥)</Text>
        <TextInput
          style={[styles.smallInput, isLarge && stylesL.smallInput]}
          keyboardType="number-pad"
          value={String(props.threshold)}
          editable={!props.disabled}
          onChangeText={(t) => props.setThreshold(Math.max(1, Math.floor(toNum(t, props.threshold))))}
        />
      </View>
    </View>
  );
}

function pillBtn(bg: string, border: string) {
  return {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: bg,
    borderWidth: 1,
    borderColor: border,
  } as const;
}
function pillBtnText(color: string) {
  return {
    color,
    fontWeight: "900",
    fontSize: 12,
  } as const;
}

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

  row: { flexDirection: "row", alignItems: "center", gap: 10 },
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

  primary: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },

  // players UI
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
  playerName: { fontSize: 14, fontWeight: "700" },

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
});

const stylesL = StyleSheet.create({
  container: { padding: 22, gap: 14 },
  title: { fontSize: 30 },
  sub: { fontSize: 15, marginTop: -4 },

  card: { padding: 18, borderRadius: 16, gap: 12 },

  rowLabel: { fontSize: 18 },
  smallInput: { width: 140, paddingVertical: 12, fontSize: 18, borderRadius: 10 },

  hint: { fontSize: 14 },
  h: { fontSize: 14 },

  segmentBtn: { paddingVertical: 16, borderRadius: 14 },
  segmentText: { fontSize: 16 },

  pill: { paddingVertical: 14, paddingHorizontal: 18 },
  pillText: { fontSize: 16 },

  primary: { paddingVertical: 18, borderRadius: 14 },
  primaryText: { fontSize: 18 },

  sectionTitle: { fontSize: 22, fontWeight: "900", marginTop: 14 },

  playerBox: { maxHeight: 320, padding: 10 },
  playerName: { fontSize: 16 },

  smallButton: { paddingVertical: 14, borderRadius: 14 },
  smallButtonText: { fontSize: 16 },
});
