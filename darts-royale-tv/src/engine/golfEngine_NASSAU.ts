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

export type GolfPlayoffs = {
  podiumOrder: number[] | null;
  podiumMode: PlayoffMode | null;

  nassauFrontOrder: number[] | null;
  nassauFrontMode: PlayoffMode | null;

  nassauBackOrder: number[] | null;
  nassauBackMode: PlayoffMode | null;

  nassauOverallOrder: number[] | null;
  nassauOverallMode: PlayoffMode | null;
};

export type PlayoffNeeds = {
  podium: boolean;
  nassauFront: boolean;
  nassauBack: boolean;
  nassauOverall: boolean;
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
      podiumOrder: null,
      podiumMode: null,

      nassauFrontOrder: null,
      nassauFrontMode: null,

      nassauBackOrder: null,
      nassauBackMode: null,

      nassauOverallOrder: null,
      nassauOverallMode: null,
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
      podiumOrder: s.playoffs?.podiumOrder ? [...s.playoffs.podiumOrder] : null,
      podiumMode: s.playoffs?.podiumMode ?? null,

      nassauFrontOrder: s.playoffs?.nassauFrontOrder ? [...s.playoffs.nassauFrontOrder] : null,
      nassauFrontMode: s.playoffs?.nassauFrontMode ?? null,

      nassauBackOrder: s.playoffs?.nassauBackOrder ? [...s.playoffs.nassauBackOrder] : null,
      nassauBackMode: s.playoffs?.nassauBackMode ?? null,

      nassauOverallOrder: s.playoffs?.nassauOverallOrder ? [...s.playoffs.nassauOverallOrder] : null,
      nassauOverallMode: s.playoffs?.nassauOverallMode ?? null,
    },
    events: [...s.events],
    history: [...s.history],
    future: [...s.future],
  };
}

function pushHistory(base: GolfState): GolfState {
  const s2 = deepClone(base);
  s2.history = [...base.history, stripStacks(base)];
  s2.future = [];
  return s2;
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

function computeNetFromTotals(totals: number[], placementPerOpp: number[], multiplier = 1) {
  const n = totals.length;
  const net = Array(n).fill(0);

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

    // average the tied placement slots (per-opponent amounts)
    let sumPerOpp = 0;
    for (let j = 0; j < k; j++) sumPerOpp += Number(placementPerOpp[start + j] ?? 0);

    const eachPerOpp = k ? sumPerOpp / k : 0;
    for (const playerIdx of tied) {
      net[playerIdx] = perOpponentToNet(eachPerOpp, n, multiplier);
    }
  }

  return net;
}

function computeNetFromOrder(order: number[], placementPerOpp: number[], multiplier = 1) {
  const n = order.length;
  const net = Array(n).fill(0);
  for (let pos = 0; pos < n; pos++) {
    const playerIdx = order[pos];
    const perOpp = Number(placementPerOpp[pos] ?? 0);
    net[playerIdx] = perOpponentToNet(perOpp, n, multiplier);
  }
  return net;
}

/**
 * Finds the earliest (best-score) tie group.
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

function isNassauRound(holes: Hole[]) {
  if (holes.length !== 19) return false;
  const hasBull = holes.includes("BULL");
  if (!hasBull) return false;
  for (let i = 1; i <= 18; i++) if (!holes.includes(i)) return false;
  return true;
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

function getResolution(s: GolfState, kind: PlayoffKind): { mode: PlayoffMode | null; order: number[] | null } {
  if (kind === "PODIUM") return { mode: s.playoffs.podiumMode ?? null, order: s.playoffs.podiumOrder ?? null };
  if (kind === "NASSAU_FRONT") return { mode: s.playoffs.nassauFrontMode ?? null, order: s.playoffs.nassauFrontOrder ?? null };
  if (kind === "NASSAU_BACK") return { mode: s.playoffs.nassauBackMode ?? null, order: s.playoffs.nassauBackOrder ?? null };
  return { mode: s.playoffs.nassauOverallMode ?? null, order: s.playoffs.nassauOverallOrder ?? null };
}

function setResolution(s2: GolfState, kind: PlayoffKind, mode: PlayoffMode | null, order: number[] | null) {
  if (kind === "PODIUM") {
    s2.playoffs.podiumMode = mode;
    s2.playoffs.podiumOrder = order;
  }
  if (kind === "NASSAU_FRONT") {
    s2.playoffs.nassauFrontMode = mode;
    s2.playoffs.nassauFrontOrder = order;
  }
  if (kind === "NASSAU_BACK") {
    s2.playoffs.nassauBackMode = mode;
    s2.playoffs.nassauBackOrder = order;
  }
  if (kind === "NASSAU_OVERALL") {
    s2.playoffs.nassauOverallMode = mode;
    s2.playoffs.nassauOverallOrder = order;
  }
}

/**
 * For a given kind, compute the current totals, the first tie group (if any),
 * and the leg multiplier (back leg can be 2x).
 */
function getTieGroupForKind(s: GolfState, kind: PlayoffKind): { group: TieGroup | null; placement: number[]; multiplier: number; totals: number[] } {
  const n = s.players.length;
  const placement = normalizePlacementToPlayerCount(s.side.placement ?? [], n);

  if (kind === "PODIUM") {
    const totals = s.players.map((p) => p.total);
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
    const totals = legTotals(s.players, frontIdxs);
    if (!legComplete(s.players, frontIdxs)) return { group: null, placement, multiplier: 1, totals };
    return { group: firstTieGroupFromTotals(totals), placement, multiplier: 1, totals };
  }

  if (kind === "NASSAU_BACK") {
    const totals = legTotals(s.players, backIdxs);
    const mult = s.side.nassauBackMultiplier ?? 1;
    if (!legComplete(s.players, backIdxs)) return { group: null, placement, multiplier: mult, totals };
    return { group: firstTieGroupFromTotals(totals), placement, multiplier: mult, totals };
  }

  // overall
  const totals = legTotals(s.players, overallIdxs);
  if (!legComplete(s.players, overallIdxs)) return { group: null, placement, multiplier: 1, totals };
  return { group: firstTieGroupFromTotals(totals), placement, multiplier: 1, totals };
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
 * ✅ Tie split logic:
 * - we split the tied slice placement slots evenly (per-opponent)
 * - then convert to NET (perOpp*(n-1)*multiplier)
 * - and enforce net divisibility by tieDivisor
 */
function tieSplitForGroup_NET(
  n: number,
  placementPerOpp: number[],
  group: TieGroup,
  divisor: number,
  multiplier = 1
): { ok: boolean; net: number[]; eachNet: number; reason?: string } {
  const net = Array(n).fill(0);

  // Base order by totals
  const baseOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => group.totals[a] - group.totals[b]);

  // Fill everyone by rank first (per-opponent -> net)
  for (let pos = 0; pos < n; pos++) {
    const playerIdx = baseOrder[pos];
    const perOpp = Number(placementPerOpp[pos] ?? 0);
    net[playerIdx] = perOpponentToNet(perOpp, n, multiplier);
  }

  // Tied slice sum in per-opponent space
  const k = group.tiedPlayerIndices.length;
  let sumPerOpp = 0;
  for (let pos = group.startPos; pos < group.endPos; pos++) sumPerOpp += Number(placementPerOpp[pos] ?? 0);

  // Must split evenly (per-opponent integer)
  if (sumPerOpp % k !== 0) {
    return { ok: false, net, eachNet: 0, reason: "Not evenly divisible across tied players" };
  }

  const eachPerOpp = sumPerOpp / k;
  const eachNet = perOpponentToNet(eachPerOpp, n, multiplier);

  // Must be divisible by divisor (net)
  const d = Math.max(1, Math.floor(divisor));
  if (eachNet % d !== 0) {
    return { ok: false, net, eachNet, reason: `Each share must be divisible by ${d}` };
  }

  // Override tied players
  for (const idx of group.tiedPlayerIndices) net[idx] = eachNet;

  return { ok: true, net, eachNet };
}

// ✅ Public: what playoff is currently required?
export function getPlayoffNeeds(s: GolfState): PlayoffNeeds {
  const n = s.players.length;
  if (n <= 1) return { podium: false, nassauFront: false, nassauBack: false, nassauOverall: false };

  // Podium: only when enabled
  const podiumPossible = !!s.side?.enabled && !!s.side?.placementOn;
  const podiumGroup = podiumPossible ? getTieGroupForKind(s, "PODIUM").group : null;

  // Nassau legs
  let frontTie = false;
  let backTie = false;
  let overallTie = false;

  if (s.side?.enabled && s.side?.nassauOn && isNassauRound(s.holes)) {
    if (s.side.nassauFrontOn) {
      const front = getTieGroupForKind(s, "NASSAU_FRONT").group;
      frontTie = !!front && (s.isComplete || !!s.side.nassauFrontResolveAfter9);
    }
    if (s.side.nassauBackOn) {
      const back = getTieGroupForKind(s, "NASSAU_BACK").group;
      backTie = !!back && s.isComplete;
    }
    if (s.side.nassauOverallOn) {
      const overall = getTieGroupForKind(s, "NASSAU_OVERALL").group;
      overallTie = !!overall && s.isComplete;
    }
  }

  const needsKind = (kind: PlayoffKind, exists: boolean) => {
    if (!exists) return false;

    const { group, placement, multiplier, totals } = getTieGroupForKind(s, kind);
    if (!group) return false;

    // If user already resolved (tie or playoff), no need.
    const res = getResolution(s, kind);
    if (res.mode) return false;

    // Tie-only automatic resolution if allowed and playoffs not allowed
    if (s.side.tiesAllowed && !s.side.playoffsAllowed) {
      const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, multiplier);
      return !chk.ok; // needs help only if tie split is not possible
    }

    // Otherwise we need a popup (because playoff is possible)
    return true;
  };

  return {
    podium: needsKind("PODIUM", !!podiumGroup),
    nassauFront: needsKind("NASSAU_FRONT", frontTie),
    nassauBack: needsKind("NASSAU_BACK", backTie),
    nassauOverall: needsKind("NASSAU_OVERALL", overallTie),
  };
}

/**
 * ✅ ask engine what options should appear in the popup for a given kind.
 */
export function getPlayoffOptions(s: GolfState, kind: PlayoffKind): PlayoffOptions {
  const { group, placement, multiplier } = getTieGroupForKind(s, kind);
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

export function setPlayoffModeTie(s: GolfState, kind: PlayoffKind): GolfState {
  const s2 = pushHistory(s);
  setResolution(s2, kind, "TIE", null);
  return recomputeAllRewards(s2);
}

/**
 * ✅ Public: set a playoff finishing order
 *
 * Supports BOTH:
 * 1) full permutation length = n
 * 2) tied-group order length = tiedGroupSize (only tied players)
 */
export function setPlayoffOrder(s: GolfState, kind: PlayoffKind, order: number[]): GolfState {
  const s2 = pushHistory(s);
  const n = s2.players.length;

  // Full permutation
  if (isPermutation(order, n)) {
    setResolution(s2, kind, "PLAYOFF", [...order]);
    return recomputeAllRewards(s2);
  }

  // Tied-group order
  const { group, totals } = getTieGroupForKind(s2, kind);
  if (!group) return s2;

  if (!isPermutationOfSet(order, group.tiedPlayerIndices)) {
    return s2; // ignore invalid
  }

  const full = expandTiedOrderToFullOrder(totals, group, order);
  setResolution(s2, kind, "PLAYOFF", full);

  return recomputeAllRewards(s2);
}

export function clearPlayoffOrder(s: GolfState, kind: PlayoffKind): GolfState {
  const s2 = pushHistory(s);
  setResolution(s2, kind, null, null);
  return recomputeAllRewards(s2);
}

function recomputeAllRewards(s: GolfState): GolfState {
  const n = s.players.length;
  const zero = Array(n).fill(0);

  // master off = everything 0 and streak tracking reset
  if (!rewardsActive(s)) {
    s.rewards = { podium: [...zero], nassau: [...zero], streak: [...zero], roundScore: [...zero], total: [...zero] };
    s.eagleStreak = Array(n).fill(0);
    s.eagleBonusPaid = Array(n).fill(false);
    s.eagleRewardMark = Array.from({ length: n }, () => Array(s.holes.length).fill(null));
    s.playoffs = {
      podiumOrder: null,
      podiumMode: null,
      nassauFrontOrder: null,
      nassauFrontMode: null,
      nassauBackOrder: null,
      nassauBackMode: null,
      nassauOverallOrder: null,
      nassauOverallMode: null,
    };
    return s;
  }

  // normalize placement length
  s.side.placement = normalizePlacementToPlayerCount(s.side.placement ?? [], n);

  // 7.1 Podium (only if placementOn)
  let podium = [...zero];
  if (s.side.placementOn) {
    const totals = s.players.map((p) => p.total);
    const group = firstTieGroupFromTotals(totals);

    if (!group) {
      podium = computeNetFromTotals(totals, s.side.placement, 1);
      s.playoffs.podiumMode = null;
      s.playoffs.podiumOrder = null;
    } else {
      const res = getResolution(s, "PODIUM");

      // tie-only auto mode
      if (!res.mode && s.side.tiesAllowed && !s.side.playoffsAllowed) {
        const chk = tieSplitForGroup_NET(n, s.side.placement, group, s.side.tieDivisor, 1);
        if (chk.ok) {
          podium = chk.net;
          s.playoffs.podiumMode = "TIE";
          s.playoffs.podiumOrder = null;
        } else {
          podium = [...zero];
        }
      } else if (res.mode === "TIE") {
        const chk = tieSplitForGroup_NET(n, s.side.placement, group, s.side.tieDivisor, 1);
        podium = chk.ok ? chk.net : [...zero];
      } else if (res.mode === "PLAYOFF") {
        if (isPermutation(res.order, n)) {
          podium = computeNetFromOrder(res.order as number[], s.side.placement, 1);
        } else {
          podium = [...zero];
        }
      } else {
        // wait for user choice
        podium = [...zero];
      }
    }
  }

  // 7.2 Nassau (three legs, using SAME placement table)
  let nassau = [...zero];
  if (s.side.nassauOn && isNassauRound(s.holes)) {
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

    // FRONT
    if (s.side.nassauFrontOn && legComplete(s.players, frontIdxs)) {
      const totals = legTotals(s.players, frontIdxs);
      const group = firstTieGroupFromTotals(totals);

      if (!group) {
        add(nassau, computeNetFromTotals(totals, placement, 1));
        s.playoffs.nassauFrontMode = null;
        s.playoffs.nassauFrontOrder = null;
      } else {
        const res = getResolution(s, "NASSAU_FRONT");
        const shouldResolveNow = s.isComplete || !!s.side.nassauFrontResolveAfter9;

        if (shouldResolveNow) {
          if (!res.mode && s.side.tiesAllowed && !s.side.playoffsAllowed) {
            const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, 1);
            if (chk.ok) {
              add(nassau, chk.net);
              s.playoffs.nassauFrontMode = "TIE";
              s.playoffs.nassauFrontOrder = null;
            }
          } else if (res.mode === "TIE") {
            const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, 1);
            if (chk.ok) add(nassau, chk.net);
          } else if (res.mode === "PLAYOFF") {
            if (isPermutation(res.order, n)) add(nassau, computeNetFromOrder(res.order as number[], placement, 1));
          } else {
            // wait
          }
        }
      }
    }

    // BACK (only resolves at end)
    if (s.side.nassauBackOn && legComplete(s.players, backIdxs) && s.isComplete) {
      const totals = legTotals(s.players, backIdxs);
      const group = firstTieGroupFromTotals(totals);
      const mult = s.side.nassauBackMultiplier ?? 1;

      if (!group) {
        add(nassau, computeNetFromTotals(totals, placement, mult));
        s.playoffs.nassauBackMode = null;
        s.playoffs.nassauBackOrder = null;
      } else {
        const res = getResolution(s, "NASSAU_BACK");

        if (!res.mode && s.side.tiesAllowed && !s.side.playoffsAllowed) {
          const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, mult);
          if (chk.ok) {
            add(nassau, chk.net);
            s.playoffs.nassauBackMode = "TIE";
            s.playoffs.nassauBackOrder = null;
          }
        } else if (res.mode === "TIE") {
          const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, mult);
          if (chk.ok) add(nassau, chk.net);
        } else if (res.mode === "PLAYOFF") {
          if (isPermutation(res.order, n)) add(nassau, computeNetFromOrder(res.order as number[], placement, mult));
        } else {
          // wait
        }
      }
    }

    // OVERALL (only resolves at end)
    if (s.side.nassauOverallOn && legComplete(s.players, overallIdxs) && s.isComplete) {
      const totals = legTotals(s.players, overallIdxs);
      const group = firstTieGroupFromTotals(totals);

      if (!group) {
        add(nassau, computeNetFromTotals(totals, placement, 1));
        s.playoffs.nassauOverallMode = null;
        s.playoffs.nassauOverallOrder = null;
      } else {
        const res = getResolution(s, "NASSAU_OVERALL");

        if (!res.mode && s.side.tiesAllowed && !s.side.playoffsAllowed) {
          const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, 1);
          if (chk.ok) {
            add(nassau, chk.net);
            s.playoffs.nassauOverallMode = "TIE";
            s.playoffs.nassauOverallOrder = null;
          }
        } else if (res.mode === "TIE") {
          const chk = tieSplitForGroup_NET(n, placement, group, s.side.tieDivisor, 1);
          if (chk.ok) add(nassau, chk.net);
        } else if (res.mode === "PLAYOFF") {
          if (isPermutation(res.order, n)) add(nassau, computeNetFromOrder(res.order as number[], placement, 1));
        } else {
          // wait
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
 * ✅ Award for streak-type rewards (zero-sum):
 * Winner gets +amount*(n-1), everyone else pays -amount.
 */
function awardZeroSum(s2: GolfState, winnerIndex: number, amount: number, label: string) {
  if (!rewardsActive(s2)) return;

  ensureRewardsArrays(s2);
  applyZeroSumTransfer(s2.rewards.streak, winnerIndex, amount);

  // event amount displayed as the winner's net gain
  const n = s2.players.length;
  const display = (Number(amount) || 0) * Math.max(0, n - 1);
  s2.events.push({ kind: "REWARD", playerIndex: winnerIndex, amount: display, label });
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

    const jackpotHit = jackpotOn && streak >= jackpotCount;
    const bonusHit = bonusOn && streak >= bonusCount;

    if (jackpotHit) {
      const alreadyBonus = !!s2.eagleBonusPaid[playerIndex];
      const diff = alreadyBonus ? jackpotValue - bonusValue : jackpotValue;

      if (diff !== 0) {
        awardZeroSum(s2, playerIndex, diff, `Eagle Streak Jackpot (${jackpotCount})`);
      }

      s2.eagleRewardMark[playerIndex][holeIdxJustFinished] = "JACKPOT";

      s2.eagleStreak[playerIndex] = 0;
      s2.eagleBonusPaid[playerIndex] = false;
    } else if (bonusHit && !s2.eagleBonusPaid[playerIndex]) {
      if (bonusValue !== 0) {
        awardZeroSum(s2, playerIndex, bonusValue, `Eagle Streak Bonus (${bonusCount})`);
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
    podiumOptions: getPlayoffOptions(s, "PODIUM"),
    frontOptions: getPlayoffOptions(s, "NASSAU_FRONT"),
    backOptions: getPlayoffOptions(s, "NASSAU_BACK"),
    overallOptions: getPlayoffOptions(s, "NASSAU_OVERALL"),
  };
}
