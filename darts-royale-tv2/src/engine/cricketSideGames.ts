// src/engine/cricketSideGames.ts

import type {
  CricketSetup,
  CricketState,
  CricketSideGames as CricketSideGamesImpl,
  Hit,
  CricketTarget,
} from "./cricketEngine";

type CricketValueThreshold = { value: number; threshold: number };

export type CricketSideGamesConfig = {
  enabled: boolean;

  matchWinnerRewardsOn: boolean;
  matchWinnerRewardValue?: number;

  comboStrikeBonusOn: boolean;
  comboStrikeBonus?: CricketValueThreshold;

  comboStrikeJackpotOn: boolean;
  comboStrikeJackpot?: CricketValueThreshold;

  doubleBonusOn: boolean;
  doubleBonus?: CricketValueThreshold;

  trebleBonusOn: boolean;
  trebleBonus?: CricketValueThreshold;

  bullBonusOn: boolean;
  bullBonus?: CricketValueThreshold;

  bullJackpotOn: boolean;
  bullJackpot?: CricketValueThreshold;
};

type TurnStats = {
  // Combo Strike: same NUMBER only, count units (S=1, D=2, T=3)
  comboNumberKey: string | null;
  comboOk: boolean;
  comboUnits: number;
  // Per-number units so we can award combo when any single number reaches threshold (e.g. T20+T20 then T19)
  comboUnitsByNumber: Record<string, number>;

  // bonuses
  doubles: number; // count of qualifying double-ring throws
  trebles: number; // count of qualifying treble-ring throws
  bullUnits: number; // ✅ bull units (SB=1, DB=2)

  // focus (kept only for debugging clarity)
  validHits: number;
  focusTargetKey: string | null;
  focusOk: boolean;
};

export type CricketSideGameEvent = { playerIndex: number; amount: number; label: string };

type SideState = {
  config: CricketSideGamesConfig;
  totals: number[]; // NET per player (zero-sum)
  events: CricketSideGameEvent[];
  winnerPaid: boolean;
  turn: TurnStats;
};

function fmt(n: number) {
  const v = Math.trunc(Number(n) || 0);
  if (v === 0) return "0";
  return v > 0 ? `+${v}` : `${v}`;
}

function emptyTurn(): TurnStats {
  return {
    comboNumberKey: null,
    comboOk: true,
    comboUnits: 0,
    comboUnitsByNumber: {},

    doubles: 0,
    trebles: 0,
    bullUnits: 0,

    validHits: 0,
    focusTargetKey: null,
    focusOk: true,
  };
}

// Zero-sum NET transfer:
// winner gets +amount*(n-1), everyone else gets -amount
function applyZeroSumNet(totals: number[], winnerIndex: number, amount: number) {
  const n = totals.length;
  const amt = Math.trunc(Number(amount) || 0);
  if (n <= 1) return totals;
  if (amt === 0) return totals;

  const out = totals.slice();
  for (let i = 0; i < n; i++) {
    if (i === winnerIndex) continue;
    out[i] = (out[i] ?? 0) - amt;
  }
  out[winnerIndex] = (out[winnerIndex] ?? 0) + amt * (n - 1);
  return out;
}

// Apply zero-sum and append one event per player for the breakdown
function applyZeroSumNetWithEvents(
  totals: number[],
  events: CricketSideGameEvent[],
  winnerIndex: number,
  amount: number,
  label: string
): number[] {
  const n = totals.length;
  const amt = Math.trunc(Number(amount) || 0);
  if (n <= 1) return totals;
  if (amt === 0) return totals;

  const out = totals.slice();
  for (let i = 0; i < n; i++) {
    if (i === winnerIndex) {
      out[i] = (out[i] ?? 0) + amt * (n - 1);
      events.push({ playerIndex: i, amount: amt * (n - 1), label });
    } else {
      out[i] = (out[i] ?? 0) - amt;
      events.push({ playerIndex: i, amount: -amt, label });
    }
  }
  return out;
}

function ensureVT(vt: CricketValueThreshold | undefined, fallbackValue: number, fallbackThreshold: number) {
  const value = Math.trunc(Number(vt?.value ?? fallbackValue) || fallbackValue);
  const threshold = Math.max(1, Math.trunc(Number(vt?.threshold ?? fallbackThreshold) || fallbackThreshold));
  return { value, threshold };
}

function shouldCountHit(hit: Hit) {
  const t = (hit as any)?.target;
  if (t === "__NO_SCORE__") return false;
  return t !== null && t !== undefined;
}

function isBullTarget(target: CricketTarget) {
  return target === "BULL";
}

/**
 * Underlying number for "same number" logic:
 * - If hit.target is number => that number
 * - Else if hit.sourceNumber provided => use that
 * - Else null
 */
function underlyingNumber(hit: Hit): number | null {
  if (typeof hit.target === "number") return hit.target;
  const sn = (hit as any)?.sourceNumber;
  return Number.isFinite(sn) ? (sn as number) : null;
}

/**
 * Check if a target is eligible based on "alive at start of turn".
 * We use state.turnStartAlive[], indexed by state.targets.
 */
function aliveAtTurnStart(state: CricketState, target: CricketTarget): boolean {
  const idx = state.targets.findIndex((x) => x === target);
  if (idx < 0) return false;
  const arr = (state as any).turnStartAlive as boolean[] | undefined;
  if (!Array.isArray(arr) || typeof arr[idx] !== "boolean") return true; // fallback permissive
  return !!arr[idx];
}

function rewardsRowFromTotals(totals: number[]) {
  return totals.map((x) => fmt(x));
}

function dbgPay(label: string, meta: any) {
  console.log("[SIDEGAMES PAY]", label, meta);
}

export function buildCricketSideGames(config: CricketSideGamesConfig | undefined): CricketSideGamesImpl | undefined {
  if (!config) return undefined;

  const impl: CricketSideGamesImpl = {
    init: (setup: CricketSetup) => {
      const n = setup.players.length;
      const base: SideState = {
        config: { ...config },
        totals: Array(n).fill(0),
        events: [],
        winnerPaid: false,
        turn: emptyTurn(),
      };
      return base;
    },

    getRewardsRow: (state: CricketState) => {
      const ss = state.sideGameState as SideState | undefined;
      if (!ss?.config?.enabled) return Array(state.players.length).fill("—");
      return rewardsRowFromTotals(ss.totals ?? Array(state.players.length).fill(0));
    },

    onDart: ({ state, hit }) => {
      const ss = state.sideGameState as SideState | undefined;
      if (!ss || !ss.config?.enabled) return;

      const turn = { ...(ss.turn ?? emptyTurn()) };

      if (shouldCountHit(hit)) {
        // --------------------------
        // Combo units: SAME UNDERLYING NUMBER, units based on ring (S=1, D=2, T=3)
        // Eligible only if that number is alive at start of turn
        // --------------------------
        const num = underlyingNumber(hit);
        const numEligible = num !== null && aliveAtTurnStart(state, num);

        // Determine ring-units for combo:
        // - If normal number hit: use hit.multiplier (1/2/3)
        // - If special "T"/"D": use hit.sourceMultiplier (3/2) if provided, else treat as 1
        const srcMult = (hit as any)?.sourceMultiplier;
        const ringUnits =
          typeof srcMult === "number" && (srcMult === 2 || srcMult === 3)
            ? srcMult
            : Math.max(1, Math.trunc((hit as any)?.multiplier ?? 1));

        if (numEligible) {
          const k = String(num);
          if (turn.comboUnits === 0) {
            turn.comboNumberKey = k;
            turn.comboOk = true;
          } else {
            if (turn.comboNumberKey !== k) turn.comboOk = false;
          }
          turn.comboUnits += ringUnits;
          turn.comboUnitsByNumber = { ...(turn.comboUnitsByNumber ?? {}), [k]: (turn.comboUnitsByNumber?.[k] ?? 0) + ringUnits };
        }

        // --------------------------
        // Double/Treble tracking
        // - normal D/T on numbers -> hit.multiplier = 2/3
        // - special target "D"/"T" -> hit.sourceMultiplier = 2/3
        // Double: eligible if special "D" is alive at start of turn.
        // Treble: eligible if special "T" is alive OR hit is on a live number (so 3 trebles on different live numbers all count).
        // Treat multiplier===3 as treble ring even if sourceMultiplier was missing.
        // --------------------------
        const isDoubleRing = ringUnits === 2;
        const isTrebleRing =
          ringUnits === 3 || (typeof (hit as any).target === "number" && (hit as any).multiplier === 3);

        if (isDoubleRing && aliveAtTurnStart(state, "D")) {
          turn.doubles += 1;
        }
        const trebleEligible =
          aliveAtTurnStart(state, "T") ||
          (num !== null && aliveAtTurnStart(state, num)) ||
          (num === null &&
            state.targets.some((t): t is number => typeof t === "number" && aliveAtTurnStart(state, t)));
        if (isTrebleRing && trebleEligible) {
          turn.trebles += 1;
        }

        // --------------------------
        // Bull units (SB=1, DB=2) for thresholds
        // Eligible only if BULL alive at turn start
        // --------------------------
        if (isBullTarget(hit.target) && aliveAtTurnStart(state, "BULL")) {
          turn.bullUnits += Math.max(1, Math.trunc((hit as any)?.multiplier ?? 1));
        }

        // --------------------------
        // Debug focus tracking (not used for rewards anymore)
        // --------------------------
        const fk = String(hit.target);
        if (turn.validHits === 0) {
          turn.focusTargetKey = fk;
          turn.focusOk = true;
        } else {
          if (turn.focusTargetKey !== fk) turn.focusOk = false;
        }
        turn.validHits += 1;
      }

      return { sideGameState: { ...ss, turn } };
    },

    onTurnEnd: ({ state, playerIndex }) => {
      const ss = state.sideGameState as SideState | undefined;
      if (!ss || !ss.config?.enabled) return;

      const cfg = ss.config;
      const n = state.players.length;

      let totals = ss.totals ?? Array(n).fill(0);
      const events = Array.isArray(ss.events) ? [...ss.events] : [];

      let reward = false;
      let jackpot = false;

      const t = ss.turn ?? emptyTurn();
      const beforeTotals = totals.slice();
      const maxComboUnits = Math.max(0, ...Object.values(t.comboUnitsByNumber ?? {}));

      // --------------------------
      // Combo Strike BONUS / JACKPOT (no header toggle; these stand alone)
      // Jackpot and Bonus are mutually exclusive (Jackpot wins).
      // Award when all darts same number (comboOk) OR when any single number has >= threshold units (e.g. T20+T20 then T19).
      // --------------------------
      let comboJackpotHit = false;

      if (cfg.comboStrikeJackpotOn) {
        const { value, threshold } = ensureVT(cfg.comboStrikeJackpot, 50, 8);
        if ((t.comboOk && t.comboUnits >= threshold) || maxComboUnits >= threshold) {
          totals = applyZeroSumNetWithEvents(totals, events, playerIndex, value, "Combo Strike Jackpot");
          reward = true;
          jackpot = true;
          comboJackpotHit = true;
        }
      }

      if (!comboJackpotHit && cfg.comboStrikeBonusOn) {
        const { value, threshold } = ensureVT(cfg.comboStrikeBonus, 30, 6);
        if ((t.comboOk && t.comboUnits >= threshold) || maxComboUnits >= threshold) {
          totals = applyZeroSumNetWithEvents(totals, events, playerIndex, value, "Combo Strike Bonus");
          reward = true;
        }
      }

      // --------------------------
      // Double Bonus
      // --------------------------
      if (cfg.doubleBonusOn) {
        const { value, threshold } = ensureVT(cfg.doubleBonus, 30, 2);
        if (t.doubles >= threshold) {
          totals = applyZeroSumNetWithEvents(totals, events, playerIndex, value, "Double Bonus");
          reward = true;
        }
      }

      // --------------------------
      // Treble Bonus
      // --------------------------
      if (cfg.trebleBonusOn) {
        const { value, threshold } = ensureVT(cfg.trebleBonus, 30, 3);
        if (t.trebles >= threshold) {
          totals = applyZeroSumNetWithEvents(totals, events, playerIndex, value, "Treble Bonus");
          reward = true;
        }
      }

      // --------------------------
      // Bull Jackpot / Bull Bonus (mutually exclusive, jackpot wins)
      // Uses bullUnits (SB=1, DB=2)
      // --------------------------
      let bullJackpotHit = false;

      if (cfg.bullJackpotOn) {
        const { value, threshold } = ensureVT(cfg.bullJackpot, 50, 2);
        if (t.bullUnits >= threshold) {
          totals = applyZeroSumNetWithEvents(totals, events, playerIndex, value, "Bull Jackpot");
          reward = true;
          jackpot = true;
          bullJackpotHit = true;
        }
      }

      if (!bullJackpotHit && cfg.bullBonusOn) {
        const { value, threshold } = ensureVT(cfg.bullBonus, 30, 1);
        if (t.bullUnits >= threshold) {
          totals = applyZeroSumNetWithEvents(totals, events, playerIndex, value, "Bull Bonus");
          reward = true;
        }
      }

      // --------------------------
      // Match Winner Reward (configurable)
      // --------------------------
      let winnerPaid = !!ss.winnerPaid;
      if (cfg.matchWinnerRewardsOn && state.isComplete && state.winnerIndex !== null && !winnerPaid) {
        const value = Math.trunc(Number(cfg.matchWinnerRewardValue ?? 100) || 100);
        totals = applyZeroSumNetWithEvents(totals, events, state.winnerIndex, value, "Match Winner");
        reward = true;
        jackpot = true;
        winnerPaid = true;
      }

      const next: SideState = {
        ...ss,
        totals,
        events,
        winnerPaid,
        turn: emptyTurn(),
      };

      dbgPay("TURN_END_TOTAL", {
        playerIndex,
        reward,
        jackpot,
        beforeTotals,
        afterTotals: totals.slice(),
        turn: t,
      });

      return {
        sideGameState: next,
        rewardsRow: rewardsRowFromTotals(totals),
        reward,
        jackpot,
      };
    },
  };

  return impl;
}
