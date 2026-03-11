// src/engine/cricketEngine.ts

export type CricketTarget = number | "BULL" | "D" | "T";
export type CricketMode = "CLASSIC" | "CUTTHROAT";

export type CricketSetup = {
  players: string[];
  targets: CricketTarget[];
  mode: CricketMode;
  autoConcede: boolean;
  sideGames?: CricketSideGames;
};

export type Hit = {
  target: CricketTarget;
  multiplier: 1 | 2 | 3;

  // Optional: if the user chose special "T"/"D" but it came from a number ring,
  // CricketGameScreen can attach the underlying number here (e.g. sourceNumber: 20).
  sourceNumber?: number;

  // Optional: when target is "T"/"D" (special target), this tells side-games
  // it came from a treble/double ring (3/2).
  sourceMultiplier?: 2 | 3;
};

export type PlayerState = {
  name: string;
  score: number;
  eliminated: boolean;
  marks: number[]; // per target (0..3)
};

export type CricketEvents = {
  reward: boolean;
  jackpot: boolean;
  win: boolean;
};

export type CricketSideGames = {
  init?: (setup: CricketSetup) => any;

  onDart?: (ctx: {
    state: CricketState;
    playerIndex: number;
    hit: Hit;
    marksAdded: number; // 0..3
    pointsAddedClassic: number; // points added to current player (classic)
    pointsAddedToOpponents: number; // points added to opponents (cutthroat)
  }) =>
    | {
        sideGameState?: any;
        rewardsRow?: string[];
        reward?: boolean;
        jackpot?: boolean;
      }
    | void;

  onTurnEnd?: (ctx: {
    state: CricketState;
    playerIndex: number;
    turnHits: Hit[];
  }) =>
    | {
        sideGameState?: any;
        rewardsRow?: string[];
        reward?: boolean;
        jackpot?: boolean;
      }
    | void;

  getRewardsRow?: (state: CricketState) => string[];
};

export type CricketState = {
  players: PlayerState[];
  targets: CricketTarget[];
  mode: CricketMode;
  autoConcede: boolean;

  sideGames?: CricketSideGames;
  sideGameState?: any;

  rewardsRow: string[];

  events: CricketEvents;

  turn: number;
  dartInTurn: 0 | 1 | 2;

  turnHits: Hit[];

  // Snapshot of which targets were alive at the *start of the current turn*.
  // This must NOT change mid-turn (side-games use it for eligibility rules).
  turnStartAlive: boolean[]; // length == targets.length

  isComplete: boolean;
  winnerIndex: number | null;

  past: Omit<CricketState, "past" | "future">[];
  future: Omit<CricketState, "past" | "future">[];
};

// --------------------
// Utilities
// --------------------
function clampMarks(n: number) {
  if (n < 0) return 0;
  if (n > 3) return 3;
  return n;
}

function emptyEvents(): CricketEvents {
  return { reward: false, jackpot: false, win: false };
}

export function clearEvents(s: CricketState): CricketState {
  if (!s.events.reward && !s.events.jackpot && !s.events.win) return s;
  return { ...s, events: emptyEvents() };
}

function snapshot(s: CricketState): Omit<CricketState, "past" | "future"> {
  return {
    players: s.players.map((p) => ({
      name: p.name,
      score: p.score,
      eliminated: p.eliminated,
      marks: [...p.marks],
    })),
    targets: [...s.targets],
    mode: s.mode,
    autoConcede: s.autoConcede,

    sideGames: s.sideGames,
    sideGameState: s.sideGameState,

    rewardsRow: [...s.rewardsRow],
    events: { ...s.events },

    turn: s.turn,
    dartInTurn: s.dartInTurn,
    turnHits: s.turnHits.map((h) => ({ ...h })),

    turnStartAlive: Array.isArray(s.turnStartAlive) ? [...s.turnStartAlive] : [],

    isComplete: s.isComplete,
    winnerIndex: s.winnerIndex,
  };
}

function resolveRewardsRow(s: CricketState): string[] {
  const n = s.players.length;
  const sg = s.sideGames;

  if (sg && typeof sg.getRewardsRow === "function") {
    try {
      const row = sg.getRewardsRow(s);
      if (Array.isArray(row)) return Array.from({ length: n }, (_, i) => String(row[i] ?? "—"));
    } catch {
      // ignore
    }
  }

  return Array.from({ length: n }, () => "—");
}

function isTargetDeadByIndex(s: CricketState, tIdx: number) {
  for (const p of s.players) {
    if ((p.marks?.[tIdx] ?? 0) < 3) return false;
  }
  return true;
}

function computeTurnStartAlive(s: CricketState): boolean[] {
  return s.targets.map((_, tIdx) => !isTargetDeadByIndex(s, tIdx));
}

// --------------------
// Create
// --------------------
export function createCricketState(setup: CricketSetup): CricketState {
  const sideGameState = setup.sideGames?.init?.(setup);

  const base: CricketState = {
    players: setup.players.map((name) => ({
      name,
      score: 0,
      eliminated: false,
      marks: Array(setup.targets.length).fill(0),
    })),
    targets: setup.targets,
    mode: setup.mode,
    autoConcede: setup.autoConcede,

    sideGames: setup.sideGames,
    sideGameState,

    rewardsRow: Array(setup.players.length).fill("—"),
    events: emptyEvents(),

    turn: 0,
    dartInTurn: 0 as 0,
    turnHits: [],

    // turn 0 starts with everything alive (but recompute robustly)
    turnStartAlive: Array(setup.targets.length).fill(true),

    isComplete: false,
    winnerIndex: null,

    past: [],
    future: [],
  };

  const seeded = { ...base, turnStartAlive: computeTurnStartAlive(base) };
  return { ...seeded, rewardsRow: resolveRewardsRow(seeded) };
}

// --------------------
// Undo / Redo (TURN-BASED)
// --------------------
function isTurnBoundary(x: Omit<CricketState, "past" | "future">) {
  return x.dartInTurn === 0 && (x.turnHits?.length ?? 0) === 0;
}

export function undo(s: CricketState): CricketState {
  if (!s.past.length) return s;

  const past = s.past.slice();
  const traversedBack: Omit<CricketState, "past" | "future">[] = [];

  // We always include the current state as the final "redo destination"
  traversedBack.push(snapshot(s));

  // Step back at least once
  let prev = past.pop()!;
  traversedBack.push(prev);

  // Keep stepping back until we hit a turn boundary (start of a turn)
  while (past.length && !isTurnBoundary(prev)) {
    prev = past.pop()!;
    traversedBack.push(prev);
  }

  // We landed on `prev` (the boundary state). Everything we traversed (except `prev`)
  // becomes the redo path, in forward order.
  // Example: traversedBack = [D, C, B, A] -> redo path should be [B, C, D]
  const redoPath = traversedBack.slice(0, -1).reverse();

  const future = [...redoPath, ...s.future];

  return { ...(prev as any), past, future };
}

export function redo(s: CricketState): CricketState {
  if (!s.future.length) return s;

  let out: CricketState = s;
  let past = s.past.slice();
  let future = s.future.slice();

  // Step forward at least once, and keep going until we reach a turn boundary.
  // Each step replays one snapshot, rebuilding past exactly like normal redo would.
  while (future.length) {
    const next = future.shift()!;

    past.push(snapshot(out));
    out = { ...(next as any), past, future };

    if (isTurnBoundary(next)) break;
  }

  return out;
}


// --------------------
// Target State
// --------------------
function isClosedByPlayer(s: CricketState, pIdx: number, tIdx: number) {
  return s.players[pIdx].marks[tIdx] >= 3;
}

function isTargetLive(s: CricketState, tIdx: number) {
  let closed = 0;
  for (const p of s.players) {
    if (p.marks[tIdx] >= 3) closed++;
  }
  return closed >= 1 && closed < s.players.length;
}

// --------------------
// Turn Advance
// --------------------
function nextTurn(s: CricketState) {
  const n = s.players.length;
  let idx = s.turn;

  for (let i = 0; i < n; i++) {
    idx = (idx + 1) % n;
    if (!s.players[idx].eliminated) {
      const withTurnReset = { ...s, turn: idx, dartInTurn: 0 as 0, turnHits: [] as Hit[] };
      return { ...withTurnReset, turnStartAlive: computeTurnStartAlive(withTurnReset) };
    }
  }

  const withTurnReset = { ...s, dartInTurn: 0 as 0, turnHits: [] as Hit[] };
  return { ...withTurnReset, turnStartAlive: computeTurnStartAlive(withTurnReset) };
}

// --------------------
// Scoring Value
// --------------------
function targetPointValue(t: CricketTarget) {
  if (t === "BULL") return 25;
  if (t === "D") return 0;
  if (t === "T") return 0;
  return t;
}

// --------------------
// Winner Check
// --------------------
function checkWinner(s: CricketState): CricketState {
  if (s.isComplete) return s;

  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.eliminated) continue;

    const closedAll = p.marks.every((m) => m >= 3);
    if (!closedAll) continue;

    const scores = s.players.map((x) => x.score);
    const best = s.mode === "CLASSIC" ? Math.max(...scores) : Math.min(...scores);

    if (p.score === best) {
      return {
        ...s,
        isComplete: true,
        winnerIndex: i,
        events: { ...s.events, win: true },
      };
    }
  }

  return s;
}

// --------------------
// Auto Concede
// --------------------
// ✅ SAFE Cutthroat-only elimination:
// A player can be auto-eliminated ONLY if there exists an opponent who has
// CLOSED ALL targets (therefore cannot ever receive more points) and that
// opponent already has <= the player's score.
// Because scores only go UP, that player can never finish with the lowest score.
function autoConcede(s: CricketState): CricketState {
  if (!s.autoConcede) return s;
  if (s.mode !== "CUTTHROAT") return s; // ✅ cutthroat only
  if (s.players.length <= 2) return s;

  const out: CricketState = {
    ...s,
    players: s.players.map((p) => ({ ...p, marks: [...p.marks] })),
  };

  // Find players who are "immune" because they have closed everything
  const immune: number[] = [];
  for (let i = 0; i < out.players.length; i++) {
    const p = out.players[i];
    if (p.eliminated) continue;
    const closedAll = Array.isArray(p.marks) && p.marks.every((m) => (m ?? 0) >= 3);
    if (closedAll) immune.push(i);
  }

  if (immune.length === 0) return out;

  // Best (lowest) score among immune players
  const bestImmuneScore = Math.min(...immune.map((idx) => out.players[idx].score));

  // Anyone strictly above that cannot ever become the lowest
  for (let i = 0; i < out.players.length; i++) {
    const p = out.players[i];
    if (p.eliminated) continue;

    // Optional: don't eliminate immune players (not necessary but clearer)
    const closedAll = Array.isArray(p.marks) && p.marks.every((m) => (m ?? 0) >= 3);
    if (closedAll) continue;

    if (p.score > bestImmuneScore) {
      p.eliminated = true;
    }
  }

  return out;
}

// --------------------
// Side-games helpers
// --------------------
function applySideGamesOnDart(
  s: CricketState,
  playerIndex: number,
  hit: Hit,
  marksAdded: number,
  pointsClassic: number,
  pointsToOpp: number
): CricketState {
  const sg = s.sideGames;
  if (!sg?.onDart) return s;

  try {
    const res = sg.onDart({
      state: s,
      playerIndex,
      hit,
      marksAdded,
      pointsAddedClassic: pointsClassic,
      pointsAddedToOpponents: pointsToOpp,
    });

    if (!res) return s;

    return {
      ...s,
      sideGameState: (res as any).sideGameState ?? s.sideGameState,
      rewardsRow: (res as any).rewardsRow ? [...((res as any).rewardsRow as string[])] : s.rewardsRow,
      events: {
        reward: s.events.reward || !!(res as any).reward,
        jackpot: s.events.jackpot || !!(res as any).jackpot,
        win: s.events.win,
      },
    };
  } catch (e) {
    console.warn("sideGames.onDart error", e);
    return s;
  }
}

function scoringValue(hit: Hit): number {
  // Normal number target
  if (typeof hit.target === "number") {
    return hit.target;
  }

  // Bull
  if (hit.target === "BULL") {
    return 25;
  }

  // Special T/D → must use underlying number
  const sn = hit.sourceNumber;
  const sm = hit.sourceMultiplier;

  if (typeof sn === "number" && (sm === 2 || sm === 3)) {
    return sn * sm;
  }

  return 0;
}

function applySideGamesOnTurnEnd(s: CricketState, playerIndex: number): CricketState {
  const sg = s.sideGames;
  if (!sg?.onTurnEnd) return s;

  try {
    const res = sg.onTurnEnd({
      state: s,
      playerIndex,
      turnHits: s.turnHits.slice(),
    });

    if (!res) return s;

    return {
      ...s,
      sideGameState: (res as any).sideGameState ?? s.sideGameState,
      rewardsRow: (res as any).rewardsRow ? [...((res as any).rewardsRow as string[])] : s.rewardsRow,
      events: {
        reward: s.events.reward || !!(res as any).reward,
        jackpot: s.events.jackpot || !!(res as any).jackpot,
        win: s.events.win,
      },
    };
  } catch (e) {
    console.warn("sideGames.onTurnEnd error", e);
    return s;
  }
}

// --------------------
// APPLY HIT
// --------------------
export function applyHit(s: CricketState, hit: Hit): CricketState {
  if (s.isComplete) return s;

  const cur = s.turn;
  const p = s.players[cur];
  if (p.eliminated) return s;

  const ti = s.targets.findIndex((x) => x === hit.target);
  const prevSnap = snapshot(s);

  let out: CricketState = {
    ...s,
    players: s.players.map((pl) => ({
      ...pl,
      marks: [...pl.marks],
    })),
    past: [...s.past, prevSnap],
    future: [],
    events: { ...s.events },
    turnHits: [...s.turnHits, { ...hit }],
  };

  let marksAdded = 0;
  let pointsClassic = 0;
  let pointsToOpp = 0;

  if (ti >= 0) {
    const value = scoringValue(hit);

    for (let i = 0; i < hit.multiplier; i++) {
      // ✅ recompute “live” each unit, because a single dart can make the target DEAD mid-dart
      const liveNow = isTargetLive(out, ti);

      if (out.players[cur].marks[ti] < 3) {
        out.players[cur].marks[ti] = clampMarks(out.players[cur].marks[ti] + 1);
        marksAdded++;
      } else {
        if (liveNow && value > 0) {
          if (out.mode === "CLASSIC") {
            out.players[cur].score += value;
            pointsClassic += value;
          } else {
            for (let j = 0; j < out.players.length; j++) {
  if (j === cur) continue;
  if (out.players[j].eliminated) continue;

  // ✅ Cutthroat: only opponents who are still OPEN on this target receive points
  if (out.players[j].marks[ti] < 3) {
    out.players[j].score += value;
    pointsToOpp += value;
  }
}
          }
        }
      }
    }
  }

  out = applySideGamesOnDart(out, cur, hit, marksAdded, pointsClassic, pointsToOpp);
  out = { ...out, rewardsRow: resolveRewardsRow(out) };

  const wasThird = out.dartInTurn === 2;
  if (wasThird) {
    out.dartInTurn = 0 as 0;
  } else {
    out.dartInTurn = (out.dartInTurn + 1) as 0 | 1 | 2;
  }

  if (wasThird) {
    // Determine concede + winner BEFORE turn-end side-games
    out = autoConcede(out);
    out = checkWinner(out);

    out = applySideGamesOnTurnEnd(out, cur);

    // Only advance if not complete
    if (!out.isComplete) out = nextTurn(out);

    out = { ...out, rewardsRow: resolveRewardsRow(out) };
  }

  return out;
}

// --------------------
// END TURN EARLY (skip remaining darts)
// --------------------
export function endTurn(s: CricketState): CricketState {
  if (s.isComplete) return s;

  const cur = s.turn;
  const prevSnap = snapshot(s);

  let out: CricketState = {
    ...s,
    past: [...s.past, prevSnap],
    future: [],
    events: { ...s.events },
  };

  out = applySideGamesOnTurnEnd(out, cur);

  // Reset turn state (stay on same player until we advance)
  out = { ...out, dartInTurn: 0 as 0, turnHits: [] as Hit[] };

  out = autoConcede(out);
  out = checkWinner(out);

  if (!out.isComplete) out = nextTurn(out);

  out = { ...out, rewardsRow: resolveRewardsRow(out) };
  return out;
}

// --------------------
// Public Winner Getter
// --------------------
export function getWinner(s: CricketState): { winnerIdx: number | null; canConcede: boolean } {
  // "canConcede" is only meaningful when:
  // - game isn't complete
  // - cutthroat (elimination concept exists)
  // - there are enough players for concede to matter
  const canConcede =
    !s.isComplete &&
    s.mode === "CUTTHROAT" &&
    s.players.length > 2 &&
    // at least 2 players still active
    s.players.filter((p) => !p.eliminated).length >= 2;

  return {
    winnerIdx: s.winnerIndex,
    canConcede,
  };
}

