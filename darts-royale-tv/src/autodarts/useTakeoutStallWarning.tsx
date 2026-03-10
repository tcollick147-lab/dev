import { useEffect, useRef, useState, useCallback } from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";

const TAKEOUT_STALL_TIMEOUT_MS = 3000;

export type UseTakeoutStallWarningOptions = {
  /** True when AutoDarts status is "Takeout in progress" */
  isTakeoutInProgress: boolean;
  /** Called when user taps "Reset Board" to clear the stuck takeout state only (no scoring/turn change) */
  onResetTakeout: () => void;
  /** When this value changes, the stall timer is cleared (e.g. current turn index so new turn cancels timer) */
  turnKey?: number | string;
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    minWidth: 280,
    maxWidth: 400,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    color: "#111",
  },
  message: {
    fontSize: 16,
    color: "#333",
    marginBottom: 24,
    lineHeight: 22,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 100,
    alignItems: "center",
  },
  btnWait: {
    backgroundColor: "#e5e7eb",
  },
  btnReset: {
    backgroundColor: "#2563eb",
  },
  btnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  btnWaitText: {
    color: "#374151",
  },
  btnResetText: {
    color: "#fff",
  },
});

/**
 * When "Takeout in Progress" lasts longer than 3 seconds, shows a warning popup.
 * Wait = close popup only. Reset Board = clear stuck takeout state (onResetTakeout) and close popup.
 * Popup auto-closes when isTakeoutInProgress becomes false (AutoDarts reset normally).
 * Timer is cleared when turnKey change (e.g. new turn).
 */
export function useTakeoutStallWarning(options: UseTakeoutStallWarningOptions) {
  const { isTakeoutInProgress, onResetTakeout, turnKey } = options;
  const [showPopup, setShowPopup] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onResetTakeoutRef = useRef(onResetTakeout);
  onResetTakeoutRef.current = onResetTakeout;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Start 3s timer when takeout in progress begins; cancel when it ends
  useEffect(() => {
    if (!isTakeoutInProgress) {
      clearTimer();
      setShowPopup(false);
      return;
    }
    if (timerRef.current != null) return; // already running
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setShowPopup(true);
    }, TAKEOUT_STALL_TIMEOUT_MS);
    return clearTimer;
  }, [isTakeoutInProgress, clearTimer]);

  // Clear timer when turn changes (new turn cancels stall timer)
  useEffect(() => {
    clearTimer();
    setShowPopup(false);
  }, [turnKey, clearTimer]);

  const onWait = useCallback(() => {
    setShowPopup(false);
  }, []);

  const onResetBoard = useCallback(() => {
    onResetTakeoutRef.current();
    setShowPopup(false);
    clearTimer();
  }, [clearTimer]);

  const takeoutStallModal = (
    <Modal
      transparent
      visible={showPopup}
      animationType="fade"
      onRequestClose={onWait}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Takeout in Progress</Text>
          <Text style={styles.message}>
            AutoDarts has not reset yet and may be stuck.
          </Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnWait]} onPress={onWait}>
              <Text style={[styles.btnText, styles.btnWaitText]}>Wait</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnReset]} onPress={onResetBoard}>
              <Text style={[styles.btnText, styles.btnResetText]}>Reset Board</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  return { takeoutStallModal };
}
