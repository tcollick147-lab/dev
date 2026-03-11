// src/screens/GolfHandicapDetailScreen.tsx

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  Alert,
  TextInput,
  Share,
  Platform,
  AppState,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { RootStackParamList } from "../types/navigation";
import { loadGolfSetup, saveGolfSetup } from "../storage/setupStorage";
import {
  readSharedHandicapFile,
  createBackupExport,
  sharedPlayersToOverrides,
  sharedPlayersToScoresByPlayer,
  prepareExportToTempFile,
  getSelectedHandicapFileUri,
  setSelectedHandicapFileUri,
  exportToCloudFile,
  setLastLocalHandicapUpdated,
  scheduleHandicapCloudSync,
  loadCloudHandicapsIfNewer,
} from "../storage/handicapSyncStorage";
import {
  computeGolfStartingHandicaps,
  computeRelativeStartingHandicaps,
  getGolfHandicapHistoryRows,
  normalizeGolfHandicapSettings,
  type GolfHandicapSettings,
  type GolfHandicapHistoryRow,
  type GolfHistoryRowState,
} from "../utils/golfHandicap";

type Props = NativeStackScreenProps<RootStackParamList, "GolfHandicapDetail">;

const COUNTED_BG = "#DCFCE7";
const COUNTED_TEXT = "#166534";
const IN_WINDOW_BG = "#E0E7FF";
const IN_WINDOW_TEXT = "#3730A3";
const OUTSIDE_BG = "transparent";
const OUTSIDE_TEXT = "#6B7280";

export default function GolfHandicapDetailScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");
  const isLarge = Math.min(width, height) >= 900;

  const [players, setPlayers] = useState<string[]>([]);
  const [settings, setSettings] = useState<GolfHandicapSettings | null>(null);
  const [scoresByPlayer, setScoresByPlayer] = useState<Record<string, number[]>>({});
  const [personalBestByPlayer, setPersonalBestByPlayer] = useState<Record<string, number>>({});
  const [handicapOverrides, setHandicapOverrides] = useState<Record<string, number>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualHandicapDraft, setManualHandicapDraft] = useState("");
  // Shared handicap file (iCloud) export/import
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [cloudFileUri, setCloudFileUri] = useState<string | null>(null);

  const refreshFromStorage = useCallback(async () => {
    const stored = await loadGolfSetup();
    if (!stored) return;
    const list = Array.isArray(stored.inGamePlayers)
      ? stored.inGamePlayers.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    setPlayers(list);
    if (list.length) setSelectedPlayer((prev) => (prev && list.includes(prev) ? prev : list[0]));
    if (stored.golfHandicap) {
      setSettings(normalizeGolfHandicapSettings(stored.golfHandicap.settings));
      setScoresByPlayer(
        stored.golfHandicap.scoresByPlayer && typeof stored.golfHandicap.scoresByPlayer === "object"
          ? stored.golfHandicap.scoresByPlayer
          : {}
      );
      setPersonalBestByPlayer(
        stored.golfHandicap.personalBestByPlayer && typeof stored.golfHandicap.personalBestByPlayer === "object"
          ? stored.golfHandicap.personalBestByPlayer
          : {}
      );
      setHandicapOverrides(
        stored.golfHandicap.handicapOverrides && typeof stored.golfHandicap.handicapOverrides === "object"
          ? stored.golfHandicap.handicapOverrides
          : {}
      );
    } else {
      setSettings(normalizeGolfHandicapSettings(null));
      setScoresByPlayer({});
      setPersonalBestByPlayer({});
      setHandicapOverrides({});
    }
  }, []);

  useEffect(() => {
    (async () => {
      const uri = await getSelectedHandicapFileUri();
      setCloudFileUri(uri ?? null);
      const stored = await loadGolfSetup();
      setLoading(false);
      if (!stored) return;
      const list = Array.isArray(stored.inGamePlayers)
        ? stored.inGamePlayers.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [];
      setPlayers(list);
      if (list.length) setSelectedPlayer((prev) => (prev && list.includes(prev) ? prev : list[0]));
      if (stored.golfHandicap) {
        setSettings(normalizeGolfHandicapSettings(stored.golfHandicap.settings));
        setScoresByPlayer(
          stored.golfHandicap.scoresByPlayer && typeof stored.golfHandicap.scoresByPlayer === "object"
            ? stored.golfHandicap.scoresByPlayer
            : {}
        );
        setPersonalBestByPlayer(
          stored.golfHandicap.personalBestByPlayer && typeof stored.golfHandicap.personalBestByPlayer === "object"
            ? stored.golfHandicap.personalBestByPlayer
            : {}
        );
        setHandicapOverrides(
          stored.golfHandicap.handicapOverrides && typeof stored.golfHandicap.handicapOverrides === "object"
            ? stored.golfHandicap.handicapOverrides
            : {}
        );
      } else {
        setSettings(normalizeGolfHandicapSettings(null));
        setScoresByPlayer({});
        setPersonalBestByPlayer({});
        setHandicapOverrides({});
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCloudHandicapsIfNewer().then(({ applied, error }) => {
        if (applied) refreshFromStorage();
        if (error) setSyncError(error);
      });
    }, [refreshFromStorage])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        loadCloudHandicapsIfNewer().then(({ applied }) => {
          if (applied) refreshFromStorage();
        });
      }
    });
    return () => sub.remove();
  }, [refreshFromStorage]);

  const computation = useMemo(() => {
    if (!settings || !players.length) return null;
    return computeGolfStartingHandicaps(players, scoresByPlayer, settings);
  }, [players, scoresByPlayer, settings]);

  const detailResult = selectedPlayer && computation ? computation.byPlayer[selectedPlayer] : null;
  const effectiveHandicap = selectedPlayer
    ? (handicapOverrides[selectedPlayer] != null ? handicapOverrides[selectedPlayer] : detailResult?.startingHandicap ?? 0)
    : 0;
  const hasOverride = selectedPlayer && handicapOverrides[selectedPlayer] != null;

  /** Relative starting handicap (baseline = best player = 0); uses shared logic with GolfSetup. */
  const relativeStartingHandicaps = useMemo(() => {
    if (!computation) {
      const out: Record<string, number> = {};
      players.forEach((name) => (out[name] = 0));
      return out;
    }
    return computeRelativeStartingHandicaps(
      players,
      computation,
      handicapOverrides,
      !!settings?.applyHandicaps
    );
  }, [players, computation, settings?.applyHandicaps, handicapOverrides]);

  const displayStartingHandicap = selectedPlayer ? (relativeStartingHandicaps[selectedPlayer] ?? 0) : 0;

  useEffect(() => {
    if (selectedPlayer && handicapOverrides[selectedPlayer] != null) {
      setManualHandicapDraft(String(handicapOverrides[selectedPlayer]));
    } else {
      setManualHandicapDraft("");
    }
  }, [selectedPlayer, handicapOverrides]);

  const historyRows: GolfHandicapHistoryRow[] = useMemo(() => {
    if (!detailResult || !settings) return [];
    return getGolfHandicapHistoryRows(detailResult.scores, settings);
  }, [detailResult, settings]);

  const onSelectHandicapFile = useCallback(async () => {
    setSyncError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: false,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) return;
      await setSelectedHandicapFileUri(uri);
      setCloudFileUri(uri);
      Alert.alert("Cloud file", "Handicap file location set. Export will replace this file; auto-sync will use it.");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Could not set file");
      Alert.alert("Error", e instanceof Error ? e.message : "Could not select file.");
    }
  }, []);

  const onExportCurrentHandicaps = useCallback(async () => {
    setSyncError(null);
    setSyncLoading(true);
    try {
      const uri = await getSelectedHandicapFileUri();
      if (uri) {
        const result = await exportToCloudFile();
        if (result.success) {
          setCloudFileUri(uri);
          Alert.alert("Export", "Handicaps exported. Previous version replaced.");
        } else {
          setSyncError(result.error ?? "Export failed");
          Alert.alert("Export failed", result.error ?? "Could not write to cloud file.");
        }
        return;
      }
      const prepared = await prepareExportToTempFile();
      if (!prepared) {
        if (__DEV__) console.log("[HandicapSync] Export: prepareExportToTempFile failed");
        setSyncError("Could not create export file");
        return;
      }
      const { tempUri, data } = prepared;
      const stored = await loadGolfSetup();
      if (stored?.golfHandicap) await createBackupExport(stored.golfHandicap);

      const message = "Save to Files → iCloud Drive / DartsRoyale / handicaps.json";
      if (Platform.OS === "ios") {
        if (__DEV__) console.log("[HandicapSync] Export: opening Share/Save sheet", { tempUri });
        const result = await Share.share({
          url: tempUri,
          message,
          title: "Handicaps",
        });
        if (__DEV__) console.log("[HandicapSync] Export: Share result", result);
        if (result.action === Share.sharedAction) {
          Alert.alert("Export", "Save sheet opened. Choose “Save to Files” and pick iCloud Drive / DartsRoyale to save handicaps.json.");
        } else {
          Alert.alert("Export", "Save sheet was dismissed. Export file was created; open Share again to save to Files.");
        }
      } else {
        Alert.alert("Export", `Export file created (${data.players.length} players). On iOS use Share to save to Files.`);
      }
    } catch (e) {
      if (__DEV__) console.log("[HandicapSync] Export: failure", e);
      setSyncError(e instanceof Error ? e.message : "Export failed");
      Alert.alert("Export failed", e instanceof Error ? e.message : "Could not open save sheet.");
    } finally {
      setSyncLoading(false);
    }
  }, []);

  const onImportFromSharedFile = useCallback(async () => {
    setSyncError(null);
    setSyncLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        if (__DEV__) console.log("[HandicapSync] Import: user canceled picker");
        return;
      }
      const uri = result.assets[0]?.uri;
      if (!uri) {
        if (__DEV__) console.log("[HandicapSync] Import: no URI in result");
        return;
      }
      if (__DEV__) console.log("[HandicapSync] Import: source URI", uri);
      const data = await readSharedHandicapFile(uri);
      if (!data?.players?.length) {
        setSyncError("No players in selected file");
        if (__DEV__) console.log("[HandicapSync] Import: no valid players in file");
        return;
      }
      const overrides = sharedPlayersToOverrides(data.players);
      const importedScores = sharedPlayersToScoresByPlayer(data.players);
      const stored = await loadGolfSetup();
      if (!stored) {
        setSyncError("Could not load current setup");
        return;
      }
      const existingScores = stored.golfHandicap?.scoresByPlayer ?? {};
      const mergedScores: Record<string, number[]> = { ...existingScores };
      for (const [name, scores] of Object.entries(importedScores)) {
        if (scores.length > 0) mergedScores[name] = scores;
      }
      await saveGolfSetup({
        ...stored,
        golfHandicap: {
          ...stored.golfHandicap,
          handicapOverrides: overrides,
          scoresByPlayer: mergedScores,
        },
      });
      setLastLocalHandicapUpdated(new Date().toISOString());
      scheduleHandicapCloudSync();
      setHandicapOverrides(overrides);
      setScoresByPlayer(mergedScores);
      if (__DEV__) console.log("[HandicapSync] Import: success", { playersCount: data.players.length });
      Alert.alert("Import", `Imported ${data.players.length} player handicaps from the selected file.`);
    } catch (e) {
      if (__DEV__) console.log("[HandicapSync] Import: failure", e);
      setSyncError(e instanceof Error ? e.message : "Import failed");
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not read selected file.");
    } finally {
      setSyncLoading(false);
    }
  }, []);

  function rowStyle(state: GolfHistoryRowState) {
    switch (state) {
      case "COUNTED":
        return { backgroundColor: COUNTED_BG };
      case "IN_WINDOW":
        return { backgroundColor: IN_WINDOW_BG };
      default:
        return { backgroundColor: OUTSIDE_BG };
    }
  }

  function textStyle(state: GolfHistoryRowState) {
    switch (state) {
      case "COUNTED":
        return { color: COUNTED_TEXT, fontWeight: "900" as const };
      case "IN_WINDOW":
        return { color: IN_WINDOW_TEXT, fontWeight: "700" as const };
      default:
        return { color: OUTSIDE_TEXT, fontWeight: "600" as const };
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  const s = settings!;

  return (
    <ScrollView contentContainerStyle={[styles.container, isLarge && stylesL.container]}>
      <Text style={[styles.title, isLarge && stylesL.title]}>Handicap detail</Text>
      <Text style={[styles.sub, isLarge && stylesL.sub]}>
        Configuration and round history. Best player = 0.
      </Text>

      {/* Config summary */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Handicap configuration
        </Text>
        <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
          Rounds Displayed (N): {s.roundsDisplayedN}
        </Text>
        <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
          Rounds Window (Y): {s.roundsWindowY}
        </Text>
        <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
          Rounds Counted (X): {s.roundsCountedX}
        </Text>
        <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
          Minimum Rounds Required: {s.minRoundsRequired}
        </Text>
        <Text style={[styles.configRule, isLarge && stylesL.configRule]}>
          Baseline rule: Best player = 0
        </Text>
      </View>

      {/* Shared handicap file (iCloud) */}
      <View style={[styles.card, isLarge && stylesL.card]}>
        <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
          Shared handicap file (iCloud)
        </Text>
        <Text style={[styles.hint, isLarge && stylesL.hint]}>
          Use a shared file (e.g. iCloud Drive / DartsRoyale / handicaps.json) so multiple iPads use the same handicap history.
        </Text>
        <Text style={[styles.hint, isLarge && stylesL.hint, { marginTop: 4 }]}>
          Select the cloud file once; Export then replaces it. Auto-sync writes to it when handicaps change.
        </Text>
        {cloudFileUri ? (
          <Text style={[styles.muted, isLarge && stylesL.muted]} numberOfLines={2}>
            Cloud file set. Export replaces previous version.
          </Text>
        ) : null}
        {syncError ? (
          <Text style={[styles.muted, { color: "#B91C1C" }]}>{syncError}</Text>
        ) : null}
        <View style={styles.pillRow}>
          <Pressable
            style={[styles.setBtn, isLarge && stylesL.setBtn]}
            onPress={onSelectHandicapFile}
            disabled={syncLoading}
          >
            <Text style={[styles.setBtnText, isLarge && stylesL.setBtnText]}>Select Handicap File</Text>
          </Pressable>
          <Pressable
            style={[styles.setBtn, isLarge && stylesL.setBtn]}
            onPress={onExportCurrentHandicaps}
            disabled={syncLoading}
          >
            <Text style={[styles.setBtnText, isLarge && stylesL.setBtnText]}>Export Current Handicaps</Text>
          </Pressable>
          <Pressable
            style={[styles.setBtn, isLarge && stylesL.setBtn]}
            onPress={onImportFromSharedFile}
            disabled={syncLoading}
          >
            <Text style={[styles.setBtnText, isLarge && stylesL.setBtnText]}>Import From Shared File</Text>
          </Pressable>
        </View>
      </View>

      {/* Player picker */}
      {players.length > 0 && (
        <View style={[styles.card, isLarge && stylesL.card]}>
          <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
            Player
          </Text>
          <View style={styles.pillRow}>
            {players.map((name) => {
              const active = name === selectedPlayer;
              return (
                <Pressable
                  key={name}
                  style={[styles.pill, isLarge && stylesL.pill, active && styles.pillActive]}
                  onPress={() => setSelectedPlayer(name)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      isLarge && stylesL.pillText,
                      active && styles.pillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* Round history */}
      {selectedPlayer && (
        <View style={[styles.card, isLarge && stylesL.card]}>
          <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
            Round history — {selectedPlayer}
          </Text>
          <Text style={[styles.hint, isLarge && stylesL.hint]}>
            Most recent first. Green = counted (best X of Y). Blue = in window, not counted. Grey = outside window.
          </Text>
          {historyRows.length === 0 ? (
            <Text style={[styles.muted, isLarge && stylesL.muted]}>No rounds yet.</Text>
          ) : (
            <View style={styles.table}>
              {historyRows.map((row) => (
                <View
                  key={row.roundNumber}
                  style={[styles.row, rowStyle(row.state)]}
                >
                  <Text style={[styles.cellRound, textStyle(row.state)]}>
                    #{row.roundNumber}
                  </Text>
                  <Text style={[styles.cellScore, textStyle(row.state)]}>
                    {row.score}
                  </Text>
                  {row.state === "COUNTED" && (
                    <Text style={styles.badge}>✓ Counted</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Delete history & Edit handicap */}
      {selectedPlayer && (
        <View style={[styles.card, isLarge && stylesL.card]}>
          <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
            Actions — {selectedPlayer}
          </Text>

          <Pressable
            style={[styles.dangerBtn, isLarge && stylesL.dangerBtn]}
            onPress={() => {
              Alert.alert(
                "Delete history",
                `Delete all round history for ${selectedPlayer}? This cannot be undone.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      const stored = await loadGolfSetup();
                      if (!stored?.golfHandicap) return;
                      const nextScores = { ...(stored.golfHandicap.scoresByPlayer ?? {}) };
                      nextScores[selectedPlayer] = [];
                      await saveGolfSetup({
                        ...stored,
                        golfHandicap: { ...stored.golfHandicap, scoresByPlayer: nextScores },
                      });
                      setLastLocalHandicapUpdated(new Date().toISOString());
                      scheduleHandicapCloudSync();
                      setScoresByPlayer((prev) => ({ ...prev, [selectedPlayer]: [] }));
                    },
                  },
                ]
              );
            }}
          >
            <Text style={[styles.dangerBtnText, isLarge && stylesL.dangerBtnText]}>
              Delete history
            </Text>
          </Pressable>

          <Text style={[styles.h, isLarge && stylesL.h, { marginTop: 12 }]}>
            Edit handicap (manual override)
          </Text>
          <Text style={[styles.hint, isLarge && stylesL.hint]}>
            {hasOverride ? `Current: Manual (relative ${displayStartingHandicap})` : `Current: Computed ${detailResult?.startingHandicap ?? 0}`}
          </Text>
          <View style={styles.editRow}>
            <TextInput
              style={[styles.input, isLarge && stylesL.input]}
              placeholder="e.g. -5"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              value={manualHandicapDraft}
              onChangeText={setManualHandicapDraft}
            />
            <Pressable
              style={[styles.setBtn, isLarge && stylesL.setBtn]}
              onPress={async () => {
                const trimmed = manualHandicapDraft.trim();
                const n = trimmed === "" ? null : parseInt(trimmed, 10);
                if (n !== null && !Number.isFinite(n)) return;
                const stored = await loadGolfSetup();
                if (!stored) return;
                const overrides = { ...(stored.golfHandicap?.handicapOverrides ?? {}) };
                if (n !== null) overrides[selectedPlayer!] = n;
                else delete overrides[selectedPlayer!];
                await saveGolfSetup({
                  ...stored,
                  golfHandicap: { ...stored.golfHandicap, handicapOverrides: overrides },
                });
                setLastLocalHandicapUpdated(new Date().toISOString());
                scheduleHandicapCloudSync();
                setHandicapOverrides(overrides);
                if (n !== null) setManualHandicapDraft(String(n));
                else setManualHandicapDraft("");
              }}
            >
              <Text style={[styles.setBtnText, isLarge && stylesL.setBtnText]}>Set</Text>
            </Pressable>
            <Pressable
              style={[styles.clearBtn, isLarge && stylesL.clearBtn]}
              onPress={async () => {
                const stored = await loadGolfSetup();
                if (!stored?.golfHandicap) return;
                const overrides = { ...(stored.golfHandicap.handicapOverrides ?? {}) };
                delete overrides[selectedPlayer!];
                await saveGolfSetup({
                  ...stored,
                  golfHandicap: { ...stored.golfHandicap, handicapOverrides: overrides },
                });
                setLastLocalHandicapUpdated(new Date().toISOString());
                scheduleHandicapCloudSync();
                setHandicapOverrides((prev) => {
                  const next = { ...prev };
                  delete next[selectedPlayer!];
                  return next;
                });
                setManualHandicapDraft("");
              }}
            >
              <Text style={[styles.clearBtnText, isLarge && stylesL.clearBtnText]}>Clear</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Calculation transparency */}
      {detailResult && selectedPlayer && computation && (
        <View style={[styles.card, isLarge && stylesL.card]}>
          <Text style={[styles.sectionTitle, isLarge && stylesL.sectionTitle]}>
            Calculation — {selectedPlayer}
          </Text>
          <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
            Counted scores used: [{detailResult.countedScores.join(", ")}]
          </Text>
          <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
            Average (raw): {detailResult.averageRaw != null ? detailResult.averageRaw.toFixed(2) : "—"}
          </Text>
          <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
            Rounded average: {detailResult.roundedAverage ?? "—"}
          </Text>
          <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
            Baseline rounded average (group): {computation.baselineRoundedAvg ?? "—"}
          </Text>
          <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
            Starting handicap: {hasOverride ? `${displayStartingHandicap} (manual)` : displayStartingHandicap}
          </Text>
          <Text style={[styles.configRow, isLarge && stylesL.configRow]}>
            PB (Personal Best): {(() => {
              const stored = personalBestByPlayer[selectedPlayer];
              const fromScores = detailResult?.scores?.length ? Math.min(...detailResult.scores) : undefined;
              const pb = stored ?? fromScores;
              return pb != null ? pb : "—";
            })()}
          </Text>
          {hasOverride && (
            <Text style={[styles.hint, isLarge && stylesL.hint]}>
              Manual override is used instead of computed when Apply Handicaps is on.
            </Text>
          )}
          <Text style={[styles.configRule, isLarge && stylesL.configRule]}>
            Status: {detailResult.active ? "Active" : "Not enough rounds (needs " + s.minRoundsRequired + ")"}
          </Text>
        </View>
      )}

      <Pressable
        style={[styles.backBtn, isLarge && stylesL.backBtn]}
        onPress={() => navigation.goBack()}
      >
        <Text style={[styles.backBtnText, isLarge && stylesL.backBtnText]}>‹ Back to Golf Setup</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  loading: { fontSize: 16, color: "#6B7280" },
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "900" },
  sub: { fontSize: 12, opacity: 0.65, marginTop: -4 },
  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900" },
  configRow: { fontSize: 14 },
  configRule: { fontSize: 14, fontWeight: "700", marginTop: 4 },
  hint: { fontSize: 12, opacity: 0.8 },
  muted: { fontSize: 14, color: "#9CA3AF" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillActive: { backgroundColor: "#111827" },
  pillText: { fontWeight: "800", fontSize: 14 },
  pillTextActive: { color: "white" },
  table: { gap: 4, marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cellRound: { width: 56, fontSize: 14 },
  cellScore: { flex: 1, fontSize: 16 },
  badge: { fontSize: 12, fontWeight: "800", color: COUNTED_TEXT },
  dangerBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignSelf: "flex-start",
  },
  dangerBtnText: { color: "#991B1B", fontWeight: "800", fontSize: 14 },
  h: { fontSize: 16, fontWeight: "700" as const, marginTop: 8 },
  editRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" },
  input: {
    width: 100,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  setBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#111827",
  },
  setBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  clearBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#E5E7EB",
  },
  clearBtnText: { color: "#374151", fontWeight: "800", fontSize: 14 },
  backBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
  },
  backBtnText: { color: "#374151", fontSize: 16, fontWeight: "800" },
});

const stylesL = StyleSheet.create({
  container: { padding: 22, gap: 14 },
  title: { fontSize: 28 },
  sub: { fontSize: 14 },
  card: { padding: 18, borderRadius: 16, gap: 10 },
  sectionTitle: { fontSize: 20 },
  configRow: { fontSize: 16 },
  configRule: { fontSize: 16 },
  hint: { fontSize: 14 },
  muted: { fontSize: 16 },
  pill: { paddingVertical: 12, paddingHorizontal: 18 },
  pillText: { fontSize: 16 },
  row: { paddingVertical: 12, paddingHorizontal: 14 },
  cellRound: { width: 64, fontSize: 16 },
  cellScore: { fontSize: 18 },
  badge: { fontSize: 14 },
  dangerBtn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12 },
  dangerBtnText: { fontSize: 16 },
  h: { fontSize: 18 },
  input: { width: 120, paddingVertical: 10, fontSize: 18 },
  setBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  setBtnText: { fontSize: 16 },
  clearBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  clearBtnText: { fontSize: 16 },
  backBtn: { paddingVertical: 18, borderRadius: 14 },
  backBtnText: { fontSize: 18 },
});
