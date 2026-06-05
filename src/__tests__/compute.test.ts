/**
 * Tests for computeResults (src/lib/compute.ts)
 *
 * Feature: 增進多目標預測的準確度
 *
 * 涵蓋：
 * - 月發電量公式：capacity × GHI × days × PR(Faiman) × goalAdj
 * - 六大目標的 goalAdj fallback：不同目標應產生可辨別的月份分布差異
 * - Faiman T_cell 模型：夏天高溫 → PR 下降
 * - 能源自給率、自用比例上限（SELF_USE_CAP）
 * - 台電六段累進電費帳單差額法
 * - FIT 躉購費率依容量級距
 * - 回本年限與 20 年總收益（0.5%/年衰退）
 * - 氣候適宜性分類（Han et al. 2026 門檻）
 */

import { describe, it, expect } from 'vitest';
import { computeResults } from '../lib/compute';
import type { SolarState } from '../lib/types';

// ─── 基礎測試用狀態 ────────────────────────────────────────────────────────────

const BASE: SolarState = {
  address: { label: '台北市中正區', meta: '', area: 25, type: '住宅', floors: 3, region: '北部' },
  roofArea: 25,
  monthlyKwh: 350,
  goal: 'annual',
  capacity: 7.7,
  panelGrade: 'standard',
  selfUseHabit: 'normal',
  outOfPocket: 400000,
};

// 台灣北部典型月均 GHI（kWh/m²/day）
const TAIPEI_GHI = [2.6, 2.8, 3.5, 3.9, 4.2, 4.4, 4.8, 4.6, 4.1, 3.6, 2.9, 2.5];
const TAIPEI_TEMP = [16, 16, 18, 22, 25, 28, 30, 30, 27, 24, 21, 17];
const TAIPEI_WIND = [3.5, 3.2, 3.0, 2.8, 2.5, 2.3, 3.0, 3.2, 2.8, 3.0, 3.5, 3.8];


// ─── 回傳結構 ─────────────────────────────────────────────────────────────────

describe('computeResults — return structure', () => {
  it('returns all required fields', () => {
    const r = computeResults(BASE);
    const required = [
      'region', 'annualKwh', 'selfSufficiency', 'paybackYears', 'total20yr',
      'monthlyKwh', 'annualRevenue', 'outOfPocket', 'bestAngle', 'recommendedAngle',
      'selfUsedKwh', 'soldKwh', 'selfUseRevenue', 'monthlyPR', 'pvYieldPerKwp', 'suitability',
    ];
    for (const key of required) {
      expect(r, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it('monthlyKwh has 12 values', () => {
    expect(computeResults(BASE).monthlyKwh).toHaveLength(12);
  });

  it('monthlyPR has 12 values', () => {
    expect(computeResults(BASE).monthlyPR).toHaveLength(12);
  });

  it('suitability is one of good / fair / poor', () => {
    expect(['good', 'fair', 'poor']).toContain(computeResults(BASE).suitability);
  });
});


// ─── 月發電量公式 ─────────────────────────────────────────────────────────────

describe('computeResults — monthly generation formula', () => {
  it('sum of monthlyKwh equals annualKwh', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const sum = r.monthlyKwh.reduce((a, b) => a + b, 0);
    expect(sum).toBe(r.annualKwh);
  });

  it('larger capacity produces more annual generation', () => {
    const small = computeResults({ ...BASE, capacity: 5 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const large = computeResults({ ...BASE, capacity: 15 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(large.annualKwh).toBeGreaterThan(small.annualKwh);
  });

  it('higher GHI produces more annual generation', () => {
    const low_ghi  = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
    const high_ghi = [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0];
    const low  = computeResults(BASE, low_ghi,  TAIPEI_TEMP, TAIPEI_WIND);
    const high = computeResults(BASE, high_ghi, TAIPEI_TEMP, TAIPEI_WIND);
    expect(high.annualKwh).toBeGreaterThan(low.annualKwh);
  });
});


// ─── Faiman T_cell 動態 PR ────────────────────────────────────────────────────

describe('computeResults — Faiman PR model', () => {
  it('monthly PR values are clamped to [0.5, 1.0]', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    for (const pr of r.monthlyPR) {
      expect(pr).toBeGreaterThanOrEqual(0.5);
      expect(pr).toBeLessThanOrEqual(1.0);
    }
  });

  it('summer PR is lower than winter PR (high temperature → heat loss)', () => {
    // 北部：夏天（6–9月）平均氣溫 28–30°C > 冬天（12–2月）16–17°C
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const summerPR = (r.monthlyPR[5] + r.monthlyPR[6] + r.monthlyPR[7]) / 3; // Jun Jul Aug
    const winterPR = (r.monthlyPR[11] + r.monthlyPR[0] + r.monthlyPR[1]) / 3; // Dec Jan Feb
    expect(summerPR).toBeLessThan(winterPR);
  });

  it('premium panel has higher base PR than entry panel', () => {
    const entry   = computeResults({ ...BASE, panelGrade: 'entry'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const premium = computeResults({ ...BASE, panelGrade: 'premium' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const avgEntry   = entry.monthlyPR.reduce((a, b) => a + b, 0) / 12;
    const avgPremium = premium.monthlyPR.reduce((a, b) => a + b, 0) / 12;
    expect(avgPremium).toBeGreaterThan(avgEntry);
  });
});


// ─── 多目標差異性（goalAdj） ──────────────────────────────────────────────────

describe('computeResults — multi-goal differentiation', () => {
  it('summer goal generates more kWh in summer than winter goal', () => {
    const summer_state = { ...BASE, goal: 'summer' };
    const winter_state = { ...BASE, goal: 'winter' };
    const r_summer = computeResults(summer_state, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_winter = computeResults(winter_state, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);

    // 夏月（6–9月，index 5–8）加總
    const summer_kwh_s = r_summer.monthlyKwh.slice(5, 9).reduce((a, b) => a + b, 0);
    const summer_kwh_w = r_winter.monthlyKwh.slice(5, 9).reduce((a, b) => a + b, 0);
    expect(summer_kwh_s).toBeGreaterThan(summer_kwh_w);
  });

  it('winter goal generates more kWh in winter than summer goal', () => {
    const r_summer = computeResults({ ...BASE, goal: 'summer' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_winter = computeResults({ ...BASE, goal: 'winter' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);

    // 冬月（12月、1–2月，index 11, 0, 1）加總
    const winter_kwh_w = r_winter.monthlyKwh[11] + r_winter.monthlyKwh[0] + r_winter.monthlyKwh[1];
    const winter_kwh_s = r_summer.monthlyKwh[11] + r_summer.monthlyKwh[0] + r_summer.monthlyKwh[1];
    expect(winter_kwh_w).toBeGreaterThan(winter_kwh_s);
  });

  it('api goalAdj (12 values) overrides static fallback', () => {
    // 均一 goalAdj → 月份分布應比 summer fallback 更均勻
    const uniform_adj = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const with_fallback = computeResults({ ...BASE, goal: 'summer' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const with_api      = computeResults({ ...BASE, goal: 'summer' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND, uniform_adj);

    // fallback 強調夏天（7月最高），API uniform → 1月應更接近7月
    const fallback_ratio = with_fallback.monthlyKwh[6] / with_fallback.monthlyKwh[0]; // Jul / Jan
    const api_ratio      = with_api.monthlyKwh[6]      / with_api.monthlyKwh[0];
    expect(api_ratio).toBeLessThan(fallback_ratio);
  });

  it('all goals produce positive annual generation', () => {
    for (const goal of ['annual', 'summer', 'winter', 'peak', 'match', 'roi']) {
      const r = computeResults({ ...BASE, goal }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
      expect(r.annualKwh).toBeGreaterThan(0);
    }
  });
});


// ─── 能源自給率 ──────────────────────────────────────────────────────────────

describe('computeResults — self sufficiency', () => {
  it('selfSufficiency is clamped to 100', () => {
    // 大型系統：年發電量遠超年用電量
    const r = computeResults({ ...BASE, capacity: 100, monthlyKwh: 100 });
    expect(r.selfSufficiency).toBeLessThanOrEqual(100);
  });

  it('selfSufficiency is 0 when annualKwh is 0', () => {
    const zero_ghi = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = computeResults(BASE, zero_ghi, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r.selfSufficiency).toBe(0);
  });
});


// ─── 自用比例上限（SELF_USE_CAP）─────────────────────────────────────────────

describe('computeResults — self-use cap', () => {
  it('away habit sells more than home habit (same system)', () => {
    const home = computeResults({ ...BASE, capacity: 5, monthlyKwh: 300, selfUseHabit: 'home' },  TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const away = computeResults({ ...BASE, capacity: 5, monthlyKwh: 300, selfUseHabit: 'away' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(away.soldKwh).toBeGreaterThan(home.soldKwh);
  });

  it('selfUsedKwh + soldKwh = annualKwh', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r.selfUsedKwh + r.soldKwh).toBeCloseTo(r.annualKwh, 0);
  });

  it('cap activates for small system with high usage (away habit)', () => {
    // 3 kWp → annualKwh ≈ 3,100 kWh；用電 800 kWh/月 = 9,600 kWh/年
    // usage/gen ≈ 310%，遠超 away cap 42%，所以 soldKwh > selfUsedKwh
    const r = computeResults(
      { ...BASE, capacity: 3, monthlyKwh: 800, selfUseHabit: 'away' },
      TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND,
    );
    expect(r.soldKwh).toBeGreaterThan(r.selfUsedKwh);
  });
});


// ─── 收益計算 ─────────────────────────────────────────────────────────────────

describe('computeResults — revenue', () => {
  it('annualRevenue is positive', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r.annualRevenue).toBeGreaterThan(0);
  });

  it('paybackYears = outOfPocket / annualRevenue', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const expected = parseFloat((BASE.outOfPocket! / r.annualRevenue).toFixed(1));
    expect(r.paybackYears).toBeCloseTo(expected, 1);
  });

  it('20-year total reflects 0.5% annual panel degradation', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    // 有衰退：total20yr < annualRevenue × 20
    expect(r.total20yr).toBeLessThan(r.annualRevenue * 20);
    // 衰退率小（0.5%/年）：total20yr > annualRevenue × 18
    expect(r.total20yr).toBeGreaterThan(r.annualRevenue * 18);
  });

  it('larger system has higher revenue', () => {
    const small = computeResults({ ...BASE, capacity:  5 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const large = computeResults({ ...BASE, capacity: 20 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(large.annualRevenue).toBeGreaterThan(small.annualRevenue);
  });
});


// ─── 氣候適宜性分類（Han et al. 2026 ±σ 門檻）────────────────────────────────

describe('computeResults — climate suitability', () => {
  it('high GHI (南部) → good or fair suitability', () => {
    const south_ghi = [3.6, 3.9, 4.5, 4.9, 5.2, 5.1, 5.5, 5.2, 4.9, 4.5, 3.9, 3.4];
    const r = computeResults(
      { ...BASE, address: { ...BASE.address!, region: '南部' } },
      south_ghi, TAIPEI_TEMP, TAIPEI_WIND,
    );
    expect(['good', 'fair']).toContain(r.suitability);
  });

  it('pvYieldPerKwp ≥ 1418 → good', () => {
    // 用極高 GHI 強制 yield 超過 good 門檻
    const very_high_ghi = [6.0, 6.0, 6.0, 6.0, 6.0, 6.0, 6.0, 6.0, 6.0, 6.0, 6.0, 6.0];
    const r = computeResults(BASE, very_high_ghi, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r.suitability).toBe('good');
    expect(r.pvYieldPerKwp).toBeGreaterThanOrEqual(1418);
  });

  it('pvYieldPerKwp < 1148 → poor', () => {
    const very_low_ghi = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const r = computeResults(BASE, very_low_ghi, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r.suitability).toBe('poor');
    expect(r.pvYieldPerKwp).toBeLessThan(1148);
  });

  it('pvYieldPerKwp = annualKwh / capacity', () => {
    const r = computeResults(BASE, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const expected = parseFloat((r.annualKwh / BASE.capacity!).toFixed(1));
    expect(r.pvYieldPerKwp).toBeCloseTo(expected, 1);
  });
});
