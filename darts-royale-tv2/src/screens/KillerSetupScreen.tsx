// src/screens/KillerSetupScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  loadKillerSetup,
  saveKillerSetup,
  type PersistedKillerSetup,
} from "../storage/setupStorage";
import { KILLER_NEON_COLORS, type ArmMode } from "../engine/killerTypes";
import { ensureDefaultPlacement } from "../engine/killerEngine";

type Props = NativeStackScreenProps<RootStackParamList, "KillerSetup">;

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toNum(text: string, fallback: number): number {
  const cleaned = text.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function placementSum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

type InGamePlayer = { name: string; playerColor: string };

export default function KillerSetupScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  const [allPlayers, setAllPlayers] = useState<string[]>(["Player 1", "Player 2"]);
  const [inGame, setInGame] = useState<InGamePlayer[]>([]);
  const [closestToBull, setClosestToBull] = useState(false);
  const [placementRewardsOn, setPlacementRewardsOn] = useState(false);
  const [placementRewardAmounts, setPlacementRewardAmounts] = useState<number[]>(
    ensureDefaultPlacement(2)
  );
  const [armPoints, setArmPoints] = useState(3);
  const [armPointsText, setArmPointsText] = useState("3");
  const [armMode, setArmMode] = useState<ArmMode>("points");
  const [lives, setLives] = useState(3);
  const [livesText, setLivesText] = useState("3");
  const [recharge, setRecharge] = useState(false);
  const [fullLivesToArm, setFullLivesToArm] = useState(false);
  const [shieldOn, setShieldOn] = useState(true);
  const [turnKillCapText, setTurnKillCapText] = useState("1");
  const [numberLayout, setNumberLayout] = useState<"shuffle" | "balanced">("shuffle");
  const [killRewardsOn, setKillRewardsOn] = useState(false);
  const [killRewardValue, setKillRewardValue] = useState(10);
  const [killRewardValueText, setKillRewardValueText] = useState("10");
  const [darkMode, setDarkMode] = useState(true);

  const masterInputRefs = useRef<(TextInput | null)[]>([]);

  const parsedArmPoints = useMemo(() => toNum(armPointsText, 3), [armPointsText]);
  const parsedLives = useMemo(() => toNum(livesText, 3), [livesText]);
  const parsedTurnKillCap = useMemo(() => toNum(turnKillCapText, 1), [turnKillCapText]);
  const parsedKillReward = useMemo(() => toNum(killRewardValueText, 10), [killRewardValueText]);

  // Shield ON: protection count 1..(N-2). Shield OFF: no protection (0). Hide numeric selector when N<=2.
  const protectionMax = Math.max(0, inGame.length - 2);
  const turnKillCap =
    shieldOn && protectionMax >= 1
      ? Math.min(Math.max(1, parsedTurnKillCap), protectionMax)
      : 0;
  const showShieldSection = inGame.length >= 3;
  const showProtectionSelector = showShieldSection && shieldOn && protectionMax >= 1;

  // Full Lives to Arm only applies when Recharge is ON; force OFF and disable when Recharge is OFF
  useEffect(() => {
    if (!recharge) setFullLivesToArm(false);
  }, [recharge]);

  // Keep Protection input in valid range when player count or stored value changes
  useEffect(() => {
    if (!showProtectionSelector) return;
    const parsed = parsedTurnKillCap;
    if (parsed < 1 || parsed > protectionMax) {
      const clamped = Math.min(Math.max(1, parsed), protectionMax);
      setTurnKillCapText(String(clamped));
    }
  }, [showProtectionSelector, protectionMax, parsedTurnKillCap]);

  function addToGame(name: string) {
    const n = name.trim();
    if (!n) return;
    if (inGame.some((p) => p.name === n)) return;
    if (inGame.length >= 8) {
      Alert.alert("Player limit", "You can only add up to 8 players.");
      return;
    }
    const colors = [...KILLER_NEON_COLORS];
    const usedColors = new Set(inGame.map((p) => p.playerColor));
    const nextColor = colors.find((c) => !usedColors.has(c)) ?? colors[inGame.length % colors.length];
    setInGame((prev) => [...prev, { name: n, playerColor: nextColor }]);
  }

  function removeFromGame(name: string) {
    setInGame((prev) => prev.filter((p) => p.name !== name));
  }

  function removeFromMaster(name: string) {
    const n = name.trim();
    setAllPlayers((p) => p.filter((x) => x.trim() !== n));
    setInGame((prev) => prev.filter((p) => p.name !== n));
  }

  function addToMaster() {
    setAllPlayers((p) => {
      const next = [...p, ""];
      requestAnimationFrame(() => {
        masterInputRefs.current[next.length - 1]?.focus();
      });
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      const stored = await loadPlayers();
      if (stored?.length) setAllPlayers(stored);
    })();
  }, []);

  useEffect(() => {
    savePlayers(allPlayers);
  }, [allPlayers]);

  useEffect(() => {
    (async () => {
      const stored = await loadKillerSetup();
      if (stored) {
        setClosestToBull(!!stored.closestToBull);
        setPlacementRewardsOn(!!stored.placementRewardsOn);
        if (Array.isArray(stored.placementRewardAmounts) && stored.placementRewardAmounts.length > 0) {
          setPlacementRewardAmounts(stored.placementRewardAmounts);
        }
        if (typeof (stored as any).armPoints === "number") {
          setArmPoints((stored as any).armPoints);
          setArmPointsText(String((stored as any).armPoints));
        } else if (typeof stored.checkInPoints === "number") {
          setArmPoints(stored.checkInPoints);
          setArmPointsText(String(stored.checkInPoints));
        }
        if (["points", "double", "treble"].includes((stored as any).armMode)) {
          setArmMode((stored as any).armMode);
        }
        if (typeof stored.lives === "number") {
          setLives(stored.lives);
          setLivesText(String(stored.lives));
        }
        if (typeof stored.recharge === "boolean") {
          setRecharge(stored.recharge);
        }
        const storedFullLives = (stored as any).fullLivesToArm ?? (stored as any).fullLivesToArm;
        if (typeof storedFullLives === "boolean") {
          setFullLivesToArm(storedFullLives);
        }
        if (typeof (stored as any).shieldOn === "boolean") {
          setShieldOn((stored as any).shieldOn);
        } else if (typeof stored.turnKillCap === "number" && stored.turnKillCap === 0) {
          setShieldOn(false);
        }
        if (typeof stored.turnKillCap === "number") {
          setTurnKillCapText(String(stored.turnKillCap));
        }
        if ((stored as any).numberLayout === "shuffle" || (stored as any).numberLayout === "balanced") {
          setNumberLayout((stored as any).numberLayout);
        }
        setKillRewardsOn(!!stored.killRewardsOn);
        if (typeof stored.killRewardValue === "number") {
          setKillRewardValue(stored.killRewardValue);
          setKillRewardValueText(String(stored.killRewardValue));
        }
        if (typeof stored.darkMode === "boolean") {
          setDarkMode(stored.darkMode);
        }
        if (Array.isArray(stored.inGamePlayers) && stored.inGamePlayers.length > 0) {
          const colors = [...KILLER_NEON_COLORS];
          const first = stored.inGamePlayers[0];
          if (typeof first === "object" && first !== null && "name" in first && "playerColor" in first) {
            setInGame(
              (stored.inGamePlayers as { name: string; playerColor: string }[]).map((p) => ({
                name: String(p.name),
                playerColor: String(p.playerColor),
              }))
            );
          } else {
            setInGame(
              (stored.inGamePlayers as string[]).map((name, i) => ({
                name: String(name),
                playerColor: colors[i % colors.length],
              }))
            );
          }
        }
      }
      hasLoadedKillerSetupRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (inGame.length > 0 && placementRewardAmounts.length !== inGame.length) {
      setPlacementRewardAmounts(ensureDefaultPlacement(inGame.length));
    }
  }, [inGame.length]);

  const hasLoadedKillerSetupRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasLoadedKillerSetupRef.current) return;
    const payload: PersistedKillerSetup = {
      inGamePlayers: inGame.map((p) => ({ name: p.name, playerColor: p.playerColor })),
      closestToBull,
      placementRewardsOn,
      placementRewardAmounts,
      armPoints: Number.isFinite(parsedArmPoints) ? parsedArmPoints : 3,
      armMode,
      lives: Number.isFinite(parsedLives) ? parsedLives : 3,
      recharge,
      fullLivesToArm,
      shieldOn,
      turnKillCap,
      killRewardsOn,
      killRewardValue: Number.isFinite(parsedKillReward) ? parsedKillReward : 10,
      darkMode,
      numberLayout,
    };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveKillerSetup(payload);
      saveTimerRef.current = null;
    }, 300);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    inGame,
    closestToBull,
    placementRewardsOn,
    placementRewardAmounts,
    parsedArmPoints,
    parsedLives,
    recharge,
    fullLivesToArm,
    shieldOn,
    turnKillCap,
    killRewardsOn,
    parsedKillReward,
    darkMode,
    armMode,
    numberLayout,
  ]);

  // Dark mode applies only to game screen; setup UI stays light
  const theme: Record<string, object> = {};

  const onStart = useCallback(() => {
    if (inGame.length < 2) {
      Alert.alert("Players", "Add at least 2 players.");
      return;
    }

    const armPts = Math.max(1, Number.isFinite(parsedArmPoints) ? parsedArmPoints : 3);
    const livesVal = Math.max(1, Number.isFinite(parsedLives) ? parsedLives : 3);
    const cap =
      shieldOn && protectionMax >= 1
        ? Math.min(Math.max(1, turnKillCap), protectionMax)
        : 0;
    const placement =
      placementRewardAmounts.length === inGame.length
        ? placementRewardAmounts
        : ensureDefaultPlacement(inGame.length);

    if (placementRewardsOn && placementSum(placement) !== 0) {
      Alert.alert(
        "Rewards must balance",
        `Placement rewards must sum to 0. Current sum: ${placementSum(placement)}`
      );
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const payload: PersistedKillerSetup = {
      inGamePlayers: inGame.map((p) => ({ name: p.name, playerColor: p.playerColor })),
      closestToBull,
      placementRewardsOn,
      placementRewardAmounts: placement,
      armPoints: armPts,
      armMode,
      lives: livesVal,
      recharge,
      fullLivesToArm,
      shieldOn,
      turnKillCap: cap,
      killRewardsOn,
      killRewardValue: Number.isFinite(parsedKillReward) ? parsedKillReward : 10,
      darkMode,
      numberLayout: numberLayout ?? "shuffle",
    };
    saveKillerSetup(payload);

    navigation.navigate("KillerGame", {
      setup: {
        players: inGame.map((p) => ({ name: p.name, playerColor: p.playerColor })),
        closestToBull,
        placementRewardsOn,
        placementRewardAmounts: placement,
        armPoints: armPts,
        armMode,
        lives: livesVal,
        recharge,
        fullLivesToArm,
        turnKillCap: cap,
        killRewardsOn,
        killRewardValue: Number.isFinite(parsedKillReward) ? parsedKillReward : 10,
        darkMode,
        numberLayout: numberLayout ?? "shuffle",
      },
      gameKey: Date.now(),
    });
  }, [
    inGame,
    closestToBull,
    placementRewardsOn,
    placementRewardAmounts,
    parsedArmPoints,
    parsedLives,
    recharge,
    fullLivesToArm,
    shieldOn,
    turnKillCap,
    killRewardsOn,
    parsedKillReward,
    darkMode,
    armMode,
    numberLayout,
    navigation,
  ]);

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

  return (
    <ScrollView contentContainerStyle={[styles.container, isLarge && stylesL.container, theme.container]}>
      <Text style={[styles.title, isLarge && stylesL.title, theme.title]}>Killer Setup</Text>
      <Text style={[styles.desc, isLarge && stylesL.desc, theme.sub]}>
        2–8 players • Arm your number, then attack others
      </Text>

      {/* Dark mode — affects game screen only */}
      <View style={[styles.card, isLarge && stylesL.card, theme.card]}>
        <View style={[styles.row, { justifyContent: "space-between", alignItems: "center" }]}>
          <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle, theme.sectionTitle, { marginBottom: 0 }]}>
            Display
          </Text>
          <Switch value={darkMode} onValueChange={setDarkMode} />
        </View>
        <Text style={[styles.desc, theme.sub]}>
          Dark mode (game screen only)
        </Text>
      </View>

      {/* A) PLAYERS */}
      <View style={[styles.card, isLarge && stylesL.card, theme.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle, theme.sectionTitle]}>Players</Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sub, theme.sub]}>All Players</Text>
            <ScrollView style={[styles.playerBox, theme.playerBox]}>
              {allPlayers.map((name, idx) => {
                const trimmed = name.trim();
                const inGameNames = inGame.map((p) => p.name);
                const inGameFlag = inGameNames.includes(name) || inGameNames.includes(trimmed);
                return (
                  <View key={idx} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <View style={[styles.playerRow, { flex: 1 }, theme.playerRow]}>
                      <TextInput
                        ref={(el) => {
                          masterInputRefs.current[idx] = el;
                        }}
                        value={name}
                        placeholder={`Player ${idx + 1}`}
                        placeholderTextColor={undefined}
                        onChangeText={(t) => {
                          const copy = [...allPlayers];
                          copy[idx] = t;
                          setAllPlayers(copy);
                        }}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          if (trimmed && !inGameFlag) addToGame(trimmed);
                        }}
                        style={[styles.playerName, theme.playerName]}
                      />
                    </View>
                    {!inGameFlag ? (
                      <Pressable
                        onPress={() => trimmed && addToGame(trimmed)}
                        style={styles.addBtn}
                      >
                        <Text style={styles.addBtnText}>Add</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => removeFromGame(trimmed)} style={styles.removeBtn}>
                        <Text style={styles.removeBtnText}>Remove</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => removeFromMaster(name)} style={styles.deleteBtn}>
                      <Text style={styles.deleteBtnText}>Delete</Text>
                    </Pressable>
                  </View>
                );
              })}
              {!allPlayers.length && <Text style={[styles.hint, theme.hint]}>— No players yet —</Text>}
            </ScrollView>
            <Pressable
              style={[styles.smallButton, !(allPlayers.length < 50) && styles.disabled]}
              disabled={!(allPlayers.length < 50)}
              onPress={addToMaster}
            >
              <Text style={styles.smallButtonText}>+ Add to All</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sub, theme.sub, { marginBottom: 4 }]}>In Game (Play Order)</Text>
            <ScrollView style={[styles.playerBox, theme.playerBox]}>
              {inGame.map((p, idx) => (
                <Pressable
                  key={`${p.name}-${idx}`}
                  style={[styles.playerRow, theme.playerRow]}
                  onPress={() => removeFromGame(p.name)}
                >
                  <Text style={[styles.playerName, theme.playerName]} numberOfLines={1}>
                    {idx + 1}. {p.name}
                  </Text>
                </Pressable>
              ))}
              {!inGame.length && <Text style={[styles.hint, theme.hint]}>Tap left to add players</Text>}
            </ScrollView>
            {!closestToBull && inGame.length > 1 && (
              <Pressable
                style={[styles.smallButton, styles.shuffleButton]}
                onPress={() => setInGame(shuffleArray([...inGame]))}
              >
                <Text style={styles.smallButtonText}>Shuffle Players</Text>
              </Pressable>
            )}
            <Text style={[styles.hint, theme.hint, { marginTop: 8 }]}>
              Tap a player to remove from game.
            </Text>
            <Text style={[styles.hint, theme.hint, { marginTop: 6 }]}>
              Numbers 1–20 are assigned randomly when you start the game.
            </Text>
          </View>
        </View>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel]}>
            Closest to Bull for throw order
          </Text>
          <Switch value={closestToBull} onValueChange={setClosestToBull} />
        </View>
      </View>

      {/* C) PLACEMENT REWARDS */}
      <View style={[styles.card, isLarge && stylesL.card, theme.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle, theme.sectionTitle]}>
          Placement Rewards
        </Text>
        <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint]}>
          Same as Golf. Last alive = 1st, then by elimination order.
        </Text>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel]}>Enable</Text>
          <Switch value={placementRewardsOn} onValueChange={setPlacementRewardsOn} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10, opacity: placementRewardsOn ? 1 : 0.5 }}>
          {(placementRewardAmounts.length ? placementRewardAmounts : ensureDefaultPlacement(inGame.length || 2)).map((v, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.pill, isLarge && stylesL.pill]}>
                <Text style={[styles.pillText, isLarge && stylesL.pillText]}>
                  {i + 1}
                  {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}
                </Text>
              </View>
              <TextInput
                style={[styles.smallInput, isLarge && stylesL.smallInput, theme.smallInput]}
                keyboardType="numbers-and-punctuation"
                value={String(v)}
                editable={placementRewardsOn}
                onChangeText={(t) => {
                  const base = placementRewardAmounts.length ? placementRewardAmounts : ensureDefaultPlacement(inGame.length || 2);
                  const next = [...base];
                  next[i] = toNum(t, 0);
                  setPlacementRewardAmounts(next);
                }}
              />
            </View>
          ))}
        </View>
        <Text style={[styles.hint, { marginTop: 10 }, theme.hint]}>Sum: {placementSum(placementRewardAmounts.length ? placementRewardAmounts : ensureDefaultPlacement(inGame.length || 2))}</Text>
      </View>

      {/* D) KILLER SETTINGS */}
      <View style={[styles.card, isLarge && stylesL.card, theme.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle, theme.sectionTitle]}>Killer Settings</Text>
        <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel, theme.rowLabel, { marginBottom: 4 }]}>Arm mode</Text>
        <View style={styles.armModeRow}>
          {(["points", "double", "treble"] as const).map((mode) => (
            <Pressable
              key={mode}
              style={[
                styles.armModePill,
                armMode === mode && styles.armModePillActive,
              ]}
              onPress={() => setArmMode(mode)}
            >
              <Text
                style={[
                  styles.armModePillText,
                  armMode === mode && styles.armModePillTextActive,
                ]}
              >
                {mode === "points" ? "Points" : mode === "double" ? "Double" : "Treble"}
              </Text>
            </Pressable>
          ))}
        </View>
        {armMode === "points" && (
          <View style={[styles.row, { marginTop: 8 }]}>
            <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel, theme.rowLabel]}>Arm (Points)</Text>
            <TextInput
              style={[styles.smallInput, isLarge && stylesL.smallInput, theme.smallInput]}
              keyboardType="number-pad"
              value={armPointsText}
              onChangeText={(t) => {
                setArmPointsText(t);
                const n = toNum(t, 3);
                if (Number.isFinite(n)) setArmPoints(n);
              }}
            />
          </View>
        )}
        <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint]}>
          {armMode === "points"
            ? "Single=1, Double=2, Treble=3 per hit on your number."
            : armMode === "double"
            ? "Hit a DOUBLE of your number to Arm."
            : "Hit a TREBLE of your number to Arm."}
        </Text>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel, theme.rowLabel]}>Lives</Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput, theme.smallInput]}
            keyboardType="number-pad"
            value={livesText}
            onChangeText={(t) => {
              setLivesText(t);
              const n = toNum(t, 3);
              if (Number.isFinite(n)) setLives(n);
            }}
          />
        </View>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel]}>Recharge</Text>
          <Switch value={recharge} onValueChange={setRecharge} />
        </View>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel, !recharge && { opacity: 0.5 }]}>Full Lives to Arm</Text>
          <Switch value={fullLivesToArm} onValueChange={setFullLivesToArm} disabled={!recharge} />
        </View>
        <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint]}>Hit your own number to regain hearts (Single +1, Double +2, Treble +3), capped at Lives.</Text>
        <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint, { marginTop: 4 }, !recharge && { opacity: 0.5 }]}>When ON, you must have full lives to arm or rearm; regaining lives to max (recharge) makes you eligible to arm again.</Text>
        {showShieldSection && (
          <>
            <View style={[styles.row, { marginTop: 8 }]}>
              <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel]}>Shield</Text>
              <Switch value={shieldOn} onValueChange={setShieldOn} />
            </View>
            {showProtectionSelector && (
              <>
                <View style={styles.row}>
                  <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel, theme.rowLabel]}>Protected per turn</Text>
                  <TextInput
                    style={[styles.smallInput, isLarge && stylesL.smallInput, theme.smallInput]}
                    keyboardType="number-pad"
                    value={turnKillCapText}
                    onChangeText={setTurnKillCapText}
                  />
                </View>
                <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint]}>
                  Number of opponents protected per turn (1–{protectionMax}). When 2 players left, no protection.
                </Text>
              </>
            )}
          </>
        )}
        <View style={[styles.row, { marginTop: 12 }]}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel]}>Number Layout</Text>
        </View>
        <View style={styles.row}>
          <Pressable
            style={[
              styles.armModePill,
              isLarge && stylesL.armModePill,
              numberLayout === "shuffle" && styles.armModePillActive,
            ]}
            onPress={() => setNumberLayout("shuffle")}
          >
            <Text style={[styles.armModePillText, numberLayout === "shuffle" && styles.armModePillTextActive]}>Shuffle</Text>
          </Pressable>
          <Pressable
            style={[
              styles.armModePill,
              isLarge && stylesL.armModePill,
              numberLayout === "balanced" && styles.armModePillActive,
            ]}
            onPress={() => setNumberLayout("balanced")}
          >
            <Text style={[styles.armModePillText, numberLayout === "balanced" && styles.armModePillTextActive]}>Balanced</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint]}>
          Shuffle: random assignment. Balanced: numbers spaced evenly around the board.
        </Text>
      </View>

      {/* E) KILL REWARDS */}
      <View style={[styles.card, isLarge && stylesL.card, theme.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle, theme.sectionTitle]}>Kill Rewards</Text>
        <Text style={[styles.hint, isLarge && stylesL.hint, theme.hint]}>
          On elimination: killer +X, killed −X (zero-sum).
        </Text>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.toggleLabel, isLarge && stylesL.toggleLabel, theme.toggleLabel]}>Enable</Text>
          <Switch value={killRewardsOn} onValueChange={setKillRewardsOn} />
        </View>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, isLarge && stylesL.rowLabel, theme.rowLabel]}>Kill reward (X)</Text>
          <TextInput
            style={[styles.smallInput, isLarge && stylesL.smallInput, theme.smallInput]}
            keyboardType="numbers-and-punctuation"
            value={killRewardValueText}
            editable={killRewardsOn}
            onChangeText={(t) => {
              setKillRewardValueText(t);
              const n = toNum(t, 10);
              if (Number.isFinite(n)) setKillRewardValue(n);
            }}
          />
        </View>
      </View>

      <Pressable style={[styles.primary, isLarge && stylesL.primary, theme.primary]} onPress={onStart}>
        <Text style={[styles.primaryText, isLarge && stylesL.primaryText]}>Start Killer</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "900" },
  sub: { fontSize: 12, opacity: 0.65, marginTop: -6 },
  desc: { fontSize: 14, opacity: 0.85, marginTop: 4, fontWeight: "400" },
  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { flex: 1, fontSize: 16 },
  armModeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  armModePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#E5E7EB",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  armModePillActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  armModePillText: { fontSize: 14, fontWeight: "700", color: "#374151" },
  armModePillTextActive: { color: "#FFFFFF" },
  toggleLabel: { flex: 1, fontSize: 16, fontWeight: "900" },
  hint: { marginTop: 2, opacity: 0.7, fontSize: 12 },
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  playerName: { fontSize: 14, fontWeight: "700", flex: 1 },
  numberPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    minWidth: 28,
    alignItems: "center",
  },
  numberPillText: { color: "white", fontWeight: "900", fontSize: 14 },
  colorSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  addBtnText: { color: "#166534", fontWeight: "900", fontSize: 12 },
  removeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  removeBtnText: { color: "#111827", fontWeight: "900", fontSize: 12 },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  deleteBtnText: { color: "#991B1B", fontWeight: "900", fontSize: 12 },
  smallButton: {
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    marginTop: 10,
  },
  shuffleButton: {
    height: 44,
    justifyContent: "center",
    marginTop: 8,
  },
  smallButtonText: { color: "white", fontWeight: "800" },
  randBtn: {
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    borderWidth: 1,
    borderColor: "#93C5FD",
    alignItems: "center",
    marginTop: 8,
  },
  randBtnText: { color: "#1E40AF", fontWeight: "800", fontSize: 14 },
  disabled: { opacity: 0.4 },
  smallInput: {
    width: 80,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: "right",
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillText: { fontWeight: "900" },
  primary: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },
});

const stylesL = StyleSheet.create({
  container: { padding: 22, gap: 14 },
  title: { fontSize: 30 },
  sub: { fontSize: 15, marginTop: -4 },
  desc: { fontSize: 16 },
  card: { padding: 18, borderRadius: 16, gap: 12 },
  sectionTitle: { fontSize: 22, fontWeight: "900", marginTop: 14 },
  rowLabel: { fontSize: 18 },
  toggleLabel: { fontSize: 18 },
  hint: { fontSize: 14 },
  armModePill: {},
  armModePillActive: {},
  armModePillText: {},
  armModePillTextActive: {},
  playerBox: { maxHeight: 320, padding: 10 },
  playerName: { fontSize: 16 },
  smallInput: { width: 100, paddingVertical: 12, fontSize: 18, borderRadius: 10 },
  pill: { paddingVertical: 14, paddingHorizontal: 18 },
  pillText: { fontSize: 16 },
  primary: { paddingVertical: 18, borderRadius: 14 },
  primaryText: { fontSize: 18 },
});
