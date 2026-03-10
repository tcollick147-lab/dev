import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { healthCheck, buildBaseUrl } from "../api/remoteApi";
import { saveConfig } from "../hooks/useServerConfig";

type Props = {
  initialIp: string;
  initialPort: string;
  onSave: (ip: string, port: string) => void;
  onBack?: () => void;
};

export default function SettingsScreen({
  initialIp,
  initialPort,
  onSave,
  onBack,
}: Props) {
  const [ip, setIp] = useState(initialIp);
  const [port, setPort] = useState(initialPort || "3000");
  const [testing, setTesting] = useState(false);

  const handleSave = useCallback(async () => {
    const trimmedIp = ip.trim();
    const trimmedPort = (port.trim() || "3000").trim();
    await saveConfig(trimmedIp, trimmedPort);
    onSave(trimmedIp, trimmedPort);
  }, [ip, port, onSave]);

  const handleTestConnection = useCallback(async () => {
    const baseUrl = buildBaseUrl(ip.trim(), port.trim() || "3000");
    if (!baseUrl) {
      Alert.alert("Error", "Enter a server IP first.");
      return;
    }
    setTesting(true);
    try {
      const result = await healthCheck(baseUrl);
      if (result.ok) {
        Alert.alert("Success", result.message || "Server is reachable.");
      } else {
        Alert.alert("Connection failed", result.message);
      }
    } finally {
      setTesting(false);
    }
  }, [ip, port]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Settings</Text>

        <Text style={styles.label}>Server IP</Text>
        <TextInput
          style={styles.input}
          value={ip}
          onChangeText={setIp}
          placeholder="e.g. 192.168.0.50"
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numeric"
        />

        <Text style={styles.label}>Port</Text>
        <TextInput
          style={styles.input}
          value={port}
          onChangeText={setPort}
          placeholder="3000"
          placeholderTextColor="#888"
          keyboardType="numeric"
        />

        <Pressable
          style={({ pressed }) => [styles.button, styles.primaryButton, pressed && styles.pressed]}
          onPress={handleTestConnection}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Test Connection</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, styles.saveButton, pressed && styles.pressed]}
          onPress={handleSave}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>

        {onBack && (
          <Pressable
            style={({ pressed }) => [styles.button, styles.backButton, pressed && styles.pressed]}
            onPress={onBack}
          >
            <Text style={styles.backButtonText}>Back to Remote</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scroll: {
    padding: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 24,
    color: "#111",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
    color: "#111",
  },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: "#0a7ea4",
  },
  saveButton: {
    backgroundColor: "#1a7f37",
  },
  backButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#666",
    marginTop: 8,
  },
  pressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  backButtonText: {
    color: "#333",
    fontSize: 16,
    fontWeight: "600",
  },
});
