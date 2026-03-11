export type GolfHandicapSettings = {
  applyHandicaps: boolean;
  updateHandicaps: boolean;
  roundsWindowY: number;
  roundsCountedX: number;
  minRoundsRequired: number;
  roundsDisplayedN: number;
};

export type GolfHandicapPlayerResult = {
  active: boolean;
  scores: number[];
  windowScores: number[];
  countedScores: number[];
  averageRaw: number | null;
  roundedAverage: number | null;
  startingHandicap: number;
};

export type GolfHandicapComputation = {
  settings: GolfHandicapSettings;
  baselineRoundedAvg: number | null;
  byPlayer: Record<string, GolfHandicapPlayerResult>;
};

export type GolfHistoryRowState = "COUNTED" | "IN_WINDOW" | "OUTSIDE_WINDOW";

export type GolfHandicapHistoryRow = {
  roundNumber: number;
  score: number;
  state: GolfHistoryRowState;
};

export const DEFAULT_GOLF_HANDICAP_SETTINGS: GolfHandicapSettings = {
  applyHandicaps: false,
  updateHandicaps: true,
  roundsWindowY: 5,
  roundsCountedX: 3,
  minRoundsRequired: 3,
  roundsDisplayedN: 10,
};

export function normalizeGolfHandicapSettings(
  input?: Partial<GolfHandicapSettings> | null
): GolfHandicapSettings {
  const next: GolfHandicapSettings = {
    ...DEFAULT_GOLF_HANDICAP_SETTINGS,
    ...(input ?? {}),
  };

  next.roundsWindowY = Math.max(1, Math.floor(Number(next.roundsWindowY) || 5));
  next.roundsCountedX = Math.max(1, Math.floor(Number(next.roundsCountedX) || 3));
  next.minRoundsRequired = Math.max(1, Math.floor(Number(next.minRoundsRequired) || 3));
  next.roundsDisplayedN = Math.max(1, Math.floor(Number(next.roundsDisplayedN) || 10));

  if (next.roundsCountedX > next.roundsWindowY) {
    next.roundsCountedX = next.roundsWindowY;
  }

  return next;
}

function sanitizeScores(scores: number[] | undefined): number[] {
  if (!Array.isArray(scores)) return [];
  return scores
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

export function computeGolfStartingHandicaps(
  playerNames: string[],
  scoresByPlayer: Record<string, number[]>,
  settingsInput?: Partial<GolfHandicapSettings> | null
): GolfHandicapComputation {
  const settings = normalizeGolfHandicapSettings(settingsInput);
  const byPlayer: Record<string, GolfHandicapPlayerResult> = {};

  for (const name of playerNames) {
    const scores = sanitizeScores(scoresByPlayer[name]);
    const windowScores = scores.slice(-settings.roundsWindowY);
    const countedCount = Math.min(settings.roundsCountedX, windowScores.length);
    const countedScores = [...windowScores].sort((a, b) => a - b).slice(0, countedCount);
    const averageRaw =
      countedScores.length > 0
        ? countedScores.reduce((acc, n) => acc + n, 0) / countedScores.length
        : null;
    const roundedAverage = averageRaw === null ? null : Math.round(averageRaw);
    const active =
      scores.length >= settings.minRoundsRequired &&
      roundedAverage !== null &&
      Number.isFinite(roundedAverage);

    byPlayer[name] = {
      active,
      scores,
      windowScores,
      countedScores,
      averageRaw,
      roundedAverage,
      startingHandicap: 0,
    };
  }

  const eligibleAverages = playerNames
    .map((name) => byPlayer[name])
    .filter((r) => r.active && r.roundedAverage !== null)
    .map((r) => r.roundedAverage as number);

  const baselineRoundedAvg =
    eligibleAverages.length > 0 ? Math.min(...eligibleAverages) : null;

  if (baselineRoundedAvg !== null) {
    for (const name of playerNames) {
      const r = byPlayer[name];
      if (!r.active || r.roundedAverage === null) {
        r.startingHandicap = 0;
        continue;
      }
      r.startingHandicap = -(r.roundedAverage - baselineRoundedAvg);
    }
  }

  return { settings, baselineRoundedAvg, byPlayer };
}

/**
 * Relative starting handicaps when Apply Handicaps is on: baseline = best (lowest) = 0.
 * Uses manual overrides when set, else rounded average; inactive with no manual = 0 for baseline.
 * Single source of truth for both GolfSetup and GolfHandicapDetail.
 */
export function computeRelativeStartingHandicaps(
  playerNames: string[],
  computation: GolfHandicapComputation,
  handicapOverrides: Record<string, number>,
  applyHandicaps: boolean
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!applyHandicaps) {
    for (const name of playerNames) out[name] = 0;
    return out;
  }
  const perPlayerValue = playerNames.map((name) => {
    const playerResult = computation.byPlayer[name];
    const isInactive = !playerResult?.active;
    const hasManual = handicapOverrides[name] != null && Number.isFinite(Number(handicapOverrides[name]));
    if (isInactive && !hasManual) return 0;
    if (hasManual) return Number(handicapOverrides[name]);
    return playerResult?.roundedAverage ?? null;
  });
  const finite = perPlayerValue.filter((v): v is number => v != null && Number.isFinite(v));
  const baselineValue = finite.length > 0 ? Math.min(...finite) : null;

  for (const name of playerNames) {
    const playerResult = computation.byPlayer[name];
    const isInactive = !playerResult?.active;
    const hasManual = handicapOverrides[name] != null && Number.isFinite(Number(handicapOverrides[name]));
    const theirValue =
      isInactive && !hasManual ? 0 : hasManual ? Number(handicapOverrides[name]) : playerResult?.roundedAverage ?? null;

    if (baselineValue != null && theirValue != null) {
      out[name] = baselineValue - theirValue;
    } else {
      out[name] = playerResult?.startingHandicap ?? 0;
    }
  }
  return out;
}

export function getGolfHandicapHistoryRows(
  scoresInput: number[] | undefined,
  settingsInput?: Partial<GolfHandicapSettings> | null
): GolfHandicapHistoryRow[] {
  const settings = normalizeGolfHandicapSettings(settingsInput);
  const scores = sanitizeScores(scoresInput);
  const total = scores.length;
  if (!total) return [];

  const windowStart = Math.max(0, total - settings.roundsWindowY);
  const windowEntries: Array<{ score: number; idx: number }> = [];
  for (let idx = windowStart; idx < total; idx++) {
    windowEntries.push({ score: scores[idx], idx });
  }

  const countedCount = Math.min(settings.roundsCountedX, windowEntries.length);
  const countedIdx = new Set(
    [...windowEntries]
      .sort((a, b) => (a.score === b.score ? b.idx - a.idx : a.score - b.score))
      .slice(0, countedCount)
      .map((e) => e.idx)
  );

  const out: GolfHandicapHistoryRow[] = [];
  const fromIdx = Math.max(0, total - settings.roundsDisplayedN);
  for (let idx = total - 1; idx >= fromIdx; idx--) {
    let state: GolfHistoryRowState = "OUTSIDE_WINDOW";
    if (idx >= windowStart) {
      state = countedIdx.has(idx) ? "COUNTED" : "IN_WINDOW";
    }
    out.push({
      roundNumber: idx + 1,
      score: scores[idx],
      state,
    });
  }
  return out;
}
