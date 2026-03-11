// src/engine/killerTypes.ts – Killer game mode types

export type PlayerId = string;

export type KillerPlayer = {
  id: PlayerId;
  name: string;
  color: string;
  assignedNumber: number; // 1–20
  armProgress: number;
  isArmed: boolean;
  /** True once player has ever completed arm; used with fullLivesToArm to require max lives to stay armed */
  hasCompletedArm?: boolean;
  livesRemaining: number;
  isEliminated: boolean;
  killsCount: number;
  killRewardsBalance: number;
  placementReward: number;
};

export type ArmMode = "points" | "double" | "treble";

export type KillerSettings = {
  armPoints: number;
  armMode: ArmMode;
  lives: number;
  recharge: boolean;
  /** When ON (and Recharge ON), player must be at max lives to arm or rearm. */
  fullLivesToArm: boolean;
  /** Number of opponents protected per turn (0 = none). When 2 players left, no protection. */
  turnKillCap: number;
  placementRewardsEnabled: boolean;
  placementRewardAmounts: number[]; // per place (1st, 2nd, …)
  killRewardsEnabled: boolean;
  killRewardValue: number;
};

export type KillerGameState = {
  players: KillerPlayer[];
  currentPlayerIndex: number;
  turnTargetsHit: Set<PlayerId>; // unique targets damaged this turn (for display; reset each turn)
  /** Opponents that CAN be targeted this turn. Rest are protected. Size = eligible - min(protection, eligible). When 2 players left, all eligible are targetable. Updated mid-turn when a targetable player is eliminated. */
  targetableThisTurn: Set<PlayerId>;
  eliminationOrder: PlayerId[];
  settings: KillerSettings;
  winnerId: PlayerId | null;
  /** This turn's hit pills for UI: { targetPlayerId, shooterColor?, targetColor?, blockedByCap?: boolean, multiplier?: 1|2|3 } */
  turnPills: { targetPlayerId: PlayerId; shooterColor: string; targetColor: string; blockedByCap?: boolean; multiplier?: number }[];
  /** Darts thrown this turn (for ⌫ undo). */
  turnDarts: string[];
  /** Snapshot at start of current turn (for replay on removeLastDart). Stored with turnPast/turnStartSnapshot cleared to avoid recursion. */
  turnStartSnapshot: KillerGameState | null;
  /** Snapshots at end of each completed turn (for Back). */
  turnPast: KillerGameState[];
};

/** Setup payload: players have name + color only; numbers allocated at game start. */
export type KillerSetupPayload = {
  players: { name: string; playerColor: string }[];
  closestToBull?: boolean;
  placementRewardsOn: boolean;
  placementRewardAmounts: number[];
  armPoints: number;
  armMode: ArmMode;
  lives: number;
  recharge: boolean;
  /** When ON, must have full lives to arm/rearm. Only applies when Recharge is ON. */
  fullLivesToArm?: boolean;
  turnKillCap: number;
  killRewardsOn: boolean;
  killRewardValue: number;
};

/** Full setup with assigned numbers (used by engine after allocation in game screen). */
export type KillerSetup = KillerSetupPayload & {
  players: { name: string; playerColor: string; assignedNumber: number }[];
};

/** Neon palette for Killer "color code" (game screen only). Yellow is darkened for white text contrast. */
export const KILLER_NEON_COLORS = [
  "#FF1744", "#D500F9", "#2979FF", "#00E676", "#D4A017", "#FF9100",
  "#E040FB", "#536DFE", "#00B8D4", "#76FF03", "#FFAB00", "#FF3D00",
];

/** Legacy/default palette (fallback). */
export const KILLER_PLAYER_COLORS = KILLER_NEON_COLORS;
