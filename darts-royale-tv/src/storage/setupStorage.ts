// src/storage/setupStorage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PLAYERS = "dartsroyale_players_v1"; // legacy: string[]
// shared (legacy)
const KEY_SETUP = "dartsroyale_setup_v2";

// new per-game keys
const KEY_MATCH_SETUP = "dartsroyale_match_setup_v1";
const KEY_CRICKET_SETUP = "dartsroyale_cricket_setup_v1";
const KEY_GOLF_SETUP = "dartsroyale_golf_setup_v1";
const KEY_KILLER_SETUP = "dartsroyale_killer_setup_v1";

// ✅ Player DB + selection
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

export type PersistedGolfSetup = {
  players?: string[];
  golf: NonNullable<PersistedSetup["golf"]>;
  golfHandicap?: NonNullable<PersistedGolfOnly["golfHandicap"]>;
};

export type PersistedSetup = {
  // Match
  closestToBull?: boolean;
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

  // ✅ remember last "In Game" list (names, in play order)
  inGamePlayers?: string[];

  // ✅ Golf
  golf?: {
    selected: boolean[]; // length 19, index 1..18 used
    bullOn: boolean;
    nassau: boolean;

    // Score display on holes
    cellMode?: "HOLE" | "TOTAL";
    showNetScore?: boolean;

    side: {
      enabled: boolean;

      placementOn: boolean;
      placement: number[];

      // Nassau (Option A)
      nassauOn: boolean;
      nassauFrontOn: boolean;
      nassauBackOn: boolean;
      nassauOverallOn: boolean;
      nassauBackMultiplier: 1 | 2;

      nassauFrontResolveAfter9?: boolean;

      tieOn?: boolean;
      tieDivisor?: number;

      eagleBonusOn: boolean;
      eagleBonusValue: number;
      eagleBonusCount: number;

      eagleJackpotOn: boolean;
      eagleJackpotValue: number;
      eagleJackpotCount: number;

      eagleStreakOptOut?: string[];

      roundBonusOn: boolean;
      roundBonusValue: number;
      roundBonusThreshold: number;

      roundJackpotOn: boolean;
      roundJackpotValue: number;
      roundJackpotThreshold: number;
    };
  };

  // (future)
  cricket?: any;
};

export type PersistedKillerSetup = {
  inGamePlayers?: { name: string; playerColor: string }[] | string[]; // names only (legacy) or name+color
  closestToBull?: boolean;
  placementRewardsOn?: boolean;
  placementRewardAmounts?: number[];
  checkInPoints?: number; // legacy
  armPoints?: number;
  armMode?: "points" | "double" | "treble";
  lives?: number;
  recharge?: boolean;
  /** When ON, must have full lives to arm/rearm. Only available when Recharge is ON. */
  fullLivesToArm?: boolean;
  rechargeToRearm?: boolean;
  shieldOn?: boolean;
  turnKillCap?: number;
  killRewardsOn?: boolean;
  killRewardValue?: number;
  darkMode?: boolean;
  numberLayout?: "shuffle" | "balanced";
};

// --------------------
// Helpers
// --------------------
function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

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
function asStringArray(v: any): string[] | null {
  if (!Array.isArray(v)) return null;
  const cleaned = v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return cleaned;
}

// --------------------
// Legacy players: string[]
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

    return cleaned.length >= 1 ? cleaned : null;
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
// ✅ Player Profiles
// --------------------
function mkIdFromName(name: string) {
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
    const nm = cleanName((p as any)?.name);
    if (!nm) continue;
    const key = nm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: String((p as any)?.id || mkIdFromName(nm)),
      name: nm,
      nick: (p as any)?.nick ? String((p as any).nick) : undefined,
      avatar: (p as any)?.avatar ? String((p as any).avatar) : undefined,
    });
  }
  return out;
}

export async function loadPlayerProfiles(): Promise<PlayerProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PLAYER_PROFILES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return dedupeProfiles(parsed as PlayerProfile[]);
    }

    // Back-compat migrate from legacy players list
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

    await AsyncStorage.setItem(KEY_PLAYER_PROFILES, JSON.stringify(cleaned));

    // keep legacy list in sync (optional)
    const names = cleaned.map((p) => p.name);
    await AsyncStorage.setItem(KEY_PLAYERS, JSON.stringify(names));
  } catch {
    // ignore
  }
}

// --------------------
// ✅ In-Game selection (IDs)
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
// Legacy shared setup load/save (kept for back-compat)
// IMPORTANT: saveSetup MERGES instead of overwriting.
// --------------------
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

    const inGamePlayers = asStringArray((parsed as any).inGamePlayers) ?? undefined;

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
      inGamePlayers,
      golf: undefined,
      cricket: (parsed as any).cricket,
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
      const showNetScore = typeof golf.showNetScore === "boolean" ? golf.showNetScore : false;

      const tieOn = typeof golfSide.tieOn === "boolean" ? asBool(golfSide.tieOn) : true;
      const tieDivisor = Math.max(1, Math.floor(asNum(golfSide.tieDivisor, 5)));

      const nassauFrontResolveAfter9 =
        typeof golfSide.nassauFrontResolveAfter9 === "boolean"
          ? asBool(golfSide.nassauFrontResolveAfter9)
          : false;

      const oldDouble = asBool(golfSide.nassauBack9Double);
      const multRaw = asNum(golfSide.nassauBackMultiplier, oldDouble ? 2 : 1);
      const nassauBackMultiplier = (multRaw >= 2 ? 2 : 1) as 1 | 2;

      const nassauOn = asBool(golfSide.nassauOn);
      const nassauFrontOn =
        typeof golfSide.nassauFrontOn === "boolean" ? asBool(golfSide.nassauFrontOn) : nassauOn;
      const nassauBackOn =
        typeof golfSide.nassauBackOn === "boolean" ? asBool(golfSide.nassauBackOn) : nassauOn;
      const nassauOverallOn =
        typeof golfSide.nassauOverallOn === "boolean" ? asBool(golfSide.nassauOverallOn) : nassauOn;

      base.golf = {
        selected,
        bullOn: asBool(golf.bullOn),
        nassau: asBool(golf.nassau),
        cellMode,
        showNetScore,
        side: {
          enabled: asBool(golfSide.enabled),

          placementOn: asBool(golfSide.placementOn),
          placement: Array.isArray(golfSide.placement)
            ? golfSide.placement.map((x: any) => asNum(x, 0))
            : [],

          nassauOn,
          nassauFrontOn,
          nassauBackOn,
          nassauOverallOn,
          nassauBackMultiplier,
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
    // ✅ merge with existing so other screens can't accidentally wipe unrelated blocks
    const prev = safeJsonParse<any>(await AsyncStorage.getItem(KEY_SETUP)) ?? {};
    const merged = {
      ...prev,
      ...setup,
      golf: setup.golf ?? prev.golf,
      cricket: (setup as any).cricket ?? prev.cricket,
      inGamePlayers: setup.inGamePlayers ?? prev.inGamePlayers,
    };
    await AsyncStorage.setItem(KEY_SETUP, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

// ========================
// MATCH SETUP (separate key)
// ========================
export async function loadMatchSetup(): Promise<PersistedSetup | null> {
  const raw = await AsyncStorage.getItem(KEY_MATCH_SETUP);
  const parsed = safeJsonParse<PersistedSetup>(raw);
  if (parsed) return parsed;

  // fallback to legacy shared key (one-time migration)
  const legacy = await loadSetup();
  return legacy ?? null;
}

export async function saveMatchSetup(data: PersistedSetup) {
  // save match-only
  await AsyncStorage.setItem(KEY_MATCH_SETUP, JSON.stringify(data));

  // also update legacy shared key (merged) for any older code paths
  await saveSetup(data);
}

// ========================
// GOLF SETUP (separate key) - Golf-only payload
// ========================
export type PersistedGolfOnly = {
  inGamePlayers?: string[];
  closestToBull?: boolean;
  golfHandicap?: {
    handicapsEnabled?: boolean;
    settings?: {
      applyHandicaps?: boolean;
      updateHandicaps?: boolean;
      roundsWindowY?: number;
      roundsCountedX?: number;
      minRoundsRequired?: number;
      roundsDisplayedN?: number;
    };
    scoresByPlayer?: Record<string, number[]>;
    handicapOverrides?: Record<string, number>;
    /** Personal Best (lowest gross score) per player; updated when round completes with Update Handicaps on */
    personalBestByPlayer?: Record<string, number>;
  };
  golf: {
    selected: boolean[]; // length 19
    bullOn: boolean;
    nassau: boolean;
    cellMode?: "HOLE" | "TOTAL";
    showNetScore?: boolean;
    side: any;
  };
};

export async function loadGolfSetup(): Promise<PersistedGolfOnly | null> {
  try {
    // 1) preferred: golf-only key
    const raw = await AsyncStorage.getItem(KEY_GOLF_SETUP);
    const parsed = safeJsonParse<PersistedGolfOnly>(raw);
    if (parsed && parsed.golf) return parsed;

    // 2) fallback: legacy shared key (if older builds stored it there)
    const rawPrev = await AsyncStorage.getItem(KEY_SETUP);
    const prev = safeJsonParse<any>(rawPrev) ?? null;
    if (prev?.golf) {
      return {
        inGamePlayers: Array.isArray(prev.inGamePlayers) ? prev.inGamePlayers : undefined,
        golfHandicap: prev.golfHandicap,
        golf: prev.golf,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function saveGolfSetup(data: PersistedGolfOnly): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_GOLF_SETUP, JSON.stringify(data));

    // optional: also mirror into legacy shared key, but do it RAW (no validation)
    const rawPrev = await AsyncStorage.getItem(KEY_SETUP);
    const prev = safeJsonParse<any>(rawPrev) ?? {};
    const merged = {
      ...prev,
      inGamePlayers: data.inGamePlayers ?? prev.inGamePlayers,
      golfHandicap: data.golfHandicap ?? prev.golfHandicap,
      golf: data.golf ?? prev.golf,
    };
    await AsyncStorage.setItem(KEY_SETUP, JSON.stringify(merged));
  } catch {
    // ignore
  }
}


// ========================
// CRICKET SETUP (separate key) - optional use now or later
// ========================
export async function loadCricketSetup(): Promise<any | null> {
  const raw = await AsyncStorage.getItem(KEY_CRICKET_SETUP);
  const parsed = safeJsonParse<any>(raw);
  if (parsed) return parsed;

  const legacy = await loadSetup();
  return (legacy as any)?.cricket ?? null;
}

export async function saveCricketSetup(cricket: any) {
  await AsyncStorage.setItem(KEY_CRICKET_SETUP, JSON.stringify(cricket));
  const legacy = (await loadSetup()) ?? ({} as any);
  await saveSetup({ ...(legacy as any), cricket } as PersistedSetup);
}

// ========================
// KILLER SETUP
// ========================
export async function loadKillerSetup(): Promise<PersistedKillerSetup | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_KILLER_SETUP);
    const parsed = safeJsonParse<PersistedKillerSetup>(raw);
    return parsed ?? null;
  } catch {
    return null;
  }
}

export async function saveKillerSetup(data: PersistedKillerSetup): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_KILLER_SETUP, JSON.stringify(data));
  } catch {
    // ignore
  }
}

// ========================
// Auto-reset overlay: When ON, show overlay when auto-resets run (CtB open, game start 10s, CtB takeout 5s). When OFF, no overlay. All auto-resets always run; toggle only controls overlay visibility.
// ========================
const KEY_AUTO_RESET_OVERLAY = "dartsroyale_auto_reset_overlay_v1";

export async function loadAutoResetOverlayEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEY_AUTO_RESET_OVERLAY);
  return raw === "true";
}

export async function saveAutoResetOverlayEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_AUTO_RESET_OVERLAY, enabled ? "true" : "false");
}
