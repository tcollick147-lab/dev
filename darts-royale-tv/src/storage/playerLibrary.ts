// src/storage/playerLibrary.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export type StoredPlayer = { id: string; name: string };

const KEY = "dartsroyale_player_library_v1";

export async function loadPlayerLibrary(): Promise<StoredPlayer[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => ({ id: String(p.id ?? ""), name: String(p.name ?? "").trim() }))
      .filter((p) => p.id && p.name);
  } catch {
    return [];
  }
}

export async function savePlayerLibrary(players: StoredPlayer[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(players));
  } catch {
    // ignore
  }
}

export function upsertPlayer(list: StoredPlayer[], name: string): StoredPlayer[] {
  const n = name.trim();
  if (!n) return list;

  // De-dupe by case-insensitive name
  const exists = list.some((p) => p.name.toLowerCase() === n.toLowerCase());
  if (exists) return list;

  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return [{ id, name: n }, ...list].slice(0, 200);
}

export function deletePlayer(list: StoredPlayer[], id: string): StoredPlayer[] {
  return list.filter((p) => p.id !== id);
}
