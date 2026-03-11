// src/storage/handicapSyncStorage.ts
// Shared handicap sync via file (e.g. iCloud Drive). Safe migration from local storage.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireNativeModule } from "expo-modules-core";
import { File, Paths, Directory } from "expo-file-system";
import { loadGolfSetup, saveGolfSetup } from "./setupStorage";
import type { PersistedGolfOnly } from "./setupStorage";
import { loadPlayerProfiles, type PlayerProfile } from "./setupStorage";

// ---------------------------------------------------------------------------
// Shared file JSON types (iCloud / DartsRoyale / handicaps.json)
// ---------------------------------------------------------------------------

export type HandicapHistoryEntry = {
  date: string; // ISO
  handicap: number;
  reason: string;
};

export type HandicapSharedPlayer = {
  id: string;
  name: string;
  handicap: number;
  updatedAt: string; // ISO
  history: HandicapHistoryEntry[];
  /** Round scores (gross per round) so round history can be restored on import */
  scores?: number[];
};

export type HandicapSharedFile = {
  lastUpdated: string; // ISO
  players: HandicapSharedPlayer[];
};

// ---------------------------------------------------------------------------
// AsyncStorage keys
// ---------------------------------------------------------------------------

const KEY_SELECTED_HANDICAP_FILE_URI = "dartsroyale_handicap_file_uri_v1";
const KEY_HANDICAP_MIGRATION_DONE = "dartsroyale_handicap_migration_done_v1";
const KEY_LAST_SYNCED_AT = "dartsroyale_handicap_last_synced_v1";
const KEY_LAST_LOCAL_HANDICAP_UPDATED = "dartsroyale_handicap_last_local_updated_v1";

/** Debounce delay (ms) before writing to cloud after last handicap change */
const CLOUD_SYNC_DEBOUNCE_MS = 1500;

// ---------------------------------------------------------------------------
// Logging (debug / support)
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[HandicapSync]";

function log(msg: string, detail?: unknown): void {
  if (__DEV__) {
    if (detail !== undefined) console.log(LOG_PREFIX, msg, detail);
    else console.log(LOG_PREFIX, msg);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString();
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Stable id from name when profile id not available */
function idFromName(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, "_");
  return `p_${base}`;
}

/** Build empty shared file */
export function createEmptySharedFile(): HandicapSharedFile {
  return {
    lastUpdated: nowISO(),
    players: [],
  };
}

// ---------------------------------------------------------------------------
// File URI persistence
// ---------------------------------------------------------------------------

export async function getSelectedHandicapFileUri(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_SELECTED_HANDICAP_FILE_URI);
}

export async function setSelectedHandicapFileUri(uri: string | null): Promise<void> {
  if (uri == null || uri === "") {
    await AsyncStorage.removeItem(KEY_SELECTED_HANDICAP_FILE_URI);
  } else {
    await AsyncStorage.setItem(KEY_SELECTED_HANDICAP_FILE_URI, uri);
  }
}

export async function isMigrationComplete(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEY_HANDICAP_MIGRATION_DONE);
  return raw === "true";
}

export async function setMigrationComplete(): Promise<void> {
  await AsyncStorage.setItem(KEY_HANDICAP_MIGRATION_DONE, "true");
}

export async function getLastSyncedAt(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_LAST_SYNCED_AT);
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_SYNCED_AT, iso);
}

export async function getLastLocalHandicapUpdated(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_LAST_LOCAL_HANDICAP_UPDATED);
}

export async function setLastLocalHandicapUpdated(iso: string): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_LOCAL_HANDICAP_UPDATED, iso);
}

// ---------------------------------------------------------------------------
// Read / write shared file
// ---------------------------------------------------------------------------

export async function readSharedHandicapFile(uri: string): Promise<HandicapSharedFile | null> {
  log("readSharedHandicapFile: source URI", uri);
  try {
    const file = new File(uri);
    const content = await file.text();
    const parsed = safeJsonParse<HandicapSharedFile>(content);
    if (parsed && Array.isArray(parsed.players)) {
      log("readSharedHandicapFile: success", { playersCount: parsed.players.length });
      return {
        lastUpdated: typeof parsed.lastUpdated === "string" ? parsed.lastUpdated : nowISO(),
        players: parsed.players,
      };
    }
    log("readSharedHandicapFile: no valid players array");
    return null;
  } catch (e) {
    log("readSharedHandicapFile: failure", e);
    return null;
  }
}

/** Default path for "Create Handicap File" (app document directory). */
export function getDefaultHandicapFilePath(): string {
  const file = new File(Paths.document, "DartsRoyale", "handicaps.json");
  return file.uri;
}

export async function writeSharedHandicapFile(uri: string, data: HandicapSharedFile): Promise<boolean> {
  try {
    const file = new File(uri);
    try {
      (file.parentDirectory as { create: (opts?: object) => void }).create({ idempotent: true });
    } catch {
      // parent may already exist or be unwritable
    }
    (file as { create: (opts?: object) => void }).create({ idempotent: true });
    file.write(JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the file at uri if it exists, then write data. Use for "replace" export so we don't create duplicates.
 * Returns { success: true } or { success: false, error: string }.
 */
export async function replaceExistingCloudFile(
  uri: string,
  data: HandicapSharedFile
): Promise<{ success: boolean; error?: string }> {
  try {
    const file = new File(uri);
    if (file.exists) {
      try {
        file.delete();
        log("replaceExistingCloudFile: deleted existing file", uri);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("replaceExistingCloudFile: cloud delete failed", { uri, error: msg });
        return { success: false, error: `Could not remove previous file: ${msg}` };
      }
    }
    const written = await writeSharedHandicapFile(uri, data);
    if (!written) {
      log("replaceExistingCloudFile: write failed", uri);
      return { success: false, error: "Could not write to cloud file." };
    }
    log("replaceExistingCloudFile: success", { uri, playersCount: data.players.length });
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("replaceExistingCloudFile: failure", { uri, error: msg });
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Cloud sync: debounced auto-sync and load-if-newer
// ---------------------------------------------------------------------------

let cloudSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedules a single cloud write after the last handicap change. Debounced so rapid edits produce one sync.
 * Non-blocking; runs in background.
 */
export function scheduleHandicapCloudSync(): void {
  if (cloudSyncDebounceTimer) clearTimeout(cloudSyncDebounceTimer);
  cloudSyncDebounceTimer = setTimeout(() => {
    cloudSyncDebounceTimer = null;
    performHandicapCloudSync().catch((e) => {
      log("scheduleHandicapCloudSync: perform failed", e);
    });
  }, CLOUD_SYNC_DEBOUNCE_MS);
  log("scheduleHandicapCloudSync: scheduled", { delayMs: CLOUD_SYNC_DEBOUNCE_MS });
}

/**
 * Writes current local handicap data to the shared cloud file (replace existing).
 * Call after local save. No-op if no cloud file URI is set. Lightweight and async.
 */
export async function performHandicapCloudSync(): Promise<{ success: boolean; error?: string }> {
  const uri = await getSelectedHandicapFileUri();
  if (!uri || uri === "") {
    log("performHandicapCloudSync: no cloud file URI set, skip");
    return { success: true };
  }
  log("performHandicapCloudSync: start", { uri });
  try {
    const players = await buildSharedPlayersFromLocal();
    const data: HandicapSharedFile = {
      lastUpdated: nowISO(),
      players,
    };
    const result = await replaceExistingCloudFile(uri, data);
    if (result.success) {
      await setLastSyncedAt(data.lastUpdated);
      await setLastLocalHandicapUpdated(data.lastUpdated);
      log("performHandicapCloudSync: cloud save success", { playersCount: players.length });
    } else {
      log("performHandicapCloudSync: cloud save failed", result.error);
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("performHandicapCloudSync: failure", e);
    return { success: false, error: msg };
  }
}

/**
 * Applies cloud handicap data to local storage (overrides + scoresByPlayer). Updates local lastUpdated.
 * Call after confirming cloud is newer. Does not touch other golf setup (players, settings, etc.).
 */
export async function applyCloudDataToLocal(cloudData: HandicapSharedFile): Promise<boolean> {
  try {
    const stored = await loadGolfSetup();
    if (!stored) {
      log("applyCloudDataToLocal: no current setup");
      return false;
    }
    const overrides = sharedPlayersToOverrides(cloudData.players);
    const importedScores = sharedPlayersToScoresByPlayer(cloudData.players);
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
    await setLastLocalHandicapUpdated(cloudData.lastUpdated);
    log("applyCloudDataToLocal: success", { playersCount: cloudData.players.length });
    return true;
  } catch (e) {
    log("applyCloudDataToLocal: failure", e);
    return false;
  }
}

/**
 * If a cloud file is configured, read it and compare lastUpdated with local.
 * If cloud is newer, import and apply to local. If local is newer or equal, do nothing.
 * Returns { applied: true } if cloud was newer and imported; { applied: false } otherwise.
 */
export async function loadCloudHandicapsIfNewer(): Promise<{ applied: boolean; error?: string }> {
  const uri = await getSelectedHandicapFileUri();
  if (!uri || uri === "") {
    log("loadCloudHandicapsIfNewer: no cloud file URI, skip");
    return { applied: false };
  }
  try {
    const cloudData = await readSharedHandicapFile(uri);
    if (!cloudData || !Array.isArray(cloudData.players)) {
      log("loadCloudHandicapsIfNewer: no valid cloud data");
      return { applied: false };
    }
    const cloudTime = new Date(cloudData.lastUpdated || 0).getTime();
    const localUpdated = await getLastLocalHandicapUpdated();
    // If local was never set (e.g. pre-sync device), don't overwrite with cloud to avoid losing local data
    if (!localUpdated) {
      log("loadCloudHandicapsIfNewer: local timestamp never set, skip import to avoid overwriting");
      return { applied: false };
    }
    const localTime = new Date(localUpdated).getTime();
    log("loadCloudHandicapsIfNewer: timestamp comparison", {
      cloud: cloudData.lastUpdated,
      local: localUpdated,
      cloudTime,
      localTime,
    });
    if (cloudTime <= localTime) {
      log("loadCloudHandicapsIfNewer: local is same or newer, skip import");
      return { applied: false };
    }
    const ok = await applyCloudDataToLocal(cloudData);
    if (!ok) {
      return { applied: false, error: "Failed to apply cloud data locally." };
    }
    log("loadCloudHandicapsIfNewer: imported cloud data (cloud was newer)");
    return { applied: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("loadCloudHandicapsIfNewer: failure", e);
    return { applied: false, error: msg };
  }
}

/**
 * Export directly to the configured cloud file (replace existing). Use when user has selected the file.
 * Returns success and optional error message.
 */
export async function exportToCloudFile(): Promise<{ success: boolean; error?: string }> {
  const uri = await getSelectedHandicapFileUri();
  if (!uri || uri === "") {
    return { success: false, error: "No cloud file selected. Use “Select handicap file” first, or use Export to save via Share sheet." };
  }
  try {
    const players = await buildSharedPlayersFromLocal();
    const data: HandicapSharedFile = {
      lastUpdated: nowISO(),
      players,
    };
    const result = await replaceExistingCloudFile(uri, data);
    if (result.success) {
      await setLastSyncedAt(data.lastUpdated);
      await setLastLocalHandicapUpdated(data.lastUpdated);
      log("exportToCloudFile: success", { uri, playersCount: players.length });
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("exportToCloudFile: failure", e);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Local handicap data for migration (from Golf setup)
// ---------------------------------------------------------------------------

export type LocalHandicapData = {
  scoresByPlayer: Record<string, number[]>;
  handicapOverrides: Record<string, number>;
  playerNames: string[];
};

export async function getLocalHandicapData(): Promise<LocalHandicapData | null> {
  const stored = await loadGolfSetup();
  if (!stored?.golfHandicap) return null;
  const scores = stored.golfHandicap.scoresByPlayer ?? {};
  const overrides = stored.golfHandicap.handicapOverrides ?? {};
  const names = Object.keys(scores).concat(Object.keys(overrides)).filter(Boolean);
  const unique = Array.from(new Set(names));
  if (unique.length === 0 && Object.keys(scores).length === 0 && Object.keys(overrides).length === 0) {
    return null;
  }
  return {
    scoresByPlayer: scores,
    handicapOverrides: overrides,
    playerNames: unique.length ? unique : Object.keys(scores),
  };
}

/** Convert local data + profiles into shared-file players (for migration). Uses computed handicap from last round or override. */
function localToSharedPlayers(
  local: LocalHandicapData,
  profiles: PlayerProfile[]
): HandicapSharedPlayer[] {
  const nameToId = new Map<string, string>();
  for (const p of profiles) {
    nameToId.set(p.name.trim(), p.id);
  }
  const players: HandicapSharedPlayer[] = [];
  const now = nowISO();
  for (const name of local.playerNames) {
    const id = nameToId.get(name) ?? idFromName(name);
    const scores = local.scoresByPlayer[name] ?? [];
    const override = local.handicapOverrides[name];
    // Current handicap: override if set, else we don't store a "computed" in shared file; use 0 and put round scores in history as reason
    const handicap = override != null && Number.isFinite(override) ? override : 0;
    const history: HandicapHistoryEntry[] = scores.map((score, i) => ({
      date: now,
      handicap,
      reason: `round_${i + 1}`,
    }));
    // If we have scores but no override, we could set handicap from a simple avg; spec says handicap is number so use 0 and history for audit
    players.push({
      id,
      name,
      handicap,
      updatedAt: now,
      history: history.length ? history : [{ date: now, handicap, reason: "migrated" }],
    });
  }
  return players;
}

// ---------------------------------------------------------------------------
// Backup (to app document directory: DartsRoyale/backups/)
// ---------------------------------------------------------------------------

function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `backup_handicaps_${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}.json`;
}

export async function createBackupExport(localData: PersistedGolfOnly["golfHandicap"]): Promise<string | null> {
  try {
    const dartsRoyale = new Directory(Paths.document, "DartsRoyale");
    (dartsRoyale as { create: (opts?: object) => void }).create({ idempotent: true });
    const backups = new Directory(dartsRoyale, "backups");
    (backups as { create: (opts?: object) => void }).create({ idempotent: true });
    const file = new File(backups, backupFileName());
    (file as { create: (opts?: object) => void }).create({ idempotent: true });
    const payload = { exportedAt: nowISO(), golfHandicap: localData };
    file.write(JSON.stringify(payload, null, 2));
    return file.uri;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Migration: local -> shared file (only if shared empty; never delete local)
// ---------------------------------------------------------------------------

export type MigrationResult = "not_needed" | "done" | "failed" | "no_local_data";

export async function runMigrationIfNeeded(fileUri: string): Promise<MigrationResult> {
  const alreadyDone = await isMigrationComplete();
  if (alreadyDone) return "not_needed";

  const local = await getLocalHandicapData();
  const shared = await readSharedHandicapFile(fileUri);

  const sharedEmpty = !shared || !shared.players || shared.players.length === 0;
  if (!sharedEmpty) {
    await setMigrationComplete();
    return "not_needed";
  }
  if (!local || local.playerNames.length === 0) {
    return "no_local_data";
  }

  // Backup local before migration
  const stored = await loadGolfSetup();
  if (stored?.golfHandicap) {
    await createBackupExport(stored.golfHandicap);
  }

  const profiles = await loadPlayerProfiles();
  const players = localToSharedPlayers(local, profiles);
  const data: HandicapSharedFile = {
    lastUpdated: nowISO(),
    players,
  };

  const written = await writeSharedHandicapFile(fileUri, data);
  if (!written) return "failed";

  const reread = await readSharedHandicapFile(fileUri);
  if (!reread || reread.players.length !== data.players.length) return "failed";

  await setMigrationComplete();
  return "done";
}

// ---------------------------------------------------------------------------
// Merge: by player id, newest updatedAt wins; keep history
// ---------------------------------------------------------------------------

export function mergeSharedPlayers(
  existing: HandicapSharedPlayer[],
  incoming: HandicapSharedPlayer[]
): HandicapSharedPlayer[] {
  const byId = new Map<string, HandicapSharedPlayer>();
  for (const p of existing) byId.set(p.id, { ...p });
  for (const p of incoming) {
    const cur = byId.get(p.id);
    if (!cur || new Date(p.updatedAt) > new Date(cur.updatedAt)) {
      byId.set(p.id, { ...p });
    } else {
      // Keep existing but merge history (append new entries from p.history not in cur)
      const curDates = new Set((cur.history ?? []).map((h) => h.date));
      const extra = (p.history ?? []).filter((h) => !curDates.has(h.date));
      if (extra.length) {
        byId.set(p.id, { ...cur, history: [...(cur.history ?? []), ...extra] });
      }
    }
  }
  return Array.from(byId.values());
}

/** Reload shared file, merge with current in-memory state, write back. */
export async function syncAndMergeWithShared(
  fileUri: string,
  currentPlayers: HandicapSharedPlayer[]
): Promise<{ success: boolean; data: HandicapSharedFile | null }> {
  const existing = await readSharedHandicapFile(fileUri);
  const mergedList = mergeSharedPlayers(existing?.players ?? [], currentPlayers);
  const data: HandicapSharedFile = {
    lastUpdated: nowISO(),
    players: mergedList,
  };
  const ok = await writeSharedHandicapFile(fileUri, data);
  if (ok) await setLastSyncedAt(data.lastUpdated);
  return { success: ok, data: ok ? data : null };
}

/** Export current handicaps to a JSON string (for backup or copy). */
export function exportCurrentHandicapsToJson(sharedData: HandicapSharedFile): string {
  return JSON.stringify(sharedData, null, 2);
}

/**
 * Build handicaps JSON and write to a temp file in app cache.
 * Returns the file URI for use with Share sheet (e.g. Save to Files → iCloud Drive).
 * Caller must open the native share/save sheet; we do NOT write directly to iCloud.
 */
export async function prepareExportToTempFile(): Promise<{ tempUri: string; data: HandicapSharedFile } | null> {
  let file: File;
  try {
    const NativeFileSystem = requireNativeModule("FileSystem");
    const base = NativeFileSystem.cacheDirectory ?? NativeFileSystem.documentDirectory ?? "";
    if (!base) {
      log("prepareExportToTempFile: no cache/document directory from native module");
      return null;
    }
    const uri = base.endsWith("/") ? `${base}handicaps_export.json` : `${base}/handicaps_export.json`;
    file = new File(uri);
  } catch (e) {
    log("prepareExportToTempFile: fallback to Paths", e);
    try {
      file = new File(Paths.cache, "handicaps_export.json");
    } catch {
      try {
        file = new File(Paths.document, "handicaps_export.json");
      } catch (e2) {
        log("prepareExportToTempFile: could not create File", e2);
        return null;
      }
    }
  }

  try {
    log("prepareExportToTempFile: temp export path", file.uri);

    let players: HandicapSharedPlayer[];
    try {
      players = await buildSharedPlayersFromLocal();
    } catch {
      players = [];
    }
    const data: HandicapSharedFile = {
      lastUpdated: nowISO(),
      players,
    };
    const json = JSON.stringify(data, null, 2);

    try {
      (file as { create: (opts?: object) => void }).create({ idempotent: true });
    } catch (_) {
      // File may already exist; try write anyway
    }
    file.write(json);
    log("prepareExportToTempFile: wrote file successfully", { playersCount: data.players.length });
    return { tempUri: file.uri, data };
  } catch (e) {
    log("prepareExportToTempFile: failure", e);
    return null;
  }
}

/** Build shared players from current local golf handicap data (for push/merge). */
export async function buildSharedPlayersFromLocal(): Promise<HandicapSharedPlayer[]> {
  const stored = await loadGolfSetup();
  const profiles = await loadPlayerProfiles();
  if (!stored?.golfHandicap) return [];
  const names = Object.keys(stored.golfHandicap.scoresByPlayer ?? {}).concat(
    Object.keys(stored.golfHandicap.handicapOverrides ?? {})
  );
  const unique = Array.from(new Set(names)).filter(Boolean);
  if (unique.length === 0) return [];
  const nameToId = new Map<string, string>();
  for (const p of profiles) nameToId.set(p.name.trim(), p.id);
  const now = nowISO();
  return unique.map((name) => {
    const id = nameToId.get(name) ?? idFromName(name);
    const override = stored.golfHandicap!.handicapOverrides?.[name];
    const scores = stored.golfHandicap!.scoresByPlayer?.[name] ?? [];
    const handicap = override != null && Number.isFinite(override) ? override : 0;
    const history: HandicapHistoryEntry[] = scores.length
      ? scores.map((s, i) => ({ date: now, handicap, reason: `round_${i + 1}` }))
      : [{ date: now, handicap, reason: "migrated" }];
    return { id, name, handicap, updatedAt: now, history, scores };
  });
}

/** Apply shared file players into local handicap overrides (by name). Only includes entries for non-zero handicap so 0 is "clear" (no override). */
export function sharedPlayersToOverrides(players: HandicapSharedPlayer[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of players) {
    if (p.handicap !== 0 && Number.isFinite(p.handicap)) {
      out[p.name] = p.handicap;
    }
  }
  return out;
}

/** Build scoresByPlayer from shared file so round history is restored on import. */
export function sharedPlayersToScoresByPlayer(players: HandicapSharedPlayer[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const p of players) {
    if (Array.isArray(p.scores) && p.scores.length > 0) {
      out[p.name] = p.scores.filter((n) => Number.isFinite(Number(n))).map(Number);
    }
  }
  return out;
}
