import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
  isLarge?: boolean;
}) {
  const { label, value, options, onChange, isLarge } = props;
  const big = !!isLarge;

  return (
    <View style={{ gap: big ? 10 : 6 }}>
      <Text style={[styles.label, big && stylesL.label]}>{label}</Text>

      <View style={[styles.row, big && stylesL.row]}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                styles.btn,
                big && stylesL.btn,
                active && styles.btnActive,
              ]}
            >
              <Text
                style={[
                  styles.btnText,
                  big && stylesL.btnText,
                  active && styles.btnTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: "#334155" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  btnActive: {
    backgroundColor: "#0EA5E9",
    borderColor: "#0284C7",
  },
  btnText: { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  btnTextActive: { color: "#FFFFFF" },
});

const stylesL = StyleSheet.create({
  label: { fontSize: 16 },
  row: { gap: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14 },
  btnText: { fontSize: 16 },
});
