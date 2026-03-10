// src/engine/killerEngine.ts – Killer game logic

import type { DartCode } from "./matchEngine";
import type {
  KillerGameState,
  KillerPlayer,
  KillerSettings,
  KillerSetup,
  KillerSetupPayload,
  PlayerId,
} from "./killerTypes";

export type { KillerGameState, KillerPlayer, KillerSetup, KillerSetupPayload };

/** Parse dart to segment (1–20) and multiplier (1=S, 2=D, 3=T). Bull/MISS => null segment. */
function parseDart(dart: DartCode): { segment: number | null; multiplier: number } {
  if (dart === "MISS") return { segment: null, multiplier: 0 };
  if (dart === "SB" || dart === "DB") return { segment: null, multiplier: 0 };

  const mult = dart[0];
  const n = parseInt(dart.slice(1), 10);
  if (!Number.isFinite(n) || n < 1 || n > 20) return { segment: null, multiplier: 0 };

  const multiplier =
    mult === "S" ? 1 : mult === "D" ? 2 : mult === "T" ? 3 : 0;
  return { segment: n, multiplier };
}

export function ensureDefaultPlacement(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) =>
    i === 0 ? 10 : i === n - 1 ? -10 : 0
  );
  const sum = arr.reduce((a, b) => a + b, 0);
  arr[n - 1] -= sum;
  return arr;
}

export function createKillerState(setup: KillerSetup): KillerGameState {
  const placement =
    setup.placementRewardAmounts.length === setup.players.length
      ? setup.placementRewardAmounts
      : ensureDefaultPlacement(setup.players.length);

  const players: KillerPlayer[] = setup.players.map((p, idx) => ({
    id: `p-${idx}-${p.name}`,
    name: p.name,
    color: p.playerColor,
    assignedNumber: p.assignedNumber,
    armProgress: 0,
    isArmed: false,
    hasCompletedArm: false,
    livesRemaining: setup.lives,
    isEliminated: false,
    killsCount: 0,
    killRewardsBalance: 0,
    placementReward: 0,
  }));

  const settings: KillerSettings = {
    armPoints: setup.armPoints ?? 3,
    armMode: setup.armMode ?? "points",
    lives: setup.lives,
    recharge: !!setup.recharge,
    fullLivesToArm: !!(setup.fullLivesToArm ?? (setup as { rechargeToRearm?: boolean }).rechargeToRearm),
    turnKillCap: setup.turnKillCap,
    placementRewardsEnabled: setup.placementRewardsOn,
    placementRewardAmounts: placement,
    killRewardsEnabled: setup.killRewardsOn,
    killRewardValue: setup.killRewardValue,
  };

  const firstPlayerId = players[0].id;
  const targetableThisTurn = getTargetableThisTurn(firstPlayerId, players, settings.turnKillCap);

  const initialState: KillerGameState = {
    players,
    currentPlayerIndex: 0,
    turnTargetsHit: new Set<PlayerId>(),
    targetableThisTurn,
    eliminationOrder: [],
    settings,
    winnerId: null,
    turnPills: [],
    turnDarts: [],
    turnStartSnapshot: null,
    turnPast: [],
  };
  initialState.turnStartSnapshot = cloneForSnapshot(initialState);
  return initialState;
}

/** Clone state for snapshot (turnPast/turnStartSnapshot cleared to avoid recursion). */
function cloneForSnapshot(state: KillerGameState): KillerGameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    turnTargetsHit: new Set(state.turnTargetsHit),
    targetableThisTurn: new Set(state.targetableThisTurn),
    eliminationOrder: [...state.eliminationOrder],
    turnPills: state.turnPills.map((x) => ({ ...x })),
    turnDarts: [...(state.turnDarts || [])],
    turnPast: [],
    turnStartSnapshot: null,
  };
}

function countAlive(players: KillerPlayer[]): number {
  return players.filter((p) => !p.isEliminated).length;
}

function nextPlayerIndex(state: KillerGameState): number {
  const { players, currentPlayerIndex } = state;
  let next = (currentPlayerIndex + 1) % players.length;
  while (players[next].isEliminated && next !== currentPlayerIndex) {
    next = (next + 1) % players.length;
  }
  return next;
}

/** Effective protection: never leave zero targets. Max protected = aliveOpponents - 1 so at least one remains targetable. */
function getTargetableThisTurn(
  currentPlayerId: PlayerId,
  players: KillerPlayer[],
  configuredProtection: number
): Set<PlayerId> {
  const eligible = players.filter((p) => !p.isEliminated && p.id !== currentPlayerId);
  if (eligible.length === 0) return new Set<PlayerId>();
  if (eligible.length === 1) return new Set(eligible.map((p) => p.id)); // one opponent = no protection
  const effectiveProtection = Math.min(
    Math.max(0, configuredProtection),
    eligible.length - 1
  );
  const targetableCount = eligible.length - effectiveProtection; // >= 1
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  return new Set(shuffled.slice(0, targetableCount).map((p) => p.id));
}

/** Apply one dart and return new state. Does not advance turn; caller calls endKillerTurn to advance. */
export function applyKillerDart(
  state: KillerGameState,
  dart: DartCode
): KillerGameState {
  const { segment, multiplier } = parseDart(dart);
  const current = state.players[state.currentPlayerIndex];
  if (!current || current.isEliminated) return state;

  const turnTargetsHit = new Set(state.turnTargetsHit);
  const turnPills = [...state.turnPills];

  // Own number -> Full Lives to Arm: restore lives first, then arm. Otherwise normal arm/recharge.
  if (segment !== null && segment === current.assignedNumber) {
    let newArmProgress = current.armProgress;
    let isArmed = current.isArmed;
    let newLives = current.livesRemaining;
    const fullLivesToArm = state.settings.fullLivesToArm;
    const maxLives = state.settings.lives;

    // Full Lives to Arm: restore lives first, then any remainder counts toward arm (points mode only; double/treble need a qualifying dart)
    if (fullLivesToArm && !current.isArmed && current.livesRemaining < maxLives) {
      const livesNeeded = maxLives - current.livesRemaining;
      const toLives = Math.min(multiplier, livesNeeded);
      newLives = current.livesRemaining + toLives;
      const toArm = multiplier - toLives;
      const mode = state.settings.armMode ?? "points";
      if (toArm > 0 && mode === "points") {
        newArmProgress = Math.min(state.settings.armPoints, current.armProgress + toArm);
      }
      // isArmed set below from armSatisfied && lives at max
    } else if (!current.isArmed) {
      // Arm logic: Points = accumulate; Double = D on own number; Treble = T on own number
      const mode = state.settings.armMode ?? "points";
      if (mode === "points") {
        const totalFromDart = current.armProgress + multiplier;
        newArmProgress = Math.min(totalFromDart, state.settings.armPoints);
        isArmed = newArmProgress >= state.settings.armPoints;
        // Arm overhit → Recharge: extra hits from this throw apply to recharge if enabled and below max lives
        if (isArmed && state.settings.recharge && newLives < state.settings.lives) {
          const extra = totalFromDart - state.settings.armPoints;
          if (extra > 0) {
            const room = state.settings.lives - newLives;
            newLives = Math.min(state.settings.lives, newLives + Math.min(extra, room));
          }
        }
      } else if (mode === "double" && multiplier === 2) {
        isArmed = true;
      } else if (mode === "treble" && multiplier === 3) {
        isArmed = true;
      }
    } else if (state.settings.recharge) {
      // Recharge logic only: player is Armed, add shields (cap at Lives)
      newLives = Math.min(
        state.settings.lives,
        current.livesRemaining + multiplier
      );
    }
    // Recharge to rearm: when disarmed but arm already satisfied and lives < max, own-number hit recharges (no arm progress when fullLivesToArm already handled above)
    if (
      !fullLivesToArm &&
      !current.isArmed &&
      (current.armProgress >= state.settings.armPoints || current.hasCompletedArm) &&
      state.settings.recharge &&
      newLives < state.settings.lives
    ) {
      newLives = Math.min(
        state.settings.lives,
        current.livesRemaining + multiplier
      );
    }

    // When Full Lives to Arm ON: must have max lives to be armed. When OFF: arm as soon as arm requirement is met.
    const armSatisfied = newArmProgress >= state.settings.armPoints || current.hasCompletedArm;
    const requireMaxLivesToArm = state.settings.fullLivesToArm;
    isArmed = armSatisfied && (!requireMaxLivesToArm || newLives >= state.settings.lives);

    const players = state.players.map((p) =>
      p.id === current.id
        ? {
            ...p,
            armProgress: newArmProgress,
            isArmed,
            livesRemaining: newLives,
          }
        : p
    );

    const hadValue =
      newArmProgress > current.armProgress ||
      (isArmed && !current.isArmed) ||
      newLives > current.livesRemaining;
    if (hadValue) {
      turnPills.push({
        targetPlayerId: current.id,
        shooterColor: current.color,
        targetColor: current.color,
        multiplier,
      });
    }

    const nextTurnDarts = [...(state.turnDarts || []), dart];
    return {
      ...state,
      players,
      turnTargetsHit,
      turnPills,
      turnDarts: nextTurnDarts,
    };
  }

  // Other player's number -> attack (only if armed)
  if (
    segment !== null &&
    current.isArmed &&
    segment !== current.assignedNumber
  ) {
    const target = state.players.find((p) => p.assignedNumber === segment && !p.isEliminated);
    if (!target) {
      const nextTurnDarts = [...(state.turnDarts || []), dart];
      return { ...state, turnPills, turnDarts: nextTurnDarts };
    }

    if (!(state.targetableThisTurn != null && state.targetableThisTurn.has(target.id))) {
      turnPills.push({
        targetPlayerId: target.id,
        shooterColor: current.color,
        targetColor: target.color,
        blockedByCap: true,
        multiplier,
      });
      const nextTurnDarts = [...(state.turnDarts || []), dart];
      return {
        ...state,
        turnTargetsHit,
        turnPills,
        turnDarts: nextTurnDarts,
      };
    }

    if (!turnTargetsHit.has(target.id)) turnTargetsHit.add(target.id);

    const newLives = Math.max(0, target.livesRemaining - multiplier);
    const fullLivesToArm = state.settings.fullLivesToArm;
    // Full Lives to Arm: when hit, Armed is blocked (isArmed = false); armProgress is preserved, not reset
    const targetUpdates =
      fullLivesToArm && target.isArmed
        ? { livesRemaining: newLives, isArmed: false, hasCompletedArm: true }
        : { livesRemaining: newLives };
    let players = state.players.map((p) =>
      p.id === target.id ? { ...p, ...targetUpdates } : p
    );

    const eliminationOrder = [...state.eliminationOrder];
    const killReward = state.settings.killRewardValue;
    const placementAmounts = state.settings.placementRewardAmounts;
    let nextTargetableThisTurn = state.targetableThisTurn;

    if (newLives <= 0) {
      players = players.map((p) => {
        if (p.id === target.id) {
          return {
            ...p,
            livesRemaining: 0,
            isEliminated: true,
            killRewardsBalance: p.killRewardsBalance - (state.settings.killRewardsEnabled ? killReward : 0),
          };
        }
        if (p.id === current.id) {
          return {
            ...p,
            killsCount: p.killsCount + 1,
            killRewardsBalance: p.killRewardsBalance + (state.settings.killRewardsEnabled ? killReward : 0),
          };
        }
        return p;
      });
      eliminationOrder.push(target.id);

      const aliveCount = countAlive(players);
      // Reassign protection mid-turn only during active throws (not after 3rd dart); no shield activation once turn is over
      const dartsThrownBeforeThis = state.turnDarts?.length ?? 0;
      if (dartsThrownBeforeThis < 2) {
        nextTargetableThisTurn = getTargetableThisTurn(current.id, players, state.settings.turnKillCap);
      }

      if (aliveCount === 1) {
        const winner = players.find((p) => !p.isEliminated);
        if (winner && state.settings.placementRewardsEnabled) {
          // Placement: 1st = winner, 2nd = last eliminated, 3rd = second-last eliminated, ...
          const placementOrder = [winner.id, ...[...eliminationOrder].reverse()];
          players = players.map((p) => {
            const idx = placementOrder.indexOf(p.id);
            const amount = idx >= 0 ? (placementAmounts[idx] ?? 0) : 0;
            return { ...p, placementReward: amount };
          });
        }
      }
    }

    turnPills.push({
      targetPlayerId: target.id,
      shooterColor: current.color,
      targetColor: target.color,
      multiplier,
    });

    const winnerId =
      countAlive(players) === 1
        ? players.find((p) => !p.isEliminated)?.id ?? null
        : null;

    const nextTurnDarts = [...(state.turnDarts || []), dart];
    return {
      ...state,
      players,
      turnTargetsHit,
      targetableThisTurn: nextTargetableThisTurn,
      eliminationOrder,
      turnPills,
      winnerId,
      turnDarts: nextTurnDarts,
    };
  }

  const nextTurnDarts = [...(state.turnDarts || []), dart];
  return { ...state, turnDarts: nextTurnDarts };
}

/** Call at end of turn: advance to next player, push snapshot to turnPast, reset turn state. */
export function endKillerTurn(state: KillerGameState): KillerGameState {
  if (state.winnerId) return state;

  const snapshot = cloneForSnapshot(state);
  // Preserve turn-start snapshot so after Back, ⌫ can replay from real start and revert all derived state
  if (state.turnStartSnapshot) {
    snapshot.turnStartSnapshot = cloneForSnapshot(state.turnStartSnapshot);
  }
  let next = nextPlayerIndex(state);
  const players = state.players;
  if (players[next].isEliminated) {
    const alive = players.filter((p) => !p.isEliminated);
    if (alive.length <= 1) return state;
    const firstAlive = players.findIndex((p) => !p.isEliminated);
    next = firstAlive;
  }

  const nextPlayerId = players[next].id;
  const targetableThisTurn = getTargetableThisTurn(nextPlayerId, players, state.settings.turnKillCap);

  const nextState: KillerGameState = {
    ...state,
    currentPlayerIndex: next,
    turnTargetsHit: new Set<PlayerId>(),
    targetableThisTurn,
    turnPills: [],
    turnDarts: [],
    turnPast: [...(state.turnPast || []), snapshot],
  };
  nextState.turnStartSnapshot = cloneForSnapshot(nextState);
  return nextState;
}

/** ⌫ Remove last dart (per-dart undo). Replays current turn from turn start with one less dart. */
export function removeLastDart(state: KillerGameState): KillerGameState {
  const turnDarts = state.turnDarts || [];
  if (!turnDarts.length) return state;
  const base = state.turnStartSnapshot;
  if (!base) return state;
  const darts = turnDarts.slice(0, -1);
  let cur = cloneForSnapshot(base);
  cur.turnDarts = [];
  for (const d of darts) {
    cur = applyKillerDart(cur, d as DartCode);
  }
  cur.turnDarts = darts;
  cur.turnStartSnapshot = base;
  cur.turnPast = state.turnPast || [];
  return cur;
}

/** Back = undo last committed turn. Restored snapshot already has turnStartSnapshot (preserved in endKillerTurn) so ⌫ reverts both throws and all derived state. */
export function backTurn(state: KillerGameState): KillerGameState {
  const turnPast = state.turnPast || [];
  if (!turnPast.length) return state;
  const prev = turnPast[turnPast.length - 1];
  return {
    ...prev,
    turnPast: turnPast.slice(0, -1),
  };
}

/** Number of completed turns (for Back button enable). */
export function getTurnHistoryLen(state: KillerGameState): number {
  return (state.turnPast || []).length;
}

/** Back one dart (undo last turn pill and revert state). For simplicity we don't support full undo; game screen can track turn darts and rebuild. */
export function getCurrentPlayer(state: KillerGameState): KillerPlayer | null {
  return state.players[state.currentPlayerIndex] ?? null;
}

export function ensurePlacementSumZero(amounts: number[]): number[] {
  const arr = [...amounts];
  const sum = arr.reduce((a, b) => a + b, 0);
  if (arr.length > 0) arr[arr.length - 1] -= sum;
  return arr;
}
