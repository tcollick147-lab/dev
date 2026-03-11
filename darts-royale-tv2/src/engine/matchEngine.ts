// src/engine/matchEngine.ts

import type { MatchInRule, MatchOutRule } from "../types/navigation";

export type DartCode =
  | "MISS"
  | "SB" // single bull (25)
  | "DB" // double bull (50)
  | `${"S" | "D" | "T"}${number}`; // e.g. S20, D16, T19

export type PlayerMatchState = {
  name: string;
  remaining: number;
  hasCheckedIn: boolean; // DOUBLE/MASTER in only; STRAIGHT means always in
};

export type MatchEvent = { playerIndex: number; amount: number; label: string };

export type MatchSideConfig = {
  // Score rewards
  scoreBonusOn: boolean;
  scoreBonusThreshold: number;
  scoreBonusValue: number;

  scoreJackpotOn: boolean;
  scoreJackpotThreshold: number;
  scoreJackpotValue: number;

  // Match winner pot
  gameWinnerOn: boolean;
  entry: number;

  // Checkout rewards
  checkoutBonusOn: boolean;
  checkoutBonusThreshold: number;
  checkoutBonusValue: number;

  checkoutJackpotOn: boolean;
  checkoutJackpotThreshold: number;
  checkoutJackpotValue: number;

  // Bull bonus (DB checkout only)
  bullOn: boolean;
  bullValue: number;
};

export type MatchState = {
  players: PlayerMatchState[];
  currentIndex: number;

  // current turn
  turnDarts: DartCode[];
  turnScore: number;
  turnBusted: boolean;

  // baselines for this turn (for replay/backspace)
  turnStartRemaining: number;
  turnStartCheckedIn: boolean;

  turnStartTokens: number[];
  turnStartEventsLen: number;
  turnStartGameWinnerAwarded: boolean;

  // rules
  inRule: MatchInRule;
  outRule: MatchOutRule;

  // winner
  winnerIndex: number | null;

  // match-winner pot state
  gameWinnerAwarded: boolean;

  // tokens/events
  tokens: number[];
  events: MatchEvent[];

  // UI/debug
  turnScoreReward: "none" | "bonus" | "jackpot";
  turnScoreRewardAmount: number;

  side: MatchSideConfig;

  // ✅ per-turn history (pushed only on endTurn)
  turnPast: TurnSnapshot[];
};

type TurnSnapshot = Omit<MatchState, "turnPast">;

function cloneSnapshot(state: MatchState): TurnSnapshot {
  const { turnPast, ...rest } = state;
  return {
    ...rest,
    players: rest.players.map((p) => ({ ...p })),
    turnDarts: [...rest.turnDarts],
    tokens: [...rest.tokens],
    events: [...rest.events],
    side: { ...rest.side },
    turnStartTokens: [...rest.turnStartTokens],
  };
}

export function createMatchState(opts: {
  playerNames: string[];
  startScore: number;
  inRule: MatchInRule;
  outRule: MatchOutRule;
}): MatchState {
  const players: PlayerMatchState[] = opts.playerNames.map((name) => ({
    name,
    remaining: opts.startScore,
    hasCheckedIn: opts.inRule === "STRAIGHT",
  }));

  const startTokens = new Array(players.length).fill(0);
  const startCheckedIn = players[0]?.hasCheckedIn ?? (opts.inRule === "STRAIGHT");

  return {
    players,
    currentIndex: 0,

    turnDarts: [],
    turnScore: 0,
    turnBusted: false,

    turnStartRemaining: opts.startScore,
    turnStartCheckedIn: startCheckedIn,

    turnStartTokens: [...startTokens],
    turnStartEventsLen: 0,
    turnStartGameWinnerAwarded: false,

    inRule: opts.inRule,
    outRule: opts.outRule,

    winnerIndex: null,

    gameWinnerAwarded: false,

    tokens: [...startTokens],
    events: [],

    turnScoreReward: "none",
    turnScoreRewardAmount: 0,

    side: {
      scoreBonusOn: true,
      scoreBonusThreshold: 80,
      scoreBonusValue: 5,

      scoreJackpotOn: true,
      scoreJackpotThreshold: 100,
      scoreJackpotValue: 10,

      gameWinnerOn: true,
      entry: 20,

      checkoutBonusOn: true,
      checkoutBonusThreshold: 80,
      checkoutBonusValue: 5,

      checkoutJackpotOn: true,
      checkoutJackpotThreshold: 100,
      checkoutJackpotValue: 20,

      bullOn: true,
      bullValue: 20,
    },

    turnPast: [],
  };
}

export function scoreOf(dart: DartCode): number {
  if (dart === "MISS") return 0;
  if (dart === "SB") return 25;
  if (dart === "DB") return 50;

  const mult = dart[0];
  const n = Number(dart.slice(1));
  if (!Number.isFinite(n) || n < 1 || n > 20) return 0;

  if (mult === "S") return n;
  if (mult === "D") return n * 2;
  return n * 3;
}

function isDoubleOrBull(dart: DartCode): boolean {
  return dart === "DB" || dart.startsWith("D");
}

function isMasterOut(dart: DartCode): boolean {
  return dart === "DB" || dart.startsWith("D") || dart.startsWith("T");
}

function validOut(dart: DartCode, outRule: MatchOutRule): boolean {
  if (outRule === "STRAIGHT") return true;
  if (outRule === "DOUBLE") return isDoubleOrBull(dart);
  return isMasterOut(dart);
}

function dartQualifiesForCheckIn(dart: DartCode, inRule: MatchInRule): boolean {
  if (inRule === "STRAIGHT") return true;
  if (inRule === "DOUBLE") return dart.startsWith("D") || dart === "DB";
  // MASTER
  return (
    dart.startsWith("D") ||
    dart.startsWith("T") ||
    dart === "DB" ||
    dart === "SB"
  );
}

/**
 * Everyone except winner pays amountPerPayer; winner receives total.
 */
function transferAllPayWinner(
  state: MatchState,
  winnerIndex: number,
  amountPerPayer: number,
  label: string
): MatchState {
  const n = state.players.length;
  if (n < 2 || amountPerPayer === 0) return state;

  const tokens = [...state.tokens];
  for (let i = 0; i < n; i++) {
    if (i === winnerIndex) continue;
    tokens[i] -= amountPerPayer;
    tokens[winnerIndex] += amountPerPayer;
  }

  return {
    ...state,
    tokens,
    events: [...state.events, { playerIndex: winnerIndex, amount: amountPerPayer * (n - 1), label }],
  };
}

function applyScoreRewardsAtTurnEnd(state: MatchState): MatchState {
  const s = state.side;

  if (state.turnBusted || state.turnScore <= 0) {
    return { ...state, turnScoreReward: "none", turnScoreRewardAmount: 0 };
  }

  if (s.scoreJackpotOn && state.turnScore >= s.scoreJackpotThreshold) {
    const updated = transferAllPayWinner(
      state,
      state.currentIndex,
      s.scoreJackpotValue,
      `Score Jackpot (>= ${s.scoreJackpotThreshold})`
    );
    return { ...updated, turnScoreReward: "jackpot", turnScoreRewardAmount: s.scoreJackpotValue };
  }

  if (s.scoreBonusOn && state.turnScore >= s.scoreBonusThreshold) {
    const updated = transferAllPayWinner(
      state,
      state.currentIndex,
      s.scoreBonusValue,
      `Score Bonus (>= ${s.scoreBonusThreshold})`
    );
    return { ...updated, turnScoreReward: "bonus", turnScoreRewardAmount: s.scoreBonusValue };
  }

  return { ...state, turnScoreReward: "none", turnScoreRewardAmount: 0 };
}

/**
 * INTERNAL: apply a dart without auto-ending turn and without replay logic.
 */
function applyDartCore(state: MatchState, dart: DartCode): MatchState {
  if (state.winnerIndex !== null) return state;
  if (state.turnDarts.length >= 3) return state;

  let next: MatchState = { ...state };

  // copy current player
  const p = { ...next.players[next.currentIndex] };
  next.players = next.players.map((x, i) => (i === next.currentIndex ? p : x));

  // consume dart
  next.turnDarts = [...next.turnDarts, dart];

  // straight in
  if (!p.hasCheckedIn && next.inRule === "STRAIGHT") p.hasCheckedIn = true;

  // if not checked in, see if dart qualifies
  if (!p.hasCheckedIn) {
    if (!dartQualifiesForCheckIn(dart, next.inRule)) {
      return next; // wasted dart
    }
    p.hasCheckedIn = true; // qualifying in-dart also scores
  }

  const val = scoreOf(dart);
  next.turnScore += val;

  const newRemaining = p.remaining - val;

  // bust
  if (
    newRemaining < 0 ||
    ((next.outRule === "DOUBLE" || next.outRule === "MASTER") && newRemaining === 1)
  ) {
    p.remaining = next.turnStartRemaining;
    next.turnBusted = true;
    return next;
  }

  // finish
  if (newRemaining === 0) {
    if (!validOut(dart, next.outRule)) {
      p.remaining = next.turnStartRemaining;
      next.turnBusted = true;
      return next;
    }

    const checkoutFrom = p.remaining;

    // match winner pot
    if (next.side.gameWinnerOn && !next.gameWinnerAwarded && next.side.entry > 0) {
      next = transferAllPayWinner(
        next,
        next.currentIndex,
        next.side.entry,
        `Match Winner (Entry ${next.side.entry})`
      );
      next.gameWinnerAwarded = true;
    }

    // checkout rewards
    if (next.side.checkoutJackpotOn && checkoutFrom >= next.side.checkoutJackpotThreshold) {
      next = transferAllPayWinner(
        next,
        next.currentIndex,
        next.side.checkoutJackpotValue,
        `Checkout Jackpot (>= ${next.side.checkoutJackpotThreshold})`
      );
    } else if (next.side.checkoutBonusOn && checkoutFrom >= next.side.checkoutBonusThreshold) {
      next = transferAllPayWinner(
        next,
        next.currentIndex,
        next.side.checkoutBonusValue,
        `Checkout Bonus (>= ${next.side.checkoutBonusThreshold})`
      );
    }

    // bull bonus (DB checkout only)
    if (next.side.bullOn && dart === "DB") {
      next = transferAllPayWinner(next, next.currentIndex, next.side.bullValue, "Bull Bonus (DB checkout)");
    }

    // winner
    const p2 = { ...next.players[next.currentIndex], remaining: 0 };
    next.players = next.players.map((x, i) => (i === next.currentIndex ? p2 : x));
    next.winnerIndex = next.currentIndex;

    return next;
  }

  // normal scoring
  p.remaining = newRemaining;
  return next;
}

/**
 * Public: apply a dart (no auto end-turn)
 */
export function applyDart(state: MatchState, dart: DartCode): MatchState {
  return applyDartCore(state, dart);
}

/**
 * Replay current turn from turn-start baselines, restoring tokens/events too.
 * This makes ⌫ safe even after checkout awards.
 */
function replayTurnFromStart(state: MatchState, darts: DartCode[]): MatchState {
  let base: MatchState = { ...state };

  // reset per-turn fields
  base.turnDarts = [];
  base.turnScore = 0;
  base.turnBusted = false;
  base.turnScoreReward = "none";
  base.turnScoreRewardAmount = 0;

  // restore reversible globals
  base.tokens = [...base.turnStartTokens];
  base.events = base.events.slice(0, base.turnStartEventsLen);
  base.gameWinnerAwarded = base.turnStartGameWinnerAwarded;

  // clear winner for replay
  base.winnerIndex = null;

  // restore current player's start values
  const p = { ...base.players[base.currentIndex] };
  p.remaining = base.turnStartRemaining;
  p.hasCheckedIn = base.turnStartCheckedIn;
  base.players = base.players.map((x, i) => (i === base.currentIndex ? p : x));

  // replay darts
  let cur = base;
  for (const d of darts) {
    cur = applyDartCore(cur, d);
    if (cur.winnerIndex !== null) break;
    if (cur.turnBusted) break;
    if (cur.turnDarts.length >= 3) break;
  }

  return cur;
}

/**
 * ⌫ remove last dart (per-dart undo)
 */
export function removeLastDart(state: MatchState): MatchState {
  if (!state.turnDarts.length) return state;
  return replayTurnFromStart(state, state.turnDarts.slice(0, -1));
}

/**
 * Enable Next Turn when either:
 * - bust happened, or
 * - 3 darts thrown
 */
export function isTurnReadyToCommit(state: MatchState): boolean {
  if (state.winnerIndex !== null) return false;
  if (state.turnBusted) return true;
  return state.turnDarts.length >= 3;
}

/**
 * Commit the turn and advance to next player.
 * Pushes a snapshot so Back can undo the last committed turn.
 */
export function endTurn(state: MatchState): MatchState {
  if (state.winnerIndex !== null) return state;
  if (state.players.length < 1) return state;

  const committedSnap = cloneSnapshot(state);

  const withRewards = applyScoreRewardsAtTurnEnd(state);
  const nextIndex = (withRewards.currentIndex + 1) % withRewards.players.length;

  return {
    ...withRewards,
    turnPast: [...withRewards.turnPast, committedSnap],

    currentIndex: nextIndex,

    // reset new turn
    turnDarts: [],
    turnScore: 0,
    turnBusted: false,
    turnScoreReward: "none",
    turnScoreRewardAmount: 0,

    // baselines for next player
    turnStartRemaining: withRewards.players[nextIndex].remaining,
    turnStartCheckedIn: withRewards.players[nextIndex].hasCheckedIn,

    // snapshot globals for reversibility during next turn
    turnStartTokens: [...withRewards.tokens],
    turnStartEventsLen: withRewards.events.length,
    turnStartGameWinnerAwarded: withRewards.gameWinnerAwarded,
  };
}

/**
 * Back = undo last committed turn (does not touch current-turn darts directly)
 */
export function backTurn(state: MatchState): MatchState {
  if (!state.turnPast.length) return state;

  const prev = state.turnPast[state.turnPast.length - 1];
  const remainingPast = state.turnPast.slice(0, -1);

  return {
    ...(prev as MatchState),
    turnPast: remainingPast,
  };
}
