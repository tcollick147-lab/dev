// src/storage/setupStorage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PLAYERS = "dartsroyale_players_v1"; // legacy: string[]
const KEY_SETUP = "dartsroyale_setup_v2"; // ✅ bump key so old shape doesn't conflict

// ✅ NEW: Player DB + selection
const KEY_PLAYER_PROFILES = "dartsroyale_player_profiles_v1"; // PlayerProfile[]
const KEY_IN_GAME_IDS = "dartsroyale_in_game_ids_v1"; // string[]

// --------------------
// Types
// --------------------
export type PlayerProfile = {
  id: string; // stable unique
  name: string;
  nick?: string;
  avatar?: string;
};

export type PersistedSetup = {
  // Match
  startScore: number;
  inRule: "STRAIGHT" | "DOUBLE" | "MASTER";
  outRule: "STRAIGHT" | "DOUBLE" | "MASTER";
  side: {
    scoreBonusOn: boolean;
    scoreBonusThreshold: number;
    scoreBonusValue: number;

    scoreJackpotOn: boolean;
    scoreJackpotThreshold: number;
    scoreJackpotValue: number;

    checkoutBonusOn: boolean;
    checkoutBonusThreshold: number;
    checkoutBonusValue: number;

    checkoutJackpotOn: boolean;
    checkoutJackpotThreshold: number;
    checkoutJackpotValue: number;

    bullOn: boolean;
    bullValue: number;

    gameWinnerOn: boolean;
    entry: number;
  };

  // ✅ Golf
  golf?: {
    selected: boolean[]; // length 19, index 1..18 used
    bullOn: boolean;
    nassau: boolean;

    // ✅ NEW (Score display on holes)
    cellMode?: "HOLE" | "TOTAL";

    side: {
      enabled: boolean;

      placementOn: boolean;
      placement: number[];

      nassauOn: boolean;
      nassauBack9Double: boolean;

      // ✅ NEW: resolve front-9 playoff after 9 holes
      nassauFrontResolveAfter9?: boolean;

      // ✅ NEW: tie option + divisor
      tieOn?: boolean;
      tieDivisor?: number;

      eagleBonusOn: boolean;
      eagleBonusValue: number;
      eagleBonusCount: number;

      eagleJackpotOn: boolean;
      eagleJackpotValue: number;
      eagleJackpotCount: number;

      roundBonusOn: boolean;
      roundBonusValue: number;
      roundBonusThreshold: number;

      roundJackpotOn: boolean;
      roundJackpotValue: number;
      roundJackpotThreshold: number;
    };
  };
};

// --------------------
// Legacy players: string[]
// (keep these so existing code doesn't break)
// --------------------
export async function loadPlayers(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PLAYERS);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const cleaned = parsed
      .map((x) => String(x))
      .map((s) => s.trim())
      .filter(Boolean);

    return cleaned.length >= 2 ? cleaned : null;
  } catch {
    return null;
  }
}

export async function savePlayers(players: string[]): Promise<void> {
  try {
    const trimmed = players.map((p) => p.trim()).filter(Boolean);
    await AsyncStorage.setItem(KEY_PLAYERS, JSON.stringify(trimmed.slice(0, 32)));
  } catch {
    // ignore
  }
}

// --------------------
// ✅ NEW Player Profiles
// --------------------
function mkIdFromName(name: string) {
  // stable-ish id for migration; new players should use a uuid/timestamp
  const base = name.trim().toLowerCase().replace(/\s+/g, "_");
  return `p_${base}_${Math.random().toString(16).slice(2)}`;
}

function cleanName(name: any) {
  return String(name ?? "").trim();
}

function dedupeProfiles(profiles: PlayerProfile[]) {
  const seen = new Set<string>();
  const out: PlayerProfile[] = [];
  for (const p of profiles) {
    const nm = cleanName(p?.name);
    if (!nm) continue;
    const key = nm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(p?.id || mkIdFromName(nm)),
      name: nm,
      nick: p?.nick ? String(p.nick) : undefined,
      avatar: p?.avatar ? String(p.avatar) : undefined,
    });
  }
  return out;
}

export async function loadPlayerProfiles(): Promise<PlayerProfile[]> {
  try {
    // 1) Try new storage first
    const raw = await AsyncStorage.getItem(KEY_PLAYER_PROFILES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return dedupeProfiles(parsed as PlayerProfile[]);
      }
    }

    // 2) Back-compat: migrate from legacy string[] players
    const legacy = await loadPlayers();
    if (legacy && legacy.length) {
      const migrated = dedupeProfiles(
        legacy.map((name) => ({
          id: mkIdFromName(name),
          name,
        }))
      );
      await AsyncStorage.setItem(KEY_PLAYER_PROFILES, JSON.stringify(migrated));
      return migrated;
    }

    return [];
  } catch {
    return [];
  }
}

export async function savePlayerProfiles(profiles: PlayerProfile[]): Promise<void> {
  try {
    const cleaned = dedupeProfiles(profiles);

    // save new format
    await AsyncStorage.setItem(KEY_PLAYER_PROFILES, JSON.stringify(cleaned));

    // also keep legacy list in sync (optional but handy)
    const names = cleaned.map((p) => p.name);
    await AsyncStorage.setItem(KEY_PLAYERS, JSON.stringify(names));
  } catch {
    // ignore
  }
}

// --------------------
// ✅ NEW In-Game selection (right column)
// --------------------
export async function loadInGamePlayerIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_IN_GAME_IDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveInGamePlayerIds(ids: string[]): Promise<void> {
  try {
    const cleaned = ids.map((x) => String(x)).filter(Boolean);
    await AsyncStorage.setItem(KEY_IN_GAME_IDS, JSON.stringify(cleaned.slice(0, 16)));
  } catch {
    // ignore
  }
}

// --------------------
// Setup load/save (unchanged, but kept here)
// --------------------
function asBool(v: any) {
  return !!v;
}
function asNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asRule(v: any): "STRAIGHT" | "DOUBLE" | "MASTER" | null {
  return v === "STRAIGHT" || v === "DOUBLE" || v === "MASTER" ? v : null;
}
function asGolfCellMode(v: any): "HOLE" | "TOTAL" | null {
  return v === "HOLE" || v === "TOTAL" ? v : null;
}

export async function loadSetup(): Promise<PersistedSetup | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SETUP);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedSetup>;
    if (!parsed || typeof parsed !== "object") return null;

    const startScore = asNum((parsed as any).startScore, NaN);
    const inRule = asRule((parsed as any).inRule);
    const outRule = asRule((parsed as any).outRule);
    if (!Number.isFinite(startScore)) return null;
    if (!inRule || !outRule) return null;

    const side = (parsed as any).side;
    if (!side || typeof side !== "object") return null;

    const base: PersistedSetup = {
      startScore,
      inRule,
      outRule,
      side: {
        scoreBonusOn: asBool(side.scoreBonusOn),
        scoreBonusThreshold: asNum(side.scoreBonusThreshold, 0),
        scoreBonusValue: asNum(side.scoreBonusValue, 0),

        scoreJackpotOn: asBool(side.scoreJackpotOn),
        scoreJackpotThreshold: asNum(side.scoreJackpotThreshold, 0),
        scoreJackpotValue: asNum(side.scoreJackpotValue, 0),

        checkoutBonusOn: asBool(side.checkoutBonusOn),
        checkoutBonusThreshold: asNum(side.checkoutBonusThreshold, 0),
        checkoutBonusValue: asNum(side.checkoutBonusValue, 0),

        checkoutJackpotOn: asBool(side.checkoutJackpotOn),
        checkoutJackpotThreshold: asNum(side.checkoutJackpotThreshold, 0),
        checkoutJackpotValue: asNum(side.checkoutJackpotValue, 0),

        bullOn: asBool(side.bullOn),
        bullValue: asNum(side.bullValue, 0),

        gameWinnerOn: asBool(side.gameWinnerOn),
        entry: asNum(side.entry, 0),
      },
      golf: undefined,
    };

    const golf = (parsed as any).golf;
    if (golf && typeof golf === "object") {
      const selectedRaw = Array.isArray(golf.selected) ? golf.selected : null;
      const selected =
        selectedRaw && selectedRaw.length === 19
          ? selectedRaw.map((x: any) => !!x)
          : (() => {
              const arr = Array(19).fill(false) as boolean[];
              for (let i = 1; i <= 18; i++) arr[i] = true;
              return arr;
            })();

      const golfSide = golf.side && typeof golf.side === "object" ? golf.side : {};

      const cellMode = asGolfCellMode(golf.cellMode) ?? "HOLE";

      const tieOn = typeof golfSide.tieOn === "boolean" ? asBool(golfSide.tieOn) : true;
      const tieDivisor = Math.max(1, Math.floor(asNum(golfSide.tieDivisor, 5)));

      const nassauFrontResolveAfter9 =
        typeof golfSide.nassauFrontResolveAfter9 === "boolean"
          ? asBool(golfSide.nassauFrontResolveAfter9)
          : false;

      base.golf = {
        selected,
        bullOn: asBool(golf.bullOn),
        nassau: asBool(golf.nassau),
        cellMode,
        side: {
          enabled: asBool(golfSide.enabled),

          placementOn: asBool(golfSide.placementOn),
          placement: Array.isArray(golfSide.placement)
            ? golfSide.placement.map((x: any) => asNum(x, 0))
            : [],

          nassauOn: asBool(golfSide.nassauOn),
          nassauBack9Double: asBool(golfSide.nassauBack9Double),

          nassauFrontResolveAfter9,

          tieOn,
          tieDivisor,

          eagleBonusOn: asBool(golfSide.eagleBonusOn),
          eagleBonusValue: asNum(golfSide.eagleBonusValue, 30),
          eagleBonusCount: Math.max(1, Math.floor(asNum(golfSide.eagleBonusCount, 2))),

          eagleJackpotOn: asBool(golfSide.eagleJackpotOn),
          eagleJackpotValue: asNum(golfSide.eagleJackpotValue, 50),
          eagleJackpotCount: Math.max(1, Math.floor(asNum(golfSide.eagleJackpotCount, 3))),

          roundBonusOn: asBool(golfSide.roundBonusOn),
          roundBonusValue: asNum(golfSide.roundBonusValue, 30),
          roundBonusThreshold: asNum(golfSide.roundBonusThreshold, 5),

          roundJackpotOn: asBool(golfSide.roundJackpotOn),
          roundJackpotValue: asNum(golfSide.roundJackpotValue, 50),
          roundJackpotThreshold: asNum(golfSide.roundJackpotThreshold, 0),
        },
      };
    }

    return base;
  } catch {
    return null;
  }
}

export async function saveSetup(setup: PersistedSetup): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SETUP, JSON.stringify(setup));
  } catch {
    // ignore
  }
}
