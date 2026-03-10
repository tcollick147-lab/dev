import React, { useState, useEffect, useCallback, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { loadConfig } from "./src/hooks/useServerConfig";
import { healthCheck, buildBaseUrl, getAutoDartsState } from "./src/api/remoteApi";
import RemoteScreen from "./src/screens/RemoteScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const HEALTH_POLL_INTERVAL_MS = 5000;

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<"remote" | "settings">("remote");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("3000");
  const [connected, setConnected] = useState(false);
  const [autoDartsStatus, setAutoDartsStatus] = useState<string | null>(null);
  const [autoDartsNumThrows, setAutoDartsNumThrows] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseUrl = buildBaseUrl(ip, port);

  const runHealthCheck = useCallback(async () => {
    if (!baseUrl) {
      setConnected(false);
      setAutoDartsStatus(null);
      setAutoDartsNumThrows(0);
      return;
    }
    const result = await healthCheck(baseUrl);
    setConnected(result.ok);
    if (result.ok) {
      getAutoDartsState(baseUrl).then((state) => {
        setAutoDartsStatus(state.status ?? null);
        setAutoDartsNumThrows(state.numThrows ?? 0);
      }).catch(() => {
        // Keep previous status on fetch error (e.g. timeout)
      });
    } else {
      setAutoDartsStatus(null);
      setAutoDartsNumThrows(0);
    }
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await loadConfig();
      if (cancelled) return;
      setIp(config.ip);
      setPort(config.port);
      if (!config.ip.trim()) {
        setScreen("settings");
      } else {
        setScreen("remote");
        await healthCheck(buildBaseUrl(config.ip, config.port)).then((r) =>
          setConnected(r.ok)
        );
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !baseUrl) return;
    runHealthCheck();
    pollRef.current = setInterval(runHealthCheck, HEALTH_POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [ready, baseUrl, runHealthCheck]);

  const handleSaveSettings = useCallback((newIp: string, newPort: string) => {
    setIp(newIp);
    setPort(newPort);
    setScreen("remote");
    const url = buildBaseUrl(newIp, newPort);
    if (url) healthCheck(url).then((r) => setConnected(r.ok));
  }, []);

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "settings") {
    return (
      <>
        <SettingsScreen
          initialIp={ip}
          initialPort={port}
          onSave={handleSaveSettings}
          onBack={ip.trim() ? () => setScreen("remote") : undefined}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <>
      <RemoteScreen
        baseUrl={baseUrl}
        connected={connected}
        autoDartsStatus={autoDartsStatus}
        autoDartsNumThrows={autoDartsNumThrows}
        onOpenSettings={() => setScreen("settings")}
      />
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
});
