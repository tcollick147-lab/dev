// src/types/navigation.ts

export type MatchOutRule = "STRAIGHT" | "DOUBLE" | "MASTER";
export type MatchInRule = "STRAIGHT" | "DOUBLE" | "MASTER";

export type SideSettings = {
  gameWinnerOn: boolean;
  entry: number;

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
};

export type MatchSetup = {
  players: string[];
  closestToBull?: boolean;
  startScore: number;
  inRule: MatchInRule;
  outRule: MatchOutRule;
  side: SideSettings;
};

export type GolfSideSetup = {
  placementOn: boolean;
  placement: number[];
};

export type GolfSetup = {
  holes: (number | "BULL")[];
  nassau: boolean;
  side?: GolfSideSetup;
  cellMode?: "HOLE" | "TOTAL";
  /** When true and cellMode is TOTAL and handicaps applied, scorecard shows net (gross + handicap). */
  showNetScore?: boolean;
};

export type GolfHandicapSetup = {
  settings: {
    applyHandicaps: boolean;
    updateHandicaps: boolean;
    roundsWindowY: number;
    roundsCountedX: number;
    minRoundsRequired: number;
    roundsDisplayedN: number;
  };
  startingHandicaps: Record<string, number>;
  baselineRoundedAvg: number | null;
};

export type GolfGameSetupPayload = {
  players: string[];
  closestToBull?: boolean;
  golf: GolfSetup;
  golfHandicap?: GolfHandicapSetup;

  startScore?: number;
  inRule?: MatchInRule;
  outRule?: MatchOutRule;
  side?: SideSettings;
};

// ---------------------
// Cricket types
// ---------------------
export type CricketMode = "CLASSIC" | "CUTTHROAT";
export type CricketTarget = number | "BULL" | "D" | "T";

export type CricketTargetsPreset =
  | "17-20+T+B"
  | "17-20+D+T+B"
  | "CUSTOM";

export type CricketSideGames = {
  enabled: boolean;

  matchWinnerRewardsOn: boolean;
  matchWinnerRewardValue?: number;

  comboStrikeBonusOn: boolean;
  comboStrikeBonus?: { value: number; threshold: number };

  comboStrikeJackpotOn: boolean;
  comboStrikeJackpot?: { value: number; threshold: number };

  doubleBonusOn: boolean;
  doubleBonus?: { value: number; threshold: number };

  trebleBonusOn: boolean;
  trebleBonus?: { value: number; threshold: number };

  bullBonusOn: boolean;
  bullBonus?: { value: number; threshold: number };

  bullJackpotOn: boolean;
  bullJackpot?: { value: number; threshold: number };
};

// ---------------------
// Killer (main game mode)
// ---------------------
export type KillerGameSetupPayload = {
  players: { name: string; playerColor: string }[];
  closestToBull?: boolean;
  placementRewardsOn: boolean;
  placementRewardAmounts: number[];
  armPoints: number;
  armMode: "points" | "double" | "treble";
  lives: number;
  recharge: boolean;
  /** When ON, must have full lives to arm/rearm. Only applies when Recharge is ON. */
  fullLivesToArm?: boolean;
  turnKillCap: number;
  killRewardsOn: boolean;
  killRewardValue: number;
  darkMode?: boolean;
  numberLayout?: "shuffle" | "balanced";
};

// ---------------------
// Navigation
// ---------------------
export type RootStackParamList = {
  Lobby: undefined;
  Setup: undefined;

  // Match
  MatchSetup: undefined;
  MatchGame: { setup: MatchSetup };

  // Golf
  GolfSetup: undefined;
  GolfHandicapDetail: undefined;
  GolfGame: { setup: GolfGameSetupPayload };

  // Cricket
  CricketSetup: undefined;
  CricketGame: {
    setup: {
      players: string[];
      closestToBull?: boolean;
      targets: CricketTarget[];
      mode: CricketMode;
      autoConcede: boolean;
      targetsPreset?: CricketTargetsPreset;
      sideGames?: CricketSideGames;
    };
  };

  // Killer
  KillerSetup: undefined;
  KillerGame: { setup: KillerGameSetupPayload; gameKey?: number };

  // Shared: detailed results when game ends with rewards
  GameResultsDetail: GameResultsDetailParams;
};

export type MatchResultsPayload = {
  gameType: "match";
  tokens: number[];
  events: { playerIndex: number; amount: number; label: string }[];
};

export type CricketResultsPayload = {
  gameType: "cricket";
  sideGameTotals: number[];
  /** Per-reward events for breakdown (Match Winner, Combo Strike, etc.) */
  events?: { playerIndex: number; amount: number; label: string }[];
};

export type KillerPlayerResult = {
  name: string;
  place: number;
  placementReward: number;
  killRewardsBalance: number;
  totalRewards: number;
};

export type KillerResultsPayload = {
  gameType: "killer";
  playerResults: KillerPlayerResult[];
};

export type GameResultsDetailParams = {
  gameTitle: string;
  playerNames: string[];
  winnerIndex: number;
  payload: MatchResultsPayload | CricketResultsPayload | KillerResultsPayload;
};
