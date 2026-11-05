export interface FinancialInput {
  purchaseCost: number | null;
  purchaseDate: Date | null;
  usefulLifeYears: number | null;
}

export interface ScheduleRow {
  year: number;
  openingValue: number;
  depreciation: number;
  closingValue: number;
  isCurrent: boolean;
}

export interface Financials {
  purchaseCost: number | null;
  purchaseDate: string | null;
  depreciationMethod: 'STRAIGHT_LINE';
  usefulLifeYears: number | null;
  annualDepreciation: number | null;
  accumulatedDepreciation: number | null;
  currentBookValue: number | null;
  schedule: ScheduleRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Straight-line depreciation with no salvage value, one full year charged per calendar year
 * starting in the year of purchase (matches the amortization table in the design).
 * The current-year row is flagged so clients can highlight it.
 */
export function computeFinancials(input: FinancialInput, now: Date = new Date()): Financials {
  const { purchaseCost, purchaseDate, usefulLifeYears } = input;
  const base = {
    depreciationMethod: 'STRAIGHT_LINE' as const,
    purchaseCost,
    purchaseDate: purchaseDate ? purchaseDate.toISOString().slice(0, 10) : null,
    usefulLifeYears,
  };

  if (purchaseCost === null || purchaseDate === null || usefulLifeYears === null) {
    return { ...base, annualDepreciation: null, accumulatedDepreciation: null, currentBookValue: null, schedule: [] };
  }

  const annual = purchaseCost / usefulLifeYears;
  const startYear = purchaseDate.getUTCFullYear();
  const currentYear = now.getUTCFullYear();

  const schedule: ScheduleRow[] = [];
  for (let i = 0; i < usefulLifeYears; i++) {
    const opening = Math.max(purchaseCost - annual * i, 0);
    const closing = Math.max(opening - annual, 0);
    schedule.push({
      year: startYear + i,
      openingValue: round2(opening),
      depreciation: round2(opening - closing),
      closingValue: round2(closing),
      isCurrent: startYear + i === currentYear,
    });
  }

  const yearsCharged = Math.min(Math.max(currentYear - startYear + 1, 0), usefulLifeYears);
  const accumulated = Math.min(annual * yearsCharged, purchaseCost);

  return {
    ...base,
    annualDepreciation: round2(annual),
    accumulatedDepreciation: round2(accumulated),
    currentBookValue: round2(purchaseCost - accumulated),
    schedule,
  };
}
