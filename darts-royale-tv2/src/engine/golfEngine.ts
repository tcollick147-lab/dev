// src/engine/golfEngine.ts

export type Hole = number | "BULL";
export type HoleScore = -2 | -1 | 0 | 1 | 2;

// Touchscreen dart result (what Golf needs)
export type GolfDart =
  | { kind: "MISS" }
  | { kind: "SB" } // 25
  | { kind: "DB" } // 50
  | { kind: "S_IN"; n: number }
  | { kind: "S_OUT"; n: number }
  | { kind: "D"; n: number }
  | { kind: "T"; n: number };

  
export type PlayerState = {
  name: string;
  holeIndex: number; // next hole index
  holeDarts: GolfDart[];
  scores: (HoleScore | null)[];
  total: number;
};

export type GolfEvent =
  | {
      kind: "DART";
      playerIndex: number;
      hole: Hole;
      dart: GolfDart;
      scorePreview: HoleScore;
      label: string;
    }
  | { kind: "HOLE"; playerIndex: number; hole: Hole; finalScore: HoleScore; label: string }
  | { kind: "DONE"; label: string }
  | { kind: "REWARD"; playerIndex: number; amount: number; label: string };

// ✅ Marks for eagle streak display in UI
export type EagleRewardMark = "EAGLE" | "BONUS" | "JACKPOT" | null;

// ---------- Side games (Golf) ----------
export type GolfSide = {
  // ✅ master toggle - NOTHING pays unless this is true
  enabled: boolean;

  // 7.1 Podium rewards (placements)
  // ✅ Placement table is ALWAYS available and used by both Podium + Nassau
  // ✅ Values are interpreted as "per-opponent transfer units" (your model)
  placementOn: boolean;
  placement: number[]; // 1st..Nth per-opponent amounts, length = playerCount

  // 7.2 Nassau (Option A)
  nassauOn: boolean;
  nassauFrontOn: boolean;
  nassauBackOn: boolean;
  nassauOverallOn: boolean;

  // back leg multiplier (1x / 2x)
  nassauBackMultiplier: 1 | 2;

  // ✅ allow front-9 playoff/tie resolution after hole 9 completes
  nassauFrontResolveAfter9: boolean;

  // 7.3 Eagle Streak
  eagleBonusOn: boolean;
  eagleBonusValue: number;
  eagleBonusCount: number;

  eagleJackpotOn: boolean;
  eagleJackpotValue: number;
  eagleJackpotCount: number;

  /** Player names who opted out of Eagle Streak Bonus & Jackpot (no payout for them). */
  eagleStreakOptOut?: string[];

  // 7.4 Total Round Score
  roundBonusOn: boolean;
  roundBonusValue: number;
  roundBonusThreshold: number; // e.g. +5

  roundJackpotOn: boolean;
  roundJackpotValue: number;
  roundJackpotThreshold: number; // e.g. 0 (Par)

  // ✅ tie/playoff policy
  tiesAllowed: boolean; // allow “keep tie and share”
  playoffsAllowed: boolean; // allow prompting to break ties with a playoff
  tieDivisor: number; // only offer tie mode if net share divisible by this (default 5)
};

export type GolfRewardsBreakdown = {
  podium: number[];
  nassau: number[];
  streak: number[];
  roundScore: number[];
  total: number[];
};

// ✅ Tie / playoff support
export type PlayoffKind = "PODIUM" | "NASSAU_FRONT" | "NASSAU_BACK" | "NASSAU_OVERALL";
export type PlayoffMode = "PLAYOFF" | "TIE";

/** Resolution for one tie group (keyed by group.startPos). */
export type PlayoffResolution = { mode: PlayoffMode; order: number[] | null };

export type GolfPlayoffs = {
  /** Resolutions per tie group, keyed by startPos (e.g. "0" = first group, "3" = group at positions 3–4). */
  podiumResolutions: Record<string, PlayoffResolution>;
  nassauFrontResolutions: Record<string, PlayoffResolution>;
  nassauBackResolutions: Record<string, PlayoffResolution>;
  nassauOverallResolutions: Record<string, PlayoffResolution>;
};

/** Groups that need resolution per kind (1, 2, 3, or more depending on ties). */
export type PlayoffNeeds = {
  podiumTieGroups: TieGroup[];
  nassauFrontTieGroups: TieGroup[];
  nassauBackTieGroups: TieGroup[];
  nassauOverallTieGroups: TieGroup[];
};

export type TieGroup = {
  // position slice [startPos, endPos)
  startPos: number;
  endPos: number;
  tiedPlayerIndices: number[];
  // raw totals used for tie detection (lower is better)
  totals: number[];
};

export type PlayoffOptions = {
  tiedPlayerIndices: number[];
  canTie: boolean;
  canPlayoff: boolean;
  reasonIfNoTie?: string;
};

/** Optional net (or other) totals per leg for tie/playoff detection when e.g. handicaps are applied. */
export type PlayoffTotalsOverrides = {
  podium?: number[];
  nassauFront?: number[];
  nassauBack?: number[];
  nassauOverall?: number[];
};

export type GolfState = {
  holes: Hole[];
  players: PlayerState[];
  currentPlayerIndex: number;

  isComplete: boolean;
  winnerIndices: number[] | null;

  // side config
  side: GolfSide;

  // ✅ Eagle streak tracking (counts consecutive eagles)
  eagleStreak: number[];

  // ✅ track whether the bonus was already paid in the current streak
  eagleBonusPaid: boolean[];

  // ✅ marks where streak events happened (by hole index)
  eagleRewardMark: EagleRewardMark[][];

  // ✅ rewards (live)
  rewards: GolfRewardsBreakdown;

  // ✅ playoff resolutions (tie breakers)
  playoffs: GolfPlayoffs;

  events: GolfEvent[];
  history: GolfState[];
  future: GolfState[];

  /** When set (e.g. by UI when handicaps applied), placement/Nassau rewards use these net totals instead of gross. */
  placementTotalsOverrides?: PlayoffTotalsOverrides | null;

  /** Per-player handicap (same order as players). When set, engine computes net totals for placement/Nassau. */
  placementHandicaps?: number[] | null;
};

export function defaultHoles18Bull(): Hole[] {
  return [...Array.from({ length: 18 }, (_, i) => i + 1), "BULL"];
}

// ---------- Creation ----------
export function createGolfState(opts: { playerNames: string[]; holes?: Hole[]; side?: Partial<GolfSide> }): GolfState {
  const holes = opts.holes ?? defaultHoles18Bull();

  const players: PlayerState[] = opts.playerNames.map((name) => ({
    name,
    holeIndex: 0,
    holeDarts: [],
    scores: Array(holes.length).fill(null),
    total: 0,
  }));

  const playerCount = players.length;

  // default placement: +10 for 1st, -10 for last, 0 otherwise
  const fallbackPlacement = Array.from({ length: playerCount }, (_, i) => (i === 0 ? 10 : i === playerCount - 1 ? -10 : 0));

  const rawPlacement =
    opts.side?.placement?.length === playerCount ? [...opts.side.placement] : fallbackPlacement;

  const side: GolfSide = normalizeSide(
    {
      enabled: false,

      placementOn: false,
      placement: rawPlacement,

      nassauOn: false,
      nassauFrontOn: true,
      nassauBackOn: true,
      nassauOverallOn: true,
      nassauBackMultiplier: 1,
      nassauFrontResolveAfter9: false,

      eagleBonusOn: false,
      eagleBonusValue: 30,
      eagleBonusCount: 2,

      eagleJackpotOn: false,
      eagleJackpotValue: 50,
      eagleJackpotCount: 3,

      roundBonusOn: false,
      roundBonusValue: 30,
      roundBonusThreshold: 5,

      roundJackpotOn: false,
      roundJackpotValue: 50,
      roundJackpotThreshold: 0,

      tiesAllowed: true,
      playoffsAllowed: true,
      tieDivisor: 5,
    },
    playerCount,
    opts.side
  );

  const zero = Array(playerCount).fill(0);

  const marks: EagleRewardMark[][] = Array.from({ length: playerCount }, () => Array(holes.length).fill(null));

  const s: GolfState = {
    holes,
    players,
    currentPlayerIndex: 0,
    isComplete: false,
    winnerIndices: null,

    side,
    eagleStreak: Array(playerCount).fill(0),
    eagleBonusPaid: Array(playerCount).fill(false),
    eagleRewardMark: marks,

    rewards: {
      podium: [...zero],
      nassau: [...zero],
      streak: [...zero],
      roundScore: [...zero],
      total: [...zero],
    },

    playoffs: {
      podiumResolutions: {},
      nassauFrontResolutions: {},
      nassauBackResolutions: {},
      nassauOverallResolutions: {},
    },

    events: [],
    history: [],
    future: [],
  };

  return recomputeAllRewards(s);
}

function normalizeSide(base: GolfSide, playerCount: number, patch?: Partial<GolfSide>): GolfSide {
  const merged: GolfSide = { ...base, ...(patch ?? {}) };

  merged.placement = normalizePlacementToPlayerCount(merged.placement ?? [], playerCount);

  merged.eagleBonusCount = Math.max(1, Math.floor(Number(merged.eagleBonusCount ?? 2)));
  merged.eagleJackpotCount = Math.max(1, Math.floor(Number(merged.eagleJackpotCount ?? 3)));

  merged.eagleBonusValue = num(merged.eagleBonusValue, 30);
  merged.eagleJackpotValue = num(merged.eagleJackpotValue, 50);

  merged.roundBonusValue = num(merged.roundBonusValue, 30);
  merged.roundJackpotValue = num(merged.roundJackpotValue, 50);
  merged.roundBonusThreshold = num(merged.roundBonusThreshold, 5);
  merged.roundJackpotThreshold = num(merged.roundJackpotThreshold, 0);

  merged.nassauOn = !!merged.nassauOn;
  merged.nassauFrontOn = merged.nassauOn ? !!merged.nassauFrontOn : false;
  merged.nassauBackOn = merged.nassauOn ? !!merged.nassauBackOn : false;
  merged.nassauOverallOn = merged.nassauOn ? !!merged.nassauOverallOn : false;

  const multRaw = Number((merged as any).nassauBackMultiplier);
  merged.nassauBackMultiplier = (multRaw >= 2 ? 2 : 1) as 1 | 2;

  merged.nassauFrontResolveAfter9 = !!merged.nassauFrontResolveAfter9;

  merged.tiesAllowed = !!merged.tiesAllowed;
  merged.playoffsAllowed = !!merged.playoffsAllowed;
  merged.tieDivisor = Math.max(1, Math.floor(num(merged.tieDivisor, 5)));

  merged.eagleStreakOptOut = Array.isArray(merged.eagleStreakOptOut) ? merged.eagleStreakOptOut : [];

  // ✅ Safety: at least one must be active (UI should enforce too)
  if (!merged.tiesAllowed && !merged.playoffsAllowed) {
    merged.playoffsAllowed = true;
  }

  return merged;
}

function num(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------- Undo / Redo helpers ----------
function stripStacks(s: GolfState): GolfState {
  return { ...s, history: [], future: [] };
}

function deepClone(s: GolfState): GolfState {
  return {
    ...s,
    holes: [...s.holes],
    players: s.players.map((p) => ({
      ...p,
      holeDarts: [...p.holeDarts],
      scores: [...p.scores],
    })),
    side: { ...s.side, placement: [...(s.side?.placement ?? [])] },
    eagleStreak: [...(s.eagleStreak ?? [])],
    eagleBonusPaid: [...(s.eagleBonusPaid ?? [])],
    eagleRewardMark: (s.eagleRewardMark ?? []).map((row) => [...row]),
    rewards: {
      podium: [...(s.rewards?.podium ?? [])],
      nassau: [...(s.rewards?.nassau ?? [])],
      streak: [...(s.rewards?.streak ?? [])],
      roundScore: [...(s.rewards?.roundScore ?? [])],
      total: [...(s.rewards?.total ?? [])],
    },
    playoffs: {
      podiumResolutions: { ...(s.playoffs?.podiumResolutions ?? {}) },
      nassauFrontResolutions: { ...(s.playoffs?.nassauFrontResolutions ?? {}) },
      nassauBackResolutions: { ...(s.playoffs?.nassauBackResolutions ?? {}) },
      nassauOverallResolutions: { ...(s.playoffs?.nassauOverallResolutions ?? {}) },
    },
    events: [...s.events],
    history: [...s.history],
    future: [...s.future],
    placementTotalsOverrides: s.placementTotalsOverrides,
    placementHandicaps: s.placementHandicaps,
  };
}

function pushHistory(base: GolfState): GolfState {
  const s2 = deepClone(base);
  s2.history = [...base.history, stripStacks(base)];
  s2.future = [];
  return s2;
}

function computePlacementDeltasFromTotals(totals: number[], placement: number[]) {
  const n = totals.length;
  const deltas = Array(n).fill(0);

  // lower is better
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => totals[a] - totals[b]);

  let pos = 0;
  while (pos < n) {
    const start = pos;
    const t = totals[order[pos]];
    while (pos < n && totals[order[pos]] === t) pos++;
    const end = pos;

    const tied = order.slice(start, end);
    const k = tied.length;

    let payoutSum = 0;
    for (let j = 0; j < k; j++) payoutSum += Number(placement[start + j] ?? 0);

    const each = k ? payoutSum / k : 0;
    for (const playerIdx of tied) deltas[playerIdx] = each;
  }

  return deltas;
}


export function undo(s: GolfState): GolfState {
  if (!s.history.length) return s;
  const prev = s.history[s.history.length - 1];
  const restored: GolfState = {
    ...prev,
    history: s.history.slice(0, -1),
    future: [stripStacks(s), ...s.future],
  };
  return recomputeAllRewards(restored);
}

export function redo(s: GolfState): GolfState {
  if (!s.future.length) return s;
  const next = s.future[0];
  const restored: GolfState = {
    ...next,
    history: [...s.history, stripStacks(s)],
    future: s.future.slice(1),
  };
  return recomputeAllRewards(restored);
}

// ---------- Rules evaluation ----------
function currentHole(s: GolfState, player: PlayerState): Hole | null {
  if (player.holeIndex >= s.holes.length) return null;
  return s.holes[player.holeIndex];
}

type Eval = {
  score: HoleScore;
  label: string;
  isEagle: boolean;
  isDoubleBogey: boolean;
};

export function evalDart(hole: Hole, dart: GolfDart): Eval {
  if (hole === "BULL") {
    if (dart.kind === "DB") return { score: -2, label: "Red Bull (Eagle)", isEagle: true, isDoubleBogey: false };
    if (dart.kind === "SB") return { score: 0, label: "Single Bull (Par)", isEagle: false, isDoubleBogey: false };
    return { score: 2, label: "No Score (Double Bogey)", isEagle: false, isDoubleBogey: true };
  }

  if (dart.kind === "D" && dart.n === hole) return { score: -2, label: "Double (Eagle)", isEagle: true, isDoubleBogey: false };
  if (dart.kind === "T" && dart.n === hole) return { score: -1, label: "Treble (Birdie)", isEagle: false, isDoubleBogey: false };
  if (dart.kind === "S_IN" && dart.n === hole) return { score: 0, label: "Single Inner (Par)", isEagle: false, isDoubleBogey: false };
  if (dart.kind === "S_OUT" && dart.n === hole) return { score: 1, label: "Single Outer (Bogey)", isEagle: false, isDoubleBogey: false };

  return { score: 2, label: "No Score (Double Bogey)", isEagle: false, isDoubleBogey: true };
}

// ---------- Placement / Nassau helpers ----------
function normalizePlacementToPlayerCount(raw: number[], playerCount: number) {
  // NOTE: DO NOT force sum=0 here anymore; Setup/UI enforces it if desired.
  // Still normalize length.
  return Array.from({ length: playerCount }, (_, i) => Number(raw?.[i] ?? 0));
}

function isPermutation(order: number[] | null, n: number) {
  if (!order || order.length !== n) return false;
  const seen = new Set<number>();
  for (const x of order) {
    if (!Number.isInteger(x)) return false;
    if (x < 0 || x >= n) return false;
    seen.add(x);
  }
  return seen.size === n;
}

function isPermutationOfSet(order: number[] | null, allowed: number[]) {
  if (!order) return false;
  if (order.length !== allowed.length) return false;
  const set = new Set(allowed);
  const seen = new Set<number>();
  for (const x of order) {
    if (!Number.isInteger(x)) return false;
    if (!set.has(x)) return false;
    seen.add(x);
  }
  return seen.size === set.size;
}

// ----------
// ✅ Your model helpers
// Placement values are "per-opponent transfer amounts"
// Net amount = perOpponent * (n-1)
// ----------
function perOpponentToNet(perOpp: number, n: number, multiplier = 1) {
  const v = (Number(perOpp) || 0) * (Number(multiplier) || 1);
  return v * Math.max(0, n - 1);
}

function computeNetFromTotals(totals: number[], placement: number[], multiplier = 1) {
  const n = totals.length;
  const net = Array(n).fill(0);

  // lower is better
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => totals[a] - totals[b]
  );

  let pos = 0;
  while (pos < n) {
    const start = pos;
    const t = totals[order[pos]];
    while (pos < n && totals[order[pos]] === t) pos++;
    const end = pos;

    const tied = order.slice(start, end); // players tied for positions [start..end-1]
    const k = tied.length;

    // average the placement slots they occupy
    let sum = 0;
    for (let p = start; p < end; p++) sum += placement[p] ?? 0;
    const avg = (k > 0 ? sum / k : 0) * multiplier;

    for (const playerIndex of tied) {
      net[playerIndex] = avg;
    }
  }

  return net;
}

function computeNetFromOrder(order: number[], placement: number[], mult: number): number[] {
  const n = order.length;
  const net = Array(n).fill(0);

  for (let pos = 0; pos < n; pos++) {
    const playerIndex = order[pos];
    const v = placement[pos] ?? 0;
    net[playerIndex] = v * mult;
  }

  return net;
}



// ---------- Order / tie helpers (ADD THESE) ----------

function computeDeltasFromOrder(order: number[], placement: number[]) {
const n = order.length;
const deltas = Array(n).fill(0);
for (let pos = 0; pos < n; pos++) {
const playerIdx = order[pos];
deltas[playerIdx] = Number(placement[pos] ?? 0);
}
return deltas;
}

/**
 * Tie split for one tie group (Nassau legs). Same placement-from-settings logic as classic (tieSplitForGroup_NET).
 * Placement amounts come from settings (variable). Only the tied slice is split; non-tied keep their placement value.
 */
function tieSplitForGroup(
  n: number,
  placement: number[],
  group: { startPos: number; endPos: number; tiedPlayerIndices: number[]; totals: number[] },
  divisor: number,
  multiplier = 1
): { ok: boolean; deltas: number[]; eachShare: number; reason?: string } {
  const deltas = Array(n).fill(0);
  const k = group.tiedPlayerIndices.length;

  const baseOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => group.totals[a] - group.totals[b]);

  for (let pos = 0; pos < n; pos++) {
    const playerIdx = baseOrder[pos];
    deltas[playerIdx] = Number(placement[pos] ?? 0) * multiplier;
  }

  let sumSlice = 0;
  for (let pos = group.startPos; pos < group.endPos; pos++) sumSlice += Number(placement[pos] ?? 0);
  const each = (sumSlice / k) * multiplier;

  if (sumSlice % k !== 0) {
    return { ok: false, deltas, eachShare: 0, reason: "Not evenly divisible across tied players" };
  }

  const d = Math.max(1, Math.floor(Number(divisor) || 1));
  if (each % d !== 0) {
    return { ok: false, deltas, eachShare: each, reason: `Each share must be divisible by ${d}` };
  }

  for (const idx of group.tiedPlayerIndices) deltas[idx] = each;

  return { ok: true, deltas, eachShare: each };
}


/**
 * Finds the earliest (best-score) tie group (tie to win).
 * Lower total is better.
 */
function firstTieGroupFromTotals(totals: number[]): TieGroup | null {
  const n = totals.length;
  const indices = Array.from({ length: n }, (_, i) => i).sort((a, b) => totals[a] - totals[b]);

  let pos = 0;
  while (pos < n) {
    const start = pos;
    const t = totals[indices[pos]];
    while (pos < n && totals[indices[pos]] === t) pos++;
    const end = pos;

    const group = indices.slice(start, end);
    if (group.length >= 2) {
      return { startPos: start, endPos: end, tiedPlayerIndices: group, totals };
    }
  }
  return null;
}

/**
 * Finds the latest (worst-score) tie group (tie to lose).
 * Lower total is better, so last group = highest totals.
 */
function lastTieGroupFromTotals(totals: number[]): TieGroup | null {
  const groups = allTieGroupsFromTotals(totals);
  return groups.length > 0 ? groups[groups.length - 1] : null;
}

/**
 * Returns all tie groups from best (position 0) to worst, in order.
 * Number of groups depends on results (e.g. 1, 2, or 3+ when multiple ties).
 */
function allTieGroupsFromTotals(totals: number[]): TieGroup[] {
  const n = totals.length;
  const indices = Array.from({ length: n }, (_, i) => i).sort((a, b) => totals[a] - totals[b]);
  const out: TieGroup[] = [];
  let pos = 0;
  while (pos < n) {
    const start = pos;
    const t = totals[indices[pos]];
    while (pos < n && totals[indices[pos]] === t) pos++;
    const end = pos;
    const group = indices.slice(start, end);
    if (group.length >= 2) {
      out.push({ startPos: start, endPos: end, tiedPlayerIndices: group, totals });
    }
  }
  return out;
}

function isNassauRound(holes: Hole[]) {
  if (holes.length !== 19) return false;
  const hasBull = holes.includes("BULL");
  if (!hasBull) return false;
  for (let i = 1; i <= 18; i++) if (!holes.includes(i)) return false;
  return true;
}

/** Split full handicap for Nassau: front 9 and back 9. Odd gives extra stroke to front 9. Lower is better. */
function splitHandicapForNassau(fullHandicap: number): { front: number; back: number } {
  const abs = Math.abs(fullHandicap);
  return { front: -Math.ceil(abs / 2), back: -Math.floor(abs / 2) };
}

/** Compute net totals for placement/Nassau from state when placementHandicaps is set. Uses gross from scores to avoid double-adding handicap (p.total may already include handicap). */
function computePlacementOverridesFromHandicaps(s: GolfState): PlayoffTotalsOverrides | undefined {
  const n = s.players.length;
  const h = s.placementHandicaps;
  if (!h || h.length !== n) return undefined;

  const idx = holeIndexMap(s.holes);
  const frontIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 1))!).filter(Number.isFinite);
  const backIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 10))!).filter(Number.isFinite);
  const bullIdx = idx.get("BULL");
  if (typeof bullIdx === "number") backIdxs.push(bullIdx);

  const frontGross = legTotals(s.players, frontIdxs);
  const backGross = legTotals(s.players, backIdxs);
  const overallGross = s.players.map((p) => (p.scores as (number | null)[]).reduce<number>((a, v) => a + (v ?? 0), 0));
  const splits = h.map((v) => splitHandicapForNassau(v));

  const podium = overallGross.map((g, i) => g + (h[i] ?? 0));
  const nassauFront = frontGross.map((r, i) => r + (splits[i]?.front ?? 0));
  const nassauBack = backGross.map((r, i) => r + (splits[i]?.back ?? 0));
  return { podium, nassauFront, nassauBack, nassauOverall: podium };
}

function holeIndexMap(holes: Hole[]) {
  const m = new Map<string, number>();
  holes.forEach((h, idx) => m.set(h === "BULL" ? "BULL" : String(h), idx));
  return m;
}

function legComplete(players: PlayerState[], idxs: number[]) {
  return players.every((p) => idxs.every((i) => p.scores[i] !== null));
}

function legTotals(players: PlayerState[], idxs: number[]) {
  return players.map((p) => idxs.reduce((acc, i) => acc + (p.scores[i] ?? 0), 0));
}

// ---------- Rewards core ----------
function rewardsActive(s: GolfState) {
  return !!s.side?.enabled;
}

/**
 * ✅ Zero-sum transfer (per-opponent amount):
 * Winner gets +amount*(n-1), each other player gets -amount.
 */
function applyZeroSumTransfer(arr: number[], winnerIndex: number, amount: number) {
  const n = arr.length;
  if (n <= 1) return;

  const amt = Number(amount) || 0;
  if (amt === 0) return;

  for (let i = 0; i < n; i++) {
    if (i === winnerIndex) continue;
    arr[i] = (arr[i] ?? 0) - amt;
  }
  arr[winnerIndex] = (arr[winnerIndex] ?? 0) + amt * (n - 1);
}

/**
 * ✅ Zero-sum transfer excluding opted-out: only non-excluded players (other than winner) pay.
 * Winner gets +amount * numPayers; each payer pays -amount. Opted-out players neither pay nor receive.
 */
function applyZeroSumTransferExcluding(
  arr: number[],
  winnerIndex: number,
  amount: number,
  excludeIndices: Set<number>
) {
  const n = arr.length;
  if (n <= 1) return;

  const amt = Number(amount) || 0;
  if (amt === 0) return;

  let numPayers = 0;
  for (let i = 0; i < n; i++) {
    if (i === winnerIndex) continue;
    if (excludeIndices.has(i)) continue;
    arr[i] = (arr[i] ?? 0) - amt;
    numPayers += 1;
  }
  arr[winnerIndex] = (arr[winnerIndex] ?? 0) + amt * numPayers;
}

/** Ensure playoffs has the new resolution-map shape; migrate legacy fields so rewards compute correctly. */
function normalizePlayoffsToNewShape(s: GolfState) {
  const p = s.playoffs as Record<string, unknown>;
  const hasNewShape = p.podiumResolutions != null && typeof p.podiumResolutions === "object";
  if (hasNewShape) return;

  const legacy = p as Record<string, unknown>;
  s.playoffs = {
    podiumResolutions: { ...(p.podiumResolutions as Record<string, PlayoffResolution>) ?? {} },
    nassauFrontResolutions: { ...(p.nassauFrontResolutions as Record<string, PlayoffResolution>) ?? {} },
    nassauBackResolutions: { ...(p.nassauBackResolutions as Record<string, PlayoffResolution>) ?? {} },
    nassauOverallResolutions: { ...(p.nassauOverallResolutions as Record<string, PlayoffResolution>) ?? {} },
  };
  const putLegacy = (resolutions: Record<string, PlayoffResolution>, mode: unknown, order: unknown, playerCount: number) => {
    if (mode == null || typeof mode !== "string") return;
    const arr = Array.isArray(order) ? (order as number[]) : null;
    const key = arr && arr.length === playerCount ? "-1" : "0"; // "-1" = full order
    resolutions[key] = { mode: mode as PlayoffMode, order: arr };
  };
  putLegacy(s.playoffs.podiumResolutions, legacy.podiumMode, legacy.podiumOrder, s.players.length);
  putLegacy(s.playoffs.nassauFrontResolutions, legacy.nassauFrontMode, legacy.nassauFrontOrder, s.players.length);
  putLegacy(s.playoffs.nassauBackResolutions, legacy.nassauBackMode, legacy.nassauBackOrder, s.players.length);
  putLegacy(s.playoffs.nassauOverallResolutions, legacy.nassauOverallMode, legacy.nassauOverallOrder, s.players.length);
}

function getResolutionsMap(playoffs: GolfPlayoffs, kind: PlayoffKind): Record<string, PlayoffResolution> {
  if (kind === "PODIUM") return playoffs.podiumResolutions ?? {};
  if (kind === "NASSAU_FRONT") return playoffs.nassauFrontResolutions ?? {};
  if (kind === "NASSAU_BACK") return playoffs.nassauBackResolutions ?? {};
  return playoffs.nassauOverallResolutions ?? {};
}

function getResolution(s: GolfState, kind: PlayoffKind, startPos: number): PlayoffResolution | null {
  const map = getResolutionsMap(s.playoffs, kind);
  return map[String(startPos)] ?? null;
}

const FULL_ORDER_KEY = "-1";

function setResolution(s2: GolfState, kind: PlayoffKind, startPos: number, mode: PlayoffMode, order: number[] | null) {
  const key = startPos === -1 ? FULL_ORDER_KEY : String(startPos);
  const res: PlayoffResolution = { mode, order };
  if (kind === "PODIUM") s2.playoffs.podiumResolutions = { ...s2.playoffs.podiumResolutions, [key]: res };
  if (kind === "NASSAU_FRONT") s2.playoffs.nassauFrontResolutions = { ...s2.playoffs.nassauFrontResolutions, [key]: res };
  if (kind === "NASSAU_BACK") s2.playoffs.nassauBackResolutions = { ...s2.playoffs.nassauBackResolutions, [key]: res };
  if (kind === "NASSAU_OVERALL") s2.playoffs.nassauOverallResolutions = { ...s2.playoffs.nassauOverallResolutions, [key]: res };
}

function clearResolutionsForKind(s2: GolfState, kind: PlayoffKind) {
  if (kind === "PODIUM") s2.playoffs.podiumResolutions = {};
  if (kind === "NASSAU_FRONT") s2.playoffs.nassauFrontResolutions = {};
  if (kind === "NASSAU_BACK") s2.playoffs.nassauBackResolutions = {};
  if (kind === "NASSAU_OVERALL") s2.playoffs.nassauOverallResolutions = {};
}

/**
 * For a given kind, compute the current totals, the first tie group (if any),
 * and the leg multiplier (back leg can be 2x).
 * When totalsOverride is provided (e.g. net totals for handicap), use it for tie detection.
 */
function getTieGroupForKind(
  s: GolfState,
  kind: PlayoffKind,
  totalsOverride?: number[]
): { group: TieGroup | null; placement: number[]; multiplier: number; totals: number[] } {
  const n = s.players.length;
  const placement = normalizePlacementToPlayerCount(s.side.placement ?? [], n);

  if (kind === "PODIUM") {
    const totals = totalsOverride?.length === n ? totalsOverride : s.players.map((p) => p.total);
    return { group: firstTieGroupFromTotals(totals), placement, multiplier: 1, totals };
  }

  if (!(s.side?.nassauOn && isNassauRound(s.holes))) {
    const totals = s.players.map((p) => p.total);
    return { group: null, placement, multiplier: 1, totals };
  }

  const idx = holeIndexMap(s.holes);

  const frontIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 1))!).filter(Number.isFinite);
  const backIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 10))!).filter(Number.isFinite);
  const bullIdx = idx.get("BULL");
  if (typeof bullIdx === "number") backIdxs.push(bullIdx);

  const overallIdxs = [...frontIdxs, ...backIdxs];

  if (kind === "NASSAU_FRONT") {
    const totals = totalsOverride?.length === n ? totalsOverride : legTotals(s.players, frontIdxs);
    if (!legComplete(s.players, frontIdxs)) return { group: null, placement, multiplier: 1, totals };
    return { group: firstTieGroupFromTotals(totals), placement, multiplier: 1, totals };
  }

  if (kind === "NASSAU_BACK") {
    const totals = totalsOverride?.length === n ? totalsOverride : legTotals(s.players, backIdxs);
    const mult = s.side.nassauBackMultiplier ?? 1;
    if (!legComplete(s.players, backIdxs)) return { group: null, placement, multiplier: mult, totals };
    return { group: firstTieGroupFromTotals(totals), placement, multiplier: mult, totals };
  }

  // overall
  const totals = totalsOverride?.length === n ? totalsOverride : legTotals(s.players, overallIdxs);
  if (!legComplete(s.players, overallIdxs)) return { group: null, placement, multiplier: 1, totals };
  return { group: firstTieGroupFromTotals(totals), placement, multiplier: 1, totals };
}

/** Returns all tie groups for a kind (1, 2, 3, or more depending on results). */
function getAllTieGroupsForKind(
  s: GolfState,
  kind: PlayoffKind,
  totalsOverride?: number[]
): { allGroups: TieGroup[]; placement: number[]; multiplier: number; totals: number[] } {
  const base = getTieGroupForKind(s, kind, totalsOverride);
  const totals = base.totals;
  const allGroups = allTieGroupsFromTotals(totals);
  return { allGroups, placement: base.placement, multiplier: base.multiplier, totals };
}

/**
 * Expand a tied-group order into a full order, keeping all non-tied positions based on totals.
 */
function expandTiedOrderToFullOrder(totals: number[], tiedGroup: TieGroup, tiedOrder: number[]) {
  const n = totals.length;
  const baseOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => totals[a] - totals[b]);

  const prefix = baseOrder.slice(0, tiedGroup.startPos);
  const suffix = baseOrder.slice(tiedGroup.endPos);

  return [...prefix, ...tiedOrder, ...suffix];
}

/**
 * Build placement net/deltas from all tie groups and their resolutions.
 * fullOrder is built by merging base order with each group's PLAYOFF order; TIE overwrites amounts for tied indices.
 */
function computePlacementFromAllGroups(
  n: number,
  totals: number[],
  placement: number[],
  groups: TieGroup[],
  resolutions: Record<string, PlayoffResolution>,
  tieDivisor: number,
  mult: number,
  useNet: boolean
): number[] | null {
  const baseOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => totals[a] - totals[b]);
  const fullOrderRes = resolutions[FULL_ORDER_KEY];
  let fullOrder =
    fullOrderRes?.mode === "PLAYOFF" && fullOrderRes.order && isPermutation(fullOrderRes.order, n)
      ? fullOrderRes.order
      : [...baseOrder];
  if (!fullOrderRes?.order) {
    for (const g of groups) {
      const res = resolutions[String(g.startPos)];
      if (res?.mode === "PLAYOFF" && res.order && isPermutation(res.order, n)) {
        fullOrder = [
          ...fullOrder.slice(0, g.startPos),
          ...res.order.slice(g.startPos, g.endPos),
          ...fullOrder.slice(g.endPos),
        ];
      }
    }
  }
  const amounts = useNet
    ? computeNetFromOrder(fullOrder, placement, mult)
    : computeDeltasFromOrder(fullOrder, placement).map((x) => x * mult);
  for (const g of groups) {
    const res = resolutions[String(g.startPos)];
    if (res?.mode === "TIE") {
      const chk = useNet
        ? tieSplitForGroup_NET(n, placement, g, tieDivisor, mult)
        : tieSplitForGroup(n, placement, g, tieDivisor, mult);
      if (!chk.ok) return null;
      const val = useNet ? (chk as { eachNet: number }).eachNet : (chk as { eachShare: number }).eachShare;
      for (const idx of g.tiedPlayerIndices) amounts[idx] = val;
    }
  }
  return amounts;
}

/**
 * Tie split for classic (podium) placement rewards. Same placement-from-settings logic as Nassau.
 * Placement amounts come from settings (variable). On tie: only the tied slice is split (sum of their
 * placement slots / k); non-tied positions keep their placement value unchanged.
 */
function tieSplitForGroup_NET(
  n: number,
  placementPerOpp: number[],
  group: TieGroup,
  divisor: number,
  multiplier = 1
): { ok: boolean; net: number[]; eachNet: number; reason?: string } {
  const net = Array(n).fill(0);

  const baseOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => group.totals[a] - group.totals[b]);

  // Each position gets its placement value from settings (× multiplier for leg)
  for (let pos = 0; pos < n; pos++) {
    const playerIdx = baseOrder[pos];
    net[playerIdx] = (Number(placementPerOpp[pos] ?? 0) || 0) * (Number(multiplier) || 1);
  }

  const k = group.tiedPlayerIndices.length;
  let sumSlice = 0;
  for (let pos = group.startPos; pos < group.endPos; pos++) sumSlice += Number(placementPerOpp[pos] ?? 0);

  if (sumSlice % k !== 0) {
    return { ok: false, net, eachNet: 0, reason: "Not evenly divisible across tied players" };
  }

  const eachNet = (sumSlice / k) * (Number(multiplier) || 1);

  const d = Math.max(1, Math.floor(divisor));
  if (eachNet % d !== 0) {
    return { ok: false, net, eachNet, reason: `Each share must be divisible by ${d}` };
  }

  // Only override the tied players to the split share; non-tied keep their placement value
  for (const idx of group.tiedPlayerIndices) net[idx] = eachNet;

  return { ok: true, net, eachNet };
}

function needsGroupResolved(
  s: GolfState,
  n: number,
  kind: PlayoffKind,
  group: TieGroup,
  placement: number[],
  multiplier: number
): boolean {
  const res = getResolution(s, kind, group.startPos);
  if (res) return false;
  if (s.side.tiesAllowed && !s.side.playoffsAllowed) {
    const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, multiplier);
    return !chk.ok;
  }
  return true;
}

// ✅ Public: which tie groups need resolution per kind (1, 2, 3, or more depending on ties).
export function getPlayoffNeeds(s: GolfState, overrides?: PlayoffTotalsOverrides): PlayoffNeeds {
  const n = s.players.length;
  const empty: PlayoffNeeds = {
    podiumTieGroups: [],
    nassauFrontTieGroups: [],
    nassauBackTieGroups: [],
    nassauOverallTieGroups: [],
  };
  if (n <= 1) return empty;

  const collect = (kind: PlayoffKind, totalsOverride?: number[], shouldResolve = true): TieGroup[] => {
    if (!shouldResolve) return [];
    const { allGroups, placement, multiplier } = getAllTieGroupsForKind(s, kind, totalsOverride);
    return allGroups.filter((g) => needsGroupResolved(s, n, kind, g, placement, multiplier));
  };

  return {
    podiumTieGroups: !!s.side?.enabled && !!s.side?.placementOn ? collect("PODIUM", overrides?.podium) : [],
    nassauFrontTieGroups:
      s.side?.enabled && s.side?.nassauOn && isNassauRound(s.holes) && s.side.nassauFrontOn
        ? collect("NASSAU_FRONT", overrides?.nassauFront, s.isComplete || !!s.side.nassauFrontResolveAfter9)
        : [],
    nassauBackTieGroups:
      s.side?.enabled && s.side?.nassauOn && isNassauRound(s.holes) && s.side.nassauBackOn && s.isComplete
        ? collect("NASSAU_BACK", overrides?.nassauBack)
        : [],
    nassauOverallTieGroups:
      s.side?.enabled && s.side?.nassauOn && isNassauRound(s.holes) && s.side.nassauOverallOn && s.isComplete
        ? collect("NASSAU_OVERALL", overrides?.nassauOverall)
        : [],
  };
}

/** Options for a specific tie group (identified by startPos). */
export function getPlayoffOptions(
  s: GolfState,
  kind: PlayoffKind,
  overrides: PlayoffTotalsOverrides | undefined,
  groupStartPos: number
): PlayoffOptions {
  const totalsForKind =
    kind === "PODIUM"
      ? overrides?.podium
      : kind === "NASSAU_FRONT"
        ? overrides?.nassauFront
        : kind === "NASSAU_BACK"
          ? overrides?.nassauBack
          : overrides?.nassauOverall;
  const { allGroups, placement, multiplier } = getAllTieGroupsForKind(s, kind, totalsForKind);
  const group = allGroups.find((g) => g.startPos === groupStartPos);
  if (!group) return { tiedPlayerIndices: [], canTie: false, canPlayoff: false };

  const canPlayoff = !!s.side.playoffsAllowed;
  let canTie = false;
  let reasonIfNoTie: string | undefined;
  if (s.side.tiesAllowed) {
    const chk = tieSplitForGroup_NET(s.players.length, placement, group, s.side.tieDivisor, multiplier);
    canTie = chk.ok;
    if (!chk.ok) reasonIfNoTie = chk.reason;
  }
  return { tiedPlayerIndices: group.tiedPlayerIndices, canTie, canPlayoff, reasonIfNoTie };
}

export function setPlayoffModeTie(s: GolfState, kind: PlayoffKind, groupStartPos: number): GolfState {
  const s2 = pushHistory(s);
  setResolution(s2, kind, groupStartPos, "TIE", null);
  return recomputeAllRewards(s2);
}

/**
 * Set playoff finishing order. order is either full permutation (n) or tied-group order for the group at groupStartPos.
 * totalsOverride: when provided (e.g. net totals for handicap), use same totals as reward recompute so resolution is keyed by correct startPos.
 */
export function setPlayoffOrder(
  s: GolfState,
  kind: PlayoffKind,
  order: number[],
  groupStartPos?: number,
  totalsOverride?: number[]
): GolfState {
  const s2 = pushHistory(s);
  const n = s2.players.length;

  if (isPermutation(order, n)) {
    setResolution(s2, kind, -1, "PLAYOFF", [...order]); // -1 = full order
    return recomputeAllRewards(s2);
  }

  const { allGroups, totals } = getAllTieGroupsForKind(s2, kind, totalsOverride);
  const group = groupStartPos != null ? allGroups.find((g) => g.startPos === groupStartPos) : allGroups[0];
  if (!group || !isPermutationOfSet(order, group.tiedPlayerIndices)) return s2;

  const full = expandTiedOrderToFullOrder(totals, group, order);
  setResolution(s2, kind, group.startPos, "PLAYOFF", full);
  return recomputeAllRewards(s2);
}

export function clearPlayoffOrder(s: GolfState, kind: PlayoffKind): GolfState {
  const s2 = pushHistory(s);
  clearResolutionsForKind(s2, kind);
  return recomputeAllRewards(s2);
}

export function recomputeAllRewards(s: GolfState, overrides?: PlayoffTotalsOverrides | null): GolfState {
  // Use net totals when: UI passes overrides, or state has placementHandicaps (engine computes net from gross + handicaps)
  const effectiveOverrides =
    overrides !== undefined && overrides !== null
      ? overrides
      : computePlacementOverridesFromHandicaps(s);
  if (effectiveOverrides) {
    s = { ...s, placementTotalsOverrides: effectiveOverrides };
  }
  const n = s.players.length;
  const zero = Array(n).fill(0);

  normalizePlayoffsToNewShape(s);

  // master off = everything 0 and streak tracking reset
  if (!rewardsActive(s)) {
    s.rewards = { podium: [...zero], nassau: [...zero], streak: [...zero], roundScore: [...zero], total: [...zero] };
    s.eagleStreak = Array(n).fill(0);
    s.eagleBonusPaid = Array(n).fill(false);
    s.eagleRewardMark = Array.from({ length: n }, () => Array(s.holes.length).fill(null));
    s.playoffs = {
      podiumResolutions: {},
      nassauFrontResolutions: {},
      nassauBackResolutions: {},
      nassauOverallResolutions: {},
    };
    return s;
  }

  // normalize placement length
s.side.placement = normalizePlacementToPlayerCount(s.side.placement ?? [], n);

// --- Active mode gates ---
const inNassauRound = isNassauRound(s.holes);

// Nassau only pays if side games enabled, nassau flag ON, and holes are valid
const nassauActive = !!s.side?.enabled && !!s.side?.nassauOn && inNassauRound;

// Classic placement only pays when NOT in Nassau mode
const podiumActive = !!s.side?.enabled && !!s.side?.placementOn && !nassauActive;

  const placementOverrides = s.placementTotalsOverrides;

  // 7.1 Podium (only if classic placement is active)
let podium = [...zero];
if (podiumActive) {
    const totals = (placementOverrides?.podium?.length === n ? placementOverrides.podium : s.players.map((p) => p.total)) as number[];
    const { allGroups, placement, multiplier } = getAllTieGroupsForKind(s, "PODIUM", placementOverrides?.podium);
    const resolutions = getResolutionsMap(s.playoffs, "PODIUM");

    if (allGroups.length === 0) {
      podium = computePlacementDeltasFromTotals(totals, s.side.placement);
      clearResolutionsForKind(s, "PODIUM");
    } else {
      const hasFull = !!resolutions[FULL_ORDER_KEY];
      const allResolved = hasFull || allGroups.every((g) => resolutions[String(g.startPos)]);
      if (allResolved) {
        const merged = computePlacementFromAllGroups(n, totals, placement, allGroups, resolutions, s.side.tieDivisor, multiplier, true);
        if (merged) podium = merged;
      } else if (s.side.tiesAllowed && !s.side.playoffsAllowed) {
        const autoRes: Record<string, PlayoffResolution> = {};
        for (const g of allGroups) {
          const chk = tieSplitForGroup_NET(n, placement, g, s.side.tieDivisor, multiplier);
          if (!chk.ok) break;
          autoRes[String(g.startPos)] = { mode: "TIE", order: null };
        }
        if (Object.keys(autoRes).length === allGroups.length) {
          const merged = computePlacementFromAllGroups(n, totals, placement, allGroups, autoRes, s.side.tieDivisor, multiplier, true);
          if (merged) {
            podium = merged;
            for (const g of allGroups) setResolution(s, "PODIUM", g.startPos, "TIE", null);
          }
        }
      }
    }
  }

// 7.2 Nassau (three legs, using SAME placement table) — PODIUM-STYLE deltas (NOT net)
let nassau = [...zero];
if (nassauActive) {
  const idx = holeIndexMap(s.holes);

  const frontIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 1))!).filter(Number.isFinite);
  const backIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 10))!).filter(Number.isFinite);
  const bullIdx = idx.get("BULL");
  if (typeof bullIdx === "number") backIdxs.push(bullIdx);

  const overallIdxs = [...frontIdxs, ...backIdxs];
  const placement = s.side.placement;

  const add = (base: number[], addv: number[]) => {
    for (let i = 0; i < n; i++) base[i] += addv[i] ?? 0;
  };

  const scale = (d: number[], mult: number) => (mult === 1 ? d : d.map((x) => (Number(x) || 0) * mult));

  // FRONT (use net totals when handicaps applied)
  if (s.side.nassauFrontOn && legComplete(s.players, frontIdxs)) {
    const totals = (placementOverrides?.nassauFront?.length === n ? placementOverrides.nassauFront : legTotals(s.players, frontIdxs)) as number[];
    const shouldResolveNow = s.isComplete || !!s.side.nassauFrontResolveAfter9;
    const { allGroups, placement: legPlacement, multiplier: legMult } = getAllTieGroupsForKind(s, "NASSAU_FRONT", placementOverrides?.nassauFront);
    const resolutions = getResolutionsMap(s.playoffs, "NASSAU_FRONT");

    if (allGroups.length === 0) {
      add(nassau, computePlacementDeltasFromTotals(totals, placement));
      clearResolutionsForKind(s, "NASSAU_FRONT");
    } else if (shouldResolveNow) {
      const hasFull = !!resolutions[FULL_ORDER_KEY];
      const allResolved = hasFull || allGroups.every((g) => resolutions[String(g.startPos)]);
      if (allResolved) {
        const d = computePlacementFromAllGroups(n, totals, legPlacement, allGroups, resolutions, s.side.tieDivisor, legMult, false);
        if (d) add(nassau, d);
      } else if (s.side.tiesAllowed && !s.side.playoffsAllowed) {
        const autoRes: Record<string, PlayoffResolution> = {};
        for (const g of allGroups) {
          const chk = tieSplitForGroup(n, legPlacement, g, s.side.tieDivisor, legMult);
          if (!chk.ok) break;
          autoRes[String(g.startPos)] = { mode: "TIE", order: null };
        }
        if (Object.keys(autoRes).length === allGroups.length) {
          const d = computePlacementFromAllGroups(n, totals, legPlacement, allGroups, autoRes, s.side.tieDivisor, legMult, false);
          if (d) {
            add(nassau, d);
            for (const g of allGroups) setResolution(s, "NASSAU_FRONT", g.startPos, "TIE", null);
          }
        }
      }
    }
  }

  // BACK (only resolves at end) — use net totals when handicaps applied
  if (s.side.nassauBackOn && legComplete(s.players, backIdxs) && s.isComplete) {
    const totals = (placementOverrides?.nassauBack?.length === n ? placementOverrides.nassauBack : legTotals(s.players, backIdxs)) as number[];
    const mult = s.side.nassauBackMultiplier ?? 1;
    const { allGroups, placement: legPlacement, multiplier: legMult } = getAllTieGroupsForKind(s, "NASSAU_BACK", placementOverrides?.nassauBack);
    const resolutions = getResolutionsMap(s.playoffs, "NASSAU_BACK");

    if (allGroups.length === 0) {
      add(nassau, scale(computePlacementDeltasFromTotals(totals, placement), mult));
      clearResolutionsForKind(s, "NASSAU_BACK");
    } else {
      const hasFull = !!resolutions[FULL_ORDER_KEY];
      const allResolved = hasFull || allGroups.every((g) => resolutions[String(g.startPos)]);
      if (allResolved) {
        const d = computePlacementFromAllGroups(n, totals, legPlacement, allGroups, resolutions, s.side.tieDivisor, legMult, false);
        if (d) add(nassau, d);
      } else if (s.side.tiesAllowed && !s.side.playoffsAllowed) {
        const autoRes: Record<string, PlayoffResolution> = {};
        for (const g of allGroups) {
          const chk = tieSplitForGroup(n, legPlacement, g, s.side.tieDivisor, legMult);
          if (!chk.ok) break;
          autoRes[String(g.startPos)] = { mode: "TIE", order: null };
        }
        if (Object.keys(autoRes).length === allGroups.length) {
          const d = computePlacementFromAllGroups(n, totals, legPlacement, allGroups, autoRes, s.side.tieDivisor, legMult, false);
          if (d) {
            add(nassau, d);
            for (const g of allGroups) setResolution(s, "NASSAU_BACK", g.startPos, "TIE", null);
          }
        }
      }
    }
  }

  // OVERALL (only resolves at end) — use net totals when handicaps applied
  if (s.side.nassauOverallOn && legComplete(s.players, overallIdxs) && s.isComplete) {
    const totals = (placementOverrides?.nassauOverall?.length === n ? placementOverrides.nassauOverall : legTotals(s.players, overallIdxs)) as number[];
    const { allGroups, placement: legPlacement, multiplier: legMult } = getAllTieGroupsForKind(s, "NASSAU_OVERALL", placementOverrides?.nassauOverall);
    const resolutions = getResolutionsMap(s.playoffs, "NASSAU_OVERALL");

    if (allGroups.length === 0) {
      add(nassau, computePlacementDeltasFromTotals(totals, placement));
      clearResolutionsForKind(s, "NASSAU_OVERALL");
    } else {
      const hasFull = !!resolutions[FULL_ORDER_KEY];
      const allResolved = hasFull || allGroups.every((g) => resolutions[String(g.startPos)]);
      if (allResolved) {
        const d = computePlacementFromAllGroups(n, totals, legPlacement, allGroups, resolutions, s.side.tieDivisor, legMult, false);
        if (d) add(nassau, d);
      } else if (s.side.tiesAllowed && !s.side.playoffsAllowed) {
        const autoRes: Record<string, PlayoffResolution> = {};
        for (const g of allGroups) {
          const chk = tieSplitForGroup(n, legPlacement, g, s.side.tieDivisor, legMult);
          if (!chk.ok) break;
          autoRes[String(g.startPos)] = { mode: "TIE", order: null };
        }
        if (Object.keys(autoRes).length === allGroups.length) {
          const d = computePlacementFromAllGroups(n, totals, legPlacement, allGroups, autoRes, s.side.tieDivisor, legMult, false);
          if (d) {
            add(nassau, d);
            for (const g of allGroups) setResolution(s, "NASSAU_OVERALL", g.startPos, "TIE", null);
          }
        }
      }
    }
  }
}


  // 7.3 Eagle streak is incremental (stored)
  const streak = s.rewards?.streak?.length === n ? [...s.rewards.streak] : [...zero];

  // 7.4 Round score (only at end)
  const roundScore = [...zero];
  if (s.isComplete) {
    for (let i = 0; i < n; i++) {
      const totalScore = s.players[i].total;

      if (s.side.roundJackpotOn && totalScore <= s.side.roundJackpotThreshold) {
        applyZeroSumTransfer(roundScore, i, s.side.roundJackpotValue);
      } else if (s.side.roundBonusOn && totalScore <= s.side.roundBonusThreshold) {
        applyZeroSumTransfer(roundScore, i, s.side.roundBonusValue);
      }
    }
  }

  const total = [...zero];
  for (let i = 0; i < n; i++) {
    total[i] = (podium[i] ?? 0) + (nassau[i] ?? 0) + (streak[i] ?? 0) + (roundScore[i] ?? 0);
  }

  s.rewards = { podium, nassau, streak, roundScore, total };
  return s;
}

function ensureRewardsArrays(s2: GolfState) {
  const n = s2.players.length;
  if (!s2.rewards || s2.rewards.streak?.length !== n) {
    s2.rewards = {
      podium: Array(n).fill(0),
      nassau: Array(n).fill(0),
      streak: Array(n).fill(0),
      roundScore: Array(n).fill(0),
      total: Array(n).fill(0),
    };
  }
}

/**
 * ✅ Award for streak-type rewards (zero-sum).
 * If optOutIndices is provided, only non-opted-out players pay; opted-out players neither pay nor receive.
 */
function awardZeroSum(
  s2: GolfState,
  winnerIndex: number,
  amount: number,
  label: string,
  optOutIndices?: number[]
) {
  if (!rewardsActive(s2)) return;

  ensureRewardsArrays(s2);
  const n = s2.players.length;
  const amt = Number(amount) || 0;

  if (optOutIndices != null && optOutIndices.length > 0) {
    const exclude = new Set(optOutIndices);
    applyZeroSumTransferExcluding(s2.rewards.streak, winnerIndex, amt, exclude);
    let numPayers = 0;
    for (let i = 0; i < n; i++) if (i !== winnerIndex && !exclude.has(i)) numPayers += 1;
    const display = amt * Math.max(0, numPayers);
    s2.events.push({ kind: "REWARD", playerIndex: winnerIndex, amount: display, label });
  } else {
    applyZeroSumTransfer(s2.rewards.streak, winnerIndex, amount);
    const display = amt * Math.max(0, n - 1);
    s2.events.push({ kind: "REWARD", playerIndex: winnerIndex, amount: display, label });
  }
}

// ✅ Clear any provisional EAGLE marks from the most recent (failed) streak
function clearTrailingEagleMarks(s2: GolfState, playerIndex: number, fromHoleIdxInclusive: number) {
  const row = s2.eagleRewardMark?.[playerIndex];
  if (!row) return;

  for (let i = fromHoleIdxInclusive; i >= 0; i--) {
    if (row[i] === "EAGLE") row[i] = null;
    else break;
  }
}

// ---------- Hole completion + progression ----------
function finalizeHole(s2: GolfState, playerIndex: number, finalScore: HoleScore, label: string) {
  const p = s2.players[playerIndex];
  const hole = currentHole(s2, p);
  if (hole === null) return;

  p.scores[p.holeIndex] = finalScore;
  p.total += finalScore;

  s2.events.push({ kind: "HOLE", playerIndex, hole, finalScore, label });

  const holeIdxJustFinished = p.holeIndex;

  // ✅ Eagle streak logic (Option B + provisional marking)
  if (rewardsActive(s2)) {
    const isEagle = finalScore === -2;

    const bonusOn = !!s2.side.eagleBonusOn;
    const bonusCount = Math.max(1, Math.floor(Number(s2.side.eagleBonusCount ?? 2)));
    const bonusValue = Number(s2.side.eagleBonusValue) || 0;

    const jackpotOn = !!s2.side.eagleJackpotOn;
    const jackpotCount = Math.max(1, Math.floor(Number(s2.side.eagleJackpotCount ?? 3)));
    const jackpotValue = Number(s2.side.eagleJackpotValue) || 0;

    if (isEagle) {
      s2.eagleStreak[playerIndex] = (s2.eagleStreak[playerIndex] ?? 0) + 1;
      s2.eagleRewardMark[playerIndex][holeIdxJustFinished] = "EAGLE";
    } else {
      clearTrailingEagleMarks(s2, playerIndex, holeIdxJustFinished - 1);
      s2.eagleStreak[playerIndex] = 0;
      s2.eagleBonusPaid[playerIndex] = false;
    }

    const streak = s2.eagleStreak[playerIndex] ?? 0;

    const optOutSet = s2.side.eagleStreakOptOut ?? [];
    const optOut = optOutSet.includes(s2.players[playerIndex].name);
    const optOutIndices = optOutSet.length > 0
      ? s2.players.map((p, i) => (optOutSet.includes(p.name) ? i : -1)).filter((i) => i >= 0)
      : undefined;

    const jackpotHit = jackpotOn && streak >= jackpotCount;
    const bonusHit = bonusOn && streak >= bonusCount;

    if (jackpotHit) {
      const alreadyBonus = !!s2.eagleBonusPaid[playerIndex];
      const diff = alreadyBonus ? jackpotValue - bonusValue : jackpotValue;

      if (!optOut && diff !== 0) {
        awardZeroSum(s2, playerIndex, diff, `Eagle Streak Jackpot (${jackpotCount})`, optOutIndices);
      }

      s2.eagleRewardMark[playerIndex][holeIdxJustFinished] = "JACKPOT";

      s2.eagleStreak[playerIndex] = 0;
      s2.eagleBonusPaid[playerIndex] = false;
    } else if (bonusHit && !s2.eagleBonusPaid[playerIndex]) {
      if (!optOut && bonusValue !== 0) {
        awardZeroSum(s2, playerIndex, bonusValue, `Eagle Streak Bonus (${bonusCount})`, optOutIndices);
      }

      s2.eagleRewardMark[playerIndex][holeIdxJustFinished] = "BONUS";
      s2.eagleBonusPaid[playerIndex] = true;
    }
  }

  p.holeIndex += 1;
  p.holeDarts = [];
}

function allDone(s: GolfState): boolean {
  return s.players.every((p) => p.holeIndex >= s.holes.length);
}

function computeWinnersIfComplete(s2: GolfState) {
  if (!allDone(s2)) return;

  s2.isComplete = true;

  let best = Infinity;
  for (const p of s2.players) best = Math.min(best, p.total);

  const winners: number[] = [];
  s2.players.forEach((p, idx) => {
    if (p.total === best) winners.push(idx);
  });

  s2.winnerIndices = winners;

  recomputeAllRewards(s2);
}

function advanceToNextPlayer(s2: GolfState) {
  const n = s2.players.length;
  let next = s2.currentPlayerIndex;

  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (currentHole(s2, s2.players[next]) !== null) break;
  }

  s2.currentPlayerIndex = next;

  computeWinnersIfComplete(s2);

  recomputeAllRewards(s2);
}

// ---------- Public actions ----------
export function applyDart(s: GolfState, dart: GolfDart): GolfState {
  if (s.isComplete) return s;

  const s2 = pushHistory(s);
  const p = s2.players[s2.currentPlayerIndex];
  const hole = currentHole(s2, p);
  if (hole === null) return s2;

  if (p.holeDarts.length >= 3) return s2;

  const res = evalDart(hole, dart);

  p.holeDarts.push(dart);
  s2.events.push({
    kind: "DART",
    playerIndex: s2.currentPlayerIndex,
    hole,
    dart,
    scorePreview: res.score,
    label: res.label,
  });

  if (res.isEagle) {
    finalizeHole(s2, s2.currentPlayerIndex, res.score, res.label);
    advanceToNextPlayer(s2);
    return s2;
  }

  if (p.holeDarts.length >= 3) {
    const last = p.holeDarts[p.holeDarts.length - 1];
    const lastRes = evalDart(hole, last);
    finalizeHole(s2, s2.currentPlayerIndex, lastRes.score, `${lastRes.label} (3 darts)`);
    advanceToNextPlayer(s2);
    return s2;
  }

  recomputeAllRewards(s2);
  return s2;
}

// "Done" button: ALWAYS ends the hole using the last dart thrown (even if +2)
export function acceptHole(s: GolfState): GolfState {
  if (s.isComplete) return s;

  const p = s.players[s.currentPlayerIndex];
  const hole = currentHole(s, p);
  if (hole === null) return s;

  if (p.holeDarts.length === 0) return s;

  const s2 = pushHistory(s);
  const p2 = s2.players[s2.currentPlayerIndex];
  const hole2 = currentHole(s2, p2);
  if (hole2 === null) return s2;

  const last = p2.holeDarts[p2.holeDarts.length - 1];
  const lastRes = evalDart(hole2, last);

  finalizeHole(s2, s2.currentPlayerIndex, lastRes.score, `${lastRes.label} (Done)`);
  advanceToNextPlayer(s2);
  return s2;
}

export function noScore(s: GolfState): GolfState {
  if (s.isComplete) return s;

  const s2 = pushHistory(s);
  finalizeHole(s2, s2.currentPlayerIndex, 2, "No Score (Forced)");
  advanceToNextPlayer(s2);
  return s2;
}

// ---------- Convenience helpers ----------
export function getCurrentPlayer(s: GolfState): PlayerState {
  return s.players[s.currentPlayerIndex];
}

export function getCurrentHole(s: GolfState): Hole | null {
  return currentHole(s, getCurrentPlayer(s));
}

export function getStandings(s: GolfState): { index: number; total: number }[] {
  return s.players
    .map((p, idx) => ({ index: idx, total: p.total }))
    .sort((a, b) => a.total - b.total);
}

// ---------- Nassau leg summaries for UI ----------

export type NassauLegKey = "FRONT" | "BACK" | "OVERALL";

export type NassauLegSummary = {
  key: NassauLegKey;
  label: string;
  totals: number[];       // raw leg totals (lower is better)
  order: number[];        // player indices best->worst (after playoff/tie resolution if chosen)
  pos: number[];          // 1..n position per player index
  deltas: number[];       // per-opponent deltas (same units as s.rewards.nassau contribution)
  multiplier: number;     // 1 or 2 for back leg
};

function positionsFromOrder(order: number[]) {
  const n = order.length;
  const pos = Array(n).fill(0);
  for (let i = 0; i < n; i++) pos[order[i]] = i + 1;
  return pos;
}

export function getNassauLegSummaries(s: GolfState): NassauLegSummary[] {
  const n = s.players.length;
  if (n < 2) return [];

  if (!s.side?.enabled) return [];
  if (!s.side?.nassauOn) return [];
  if (!isNassauRound(s.holes)) return [];

  const idx = holeIndexMap(s.holes);

  const frontIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 1))!)
    .filter((x) => typeof x === "number") as number[];

  const backIdxs = Array.from({ length: 9 }, (_, i) => idx.get(String(i + 10))!)
    .filter((x) => typeof x === "number") as number[];

  const bullIdx = idx.get("BULL");
  if (typeof bullIdx === "number") backIdxs.push(bullIdx);

  const overallIdxs = [...frontIdxs, ...backIdxs];

  const placement = normalizePlacementToPlayerCount(s.side.placement ?? [], n);

  const build = (
    key: NassauLegKey,
    label: string,
    legIdxs: number[],
    kind: PlayoffKind,
    multiplier: number
  ): NassauLegSummary => {
    const totals = legTotals(s.players, legIdxs);

    // base order by totals
    const baseOrder = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => totals[a] - totals[b]
    );

    // if leg not complete (or not eligible yet), show zeros but still show positions by current totals
    const complete = legComplete(s.players, legIdxs);
    const eligible =
      key === "FRONT"
        ? complete && (s.isComplete || !!s.side.nassauFrontResolveAfter9)
        : complete && s.isComplete;

    if (!eligible) {
      return {
        key,
        label,
        totals,
        order: baseOrder,
        pos: positionsFromOrder(baseOrder),
        deltas: Array(n).fill(0),
        multiplier,
      };
    }

    const group = firstTieGroupFromTotals(totals);
    const resolutions = getResolutionsMap(s.playoffs, kind);
    const fullRes = resolutions[FULL_ORDER_KEY];
    const res = fullRes ?? (group ? getResolution(s, kind, group.startPos) : null);

    // no tie: normal placement deltas
    if (!group) {
      const raw = computePlacementDeltasFromTotals(totals, placement);
      const deltas = multiplier === 1 ? raw : raw.map((x) => (Number(x) || 0) * multiplier);
      return {
        key,
        label,
        totals,
        order: baseOrder,
        pos: positionsFromOrder(baseOrder),
        deltas,
        multiplier,
      };
    }

    // tie exists
    if (res && res.mode === "PLAYOFF" && res.order && isPermutation(res.order, n)) {
      const order = res.order as number[];
      const raw = computeDeltasFromOrder(order, placement);
      const deltas = multiplier === 1 ? raw : raw.map((x) => (Number(x) || 0) * multiplier);
      return {
        key,
        label,
        totals,
        order,
        pos: positionsFromOrder(order),
        deltas,
        multiplier,
      };
    }

    if (res && res.mode === "TIE") {
      const chk = tieSplitForGroup(n, placement, group, s.side.tieDivisor, multiplier);
      // keep base order for display; deltas is the tie-split deltas if valid
      return {
        key,
        label,
        totals,
        order: baseOrder,
        pos: positionsFromOrder(baseOrder),
        deltas: chk.ok ? chk.deltas : Array(n).fill(0),
        multiplier,
      };
    }

    // unresolved tie (waiting for user choice): show 0 deltas
    return {
      key,
      label,
      totals,
      order: baseOrder,
      pos: positionsFromOrder(baseOrder),
      deltas: Array(n).fill(0),
      multiplier,
    };
  };

  const multBack = s.side.nassauBackMultiplier ?? 1;

  const legs: NassauLegSummary[] = [];

  if (s.side.nassauFrontOn) legs.push(build("FRONT", "Front 9", frontIdxs, "NASSAU_FRONT", 1));
  if (s.side.nassauBackOn) legs.push(build("BACK", "Back 9 + Bull", backIdxs, "NASSAU_BACK", multBack));
  if (s.side.nassauOverallOn) legs.push(build("OVERALL", "Overall", overallIdxs, "NASSAU_OVERALL", 1));

  return legs;
}


// Optional debug helper
export function debugRewards(s: GolfState) {
  return {
    enabled: s.side?.enabled,
    side: s.side,
    eagleStreak: s.eagleStreak,
    eagleBonusPaid: s.eagleBonusPaid,
    totals: s.players.map((p) => p.total),
    rewards: s.rewards,
    eagleRewardMark: s.eagleRewardMark,
    playoffs: s.playoffs,
    needs: getPlayoffNeeds(s),
    podiumOptions: getPlayoffOptions(s, "PODIUM", undefined, 0),
    frontOptions: getPlayoffOptions(s, "NASSAU_FRONT", undefined, 0),
    backOptions: getPlayoffOptions(s, "NASSAU_BACK", undefined, 0),
    overallOptions: getPlayoffOptions(s, "NASSAU_OVERALL", undefined, 0),
  };
}
