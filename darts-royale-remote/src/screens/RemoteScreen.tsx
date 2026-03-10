import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, SafeAreaView } from "react-native";
import { sendReset, sendRestart } from "../api/remoteApi";

type Props = {
  baseUrl: string;
  connected: boolean;
  autoDartsStatus: string | null;
  autoDartsNumThrows: number;
  onOpenSettings: () => void;
};

export default function RemoteScreen({
  baseUrl,
  connected,
  autoDartsStatus,
  autoDartsNumThrows,
  onOpenSettings,
}: Props) {
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [loading, setLoading] = useState<"reset" | "restart" | null>(null);

  // Mirror MatchGameScreen: autoStatus -> autoDartsStatus, autoResetting -> loading
  const autoStatus = String(autoDartsStatus ?? "");
  const isTakeout = useMemo(() => autoStatus.toLowerCase().includes("takeout"), [autoStatus]);

  const resetLabel = useMemo(() => {
    if (loading === "reset") return "Resetting…";
    if (isTakeout) return "Reset (Takeout)";
    if (autoDartsNumThrows === 1) return "Reset (1/3)";
    if (autoDartsNumThrows === 2) return "Reset (2/3)";
    if (autoDartsNumThrows >= 3) return "Reset (3/3)";
    return "Reset";
  }, [loading, isTakeout, autoDartsNumThrows]);

  const restartLabel = useMemo(() => {
    if (loading === "restart") return "Working…";
    const s = autoStatus.toLowerCase();
    if (s.includes("stopped")) return "Restart (Stopped)";
    return "Restart";
  }, [loading, autoStatus]);

  const runReset = useCallback(async () => {
    setLoading("reset");
    setLastResult(null);
    const result = await sendReset(baseUrl);
    setLoading(null);
    setLastResult(result.ok ? "Reset sent successfully." : result.message);
  }, [baseUrl]);

  const runRestart = useCallback(async () => {
    setLoading("restart");
    setLastResult(null);
    const result = await sendRestart(baseUrl);
    setLoading(null);
    setLastResult(result.ok ? "Restart sent successfully." : result.message);
  }, [baseUrl]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Darts Royale Remote</Text>
        <View style={[styles.badge, connected ? styles.badgeConnected : styles.badgeDisconnected]}>
          <Text style={styles.badgeText}>{connected ? "Connected" : "Disconnected"}</Text>
        </View>
        {connected && (
          <Text style={styles.statusText}>
            Status: {autoStatus || "—"}
          </Text>
        )}
      </View>

      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [
            styles.bigButton,
            styles.resetButton,
            (!connected || loading) && styles.buttonDisabled,
            pressed && connected && !loading && styles.pressed,
          ]}
          onPress={runReset}
          disabled={!connected || !!loading}
        >
          <Text style={styles.bigButtonText}>{resetLabel}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.bigButton,
            styles.restartButton,
            (!connected || loading) && styles.buttonDisabled,
            pressed && connected && !loading && styles.pressed,
          ]}
          onPress={runRestart}
          disabled={!connected || !!loading}
        >
          <Text style={styles.bigButtonText}>{restartLabel}</Text>
        </Pressable>
      </View>

      {lastResult !== null && (
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>Last result</Text>
          <Text style={styles.resultText}>{lastResult}</Text>
        </View>
      )}

      <Pressable style={styles.settingsLink} onPress={onOpenSettings}>
        <Text style={styles.settingsLinkText}>Settings</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 48,
  },
  header: {
    marginTop: 16,
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111",
    marginBottom: 12,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeConnected: {
    backgroundColor: "#1a7f37",
  },
  badgeDisconnected: {
    backgroundColor: "#c0392b",
  },
  badgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  statusText: {
    marginTop: 8,
    fontSize: 14,
    color: "#555",
  },
  buttons: {
    gap: 16,
    marginHorizontal: 8,
  },
  bigButton: {
    paddingVertical: 20,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  resetButton: {
    backgroundColor: "#c0392b",
  },
  restartButton: {
    backgroundColor: "#0a7ea4",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  bigButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  resultBox: {
    marginTop: 28,
    padding: 16,
    backgroundColor: "#eee",
    borderRadius: 10,
  },
  resultLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#555",
    marginBottom: 4,
  },
  resultText: {
    fontSize: 15,
    color: "#111",
  },
  settingsLink: {
    marginTop: "auto",
    paddingVertical: 16,
    alignItems: "center",
  },
  settingsLinkText: {
    fontSize: 16,
    color: "#0a7ea4",
    fontWeight: "600",
  },
});
