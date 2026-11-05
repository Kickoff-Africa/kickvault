import { describe, it, expect } from 'vitest';
import { computeFinancials } from './assets.financials.js';

const now = new Date('2026-06-15T00:00:00Z');

describe('computeFinancials', () => {
  it('builds a straight-line schedule matching the design (₦2.4M over 5 years from 2022)', () => {
    const f = computeFinancials(
      { purchaseCost: 2_400_000, purchaseDate: new Date('2022-10-02'), usefulLifeYears: 5 },
      now,
    );
    expect(f.annualDepreciation).toBe(480_000);
    expect(f.schedule.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(f.schedule[0]).toMatchObject({ openingValue: 2_400_000, depreciation: 480_000, closingValue: 1_920_000 });
    expect(f.schedule[4]).toMatchObject({ openingValue: 480_000, closingValue: 0, isCurrent: true });
    expect(f.schedule.filter((r) => r.isCurrent)).toHaveLength(1);
  });

  it('charges one year per calendar year including the current one, capped at the useful life', () => {
    const mid = computeFinancials({ purchaseCost: 1000, purchaseDate: new Date('2025-01-01'), usefulLifeYears: 4 }, now);
    expect(mid.accumulatedDepreciation).toBe(500); // 2025 + 2026
    expect(mid.currentBookValue).toBe(500);

    const old = computeFinancials({ purchaseCost: 1000, purchaseDate: new Date('2010-01-01'), usefulLifeYears: 4 }, now);
    expect(old.accumulatedDepreciation).toBe(1000);
    expect(old.currentBookValue).toBe(0);
  });

  it('charges nothing for an asset bought in a future year', () => {
    const f = computeFinancials({ purchaseCost: 1000, purchaseDate: new Date('2030-01-01'), usefulLifeYears: 4 }, now);
    expect(f.accumulatedDepreciation).toBe(0);
    expect(f.currentBookValue).toBe(1000);
  });

  it('returns nulls and an empty schedule when financial data is incomplete', () => {
    const f = computeFinancials({ purchaseCost: 1000, purchaseDate: null, usefulLifeYears: 5 }, now);
    expect(f.currentBookValue).toBeNull();
    expect(f.schedule).toEqual([]);
  });
});
