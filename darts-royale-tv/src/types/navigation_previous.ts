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
  startScore: number;
  inRule: MatchInRule;
  outRule: MatchOutRule;
  side: SideSettings;
};

export type GolfSideSetup = {
  placementOn: boolean;
  placement: number[]; // 1st..Nth, length = player count, sum should be 0 when enabled
};

export type GolfSetup = {
  holes: (number | "BULL")[];
  nassau: boolean;
  side?: GolfSideSetup;
  cellMode?: "HOLE" | "TOTAL";
};

export type GolfGameSetupPayload = {
  players: string[];
  golf: GolfSetup;

  // (present but unused in Golf, harmless if included)
  startScore?: number;
  inRule?: MatchInRule;
  outRule?: MatchOutRule;
  side?: SideSettings;
};

export type RootStackParamList = {
  Lobby: undefined;

  // ✅ allow route.params?.mode in SetupScreen
  Setup: { mode?: "MATCH" | "GOLF" } | undefined;

  MatchGame: { setup: MatchSetup };
  GolfGame: { setup: GolfGameSetupPayload };
};
