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
import {
  computeResults, computeMonthlyBill, convertBillToMonthlyKwh,
  getFitRateForCapacity, capCapacityToMaxBudget,
  disaggregateBills, guessCounty,
} from '../lib/compute';
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
  it('selfSufficiency exceeds 100 when generation > consumption', () => {
    // 大型系統：年發電量遠超年用電量，自給率應超過 100%
    const r = computeResults({ ...BASE, capacity: 100, monthlyKwh: 100 });
    expect(r.selfSufficiency).toBeGreaterThan(100);
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


// ─── computeMonthlyBill（台電六段累進費率）───────────────────────────────────

describe('computeMonthlyBill — TPC progressive tariff', () => {
  it('0 度帳單為 0 元', () => {
    expect(computeMonthlyBill(0, false)).toBe(0);
    expect(computeMonthlyBill(0, true)).toBe(0);
  });

  it('非夏月 100 度只命中第一段費率 × 1.78 = 178', () => {
    expect(computeMonthlyBill(100, false)).toBe(178);
  });

  it('非夏月 200 度跨第一二段：120×1.78 + 80×2.26 = 394', () => {
    expect(computeMonthlyBill(200, false)).toBe(394);
  });

  it('夏月 200 度費率較高：120×1.78 + 80×2.55 = 418', () => {
    expect(computeMonthlyBill(200, true)).toBe(418);
  });

  it('夏月帳單高於非夏月（相同度數）', () => {
    expect(computeMonthlyBill(200, true)).toBeGreaterThan(computeMonthlyBill(200, false));
    expect(computeMonthlyBill(500, true)).toBeGreaterThan(computeMonthlyBill(500, false));
  });

  it('用電量越多帳單越高（單調遞增）', () => {
    expect(computeMonthlyBill(200, false)).toBeGreaterThan(computeMonthlyBill(100, false));
    expect(computeMonthlyBill(500, false)).toBeGreaterThan(computeMonthlyBill(200, false));
    expect(computeMonthlyBill(1000, false)).toBeGreaterThan(computeMonthlyBill(500, false));
  });

  it('高用電量（1000 度）回傳有限正值（不 overflow）', () => {
    const bill = computeMonthlyBill(1000, false);
    expect(bill).toBeGreaterThan(0);
    expect(Number.isFinite(bill)).toBe(true);
  });
});


// ─── getFitRateForCapacity（FIT 躉購費率分級）───────────────────────────────

describe('getFitRateForCapacity — FIT rate tiers', () => {
  it('5 kW → 最高費率 5.6279（≤10 kW 級距）', () => {
    expect(getFitRateForCapacity(5)).toBe(5.6279);
  });

  it('9.9 kW 仍在 <10 kW 級距', () => {
    expect(getFitRateForCapacity(9.9)).toBe(5.6279);
  });

  it('恰好 10 kW 跨入第二級距 → 5.3819', () => {
    // 10 < 10 為 false，進入 maxKw:20 → 10 < 20 為 true
    expect(getFitRateForCapacity(10)).toBe(5.3819);
  });

  it('15 kW 在 10–20 kW 級距 → 5.3819', () => {
    expect(getFitRateForCapacity(15)).toBe(5.3819);
  });

  it('恰好 20 kW 跨入第三級距 → 4.2505', () => {
    expect(getFitRateForCapacity(20)).toBe(4.2505);
  });

  it('500 kW 以上回傳最低費率 3.6236', () => {
    expect(getFitRateForCapacity(500)).toBe(3.6236);
    expect(getFitRateForCapacity(10000)).toBe(3.6236);
  });

  it('容量越大費率越低（單調遞減）', () => {
    expect(getFitRateForCapacity(5)).toBeGreaterThan(getFitRateForCapacity(15));
    expect(getFitRateForCapacity(15)).toBeGreaterThan(getFitRateForCapacity(30));
    expect(getFitRateForCapacity(30)).toBeGreaterThan(getFitRateForCapacity(60));
  });
});


// ─── 社區模式（unitCount）：累進費率非線性 ──────────────────────────────────

describe('computeResults — apartment unitCount', () => {
  it('unitCount 未設定和 unitCount=1 的 selfUseRevenue 相同', () => {
    const r_unset = computeResults({ ...BASE }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_one   = computeResults({ ...BASE, unitCount: 1 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r_unset.selfUseRevenue).toBe(r_one.selfUseRevenue);
    expect(r_unset.annualRevenue).toBe(r_one.annualRevenue);
  });

  it('10 戶各 300 度的 selfUseRevenue ≈ 單戶 300 度 × 10（per-unit 計算，不攤大鍋）', () => {
    // capacity 等比例放大確保每戶太陽能相同
    const r1  = computeResults({ ...BASE, unitCount:  1, monthlyKwh: 300, capacity:  2 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r10 = computeResults({ ...BASE, unitCount: 10, monthlyKwh: 300, capacity: 20 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const ratio = r10.selfUseRevenue / (r1.selfUseRevenue * 10);
    expect(ratio).toBeGreaterThan(0.98);
    expect(ratio).toBeLessThan(1.02);
  });

  it('累進費率非線性：1 戶 3000 度的省電費 > 10 戶各 300 度的總省電費', () => {
    // 3000 度命中第五六段高費率（5.27/7.03 NT$/度）→ 邊際節省遠高於第二段（2.26 NT$/度）
    const r_big   = computeResults({ ...BASE, unitCount:  1, monthlyKwh: 3000, capacity: 20 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_multi = computeResults({ ...BASE, unitCount: 10, monthlyKwh:  300, capacity: 20 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r_big.selfUseRevenue).toBeGreaterThan(r_multi.selfUseRevenue);
  });
});


// ─── peak 目標差異性補充 ──────────────────────────────────────────────────────

describe('computeResults — peak goal differentiation', () => {
  it('peak goal 夏月（6–9月）發電量高於 annual goal', () => {
    // peak fallback goalAdj 夏月（1.08, 1.10, 1.08, 1.05）> annual（1, 1, 1, 1）
    const r_peak   = computeResults({ ...BASE, goal: 'peak'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_annual = computeResults({ ...BASE, goal: 'annual' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const peakSummer   = r_peak.monthlyKwh.slice(5, 9).reduce((a, b) => a + b, 0);
    const annualSummer = r_annual.monthlyKwh.slice(5, 9).reduce((a, b) => a + b, 0);
    expect(peakSummer).toBeGreaterThan(annualSummer);
  });

  it('peak goal 冬月（12–2月）發電量低於 annual goal', () => {
    // peak fallback goalAdj 冬月（0.95, 0.98, 0.95）< annual（1, 1, 1）
    const r_peak   = computeResults({ ...BASE, goal: 'peak'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_annual = computeResults({ ...BASE, goal: 'annual' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const peakWinter   = r_peak.monthlyKwh[11] + r_peak.monthlyKwh[0] + r_peak.monthlyKwh[1];
    const annualWinter = r_annual.monthlyKwh[11] + r_annual.monthlyKwh[0] + r_annual.monthlyKwh[1];
    expect(peakWinter).toBeLessThan(annualWinter);
  });
});


// ─── 自用比例上限：三種模式完整排序 ─────────────────────────────────────────

describe('computeResults — self-use cap all 3 habits', () => {
  it('soldKwh 排序：away > normal > home（外出最多賣電）', () => {
    const r_home   = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'home'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_normal = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'normal' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_away   = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'away'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r_away.soldKwh).toBeGreaterThan(r_normal.soldKwh);
    expect(r_normal.soldKwh).toBeGreaterThan(r_home.soldKwh);
  });

  it('selfUsedKwh 排序：home > normal > away（在家最多自用）', () => {
    const r_home   = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'home'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_normal = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'normal' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_away   = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'away'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r_home.selfUsedKwh).toBeGreaterThan(r_normal.selfUsedKwh);
    expect(r_normal.selfUsedKwh).toBeGreaterThan(r_away.selfUsedKwh);
  });

  it('三種模式 selfUseRevenue 排序：home > normal > away（自用省更多電費）', () => {
    const r_home   = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'home'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_normal = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'normal' }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r_away   = computeResults({ ...BASE, capacity: 5, selfUseHabit: 'away'   }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r_home.selfUseRevenue).toBeGreaterThan(r_normal.selfUseRevenue);
    expect(r_normal.selfUseRevenue).toBeGreaterThan(r_away.selfUseRevenue);
  });
});


// ─── 邊界條件 ─────────────────────────────────────────────────────────────────

describe('computeResults — edge cases', () => {
  it('paybackYears 超過 20 年時仍為有限正值（不 overflow）', () => {
    const r = computeResults(
      { ...BASE, outOfPocket: 99_999_999, capacity: 0.1 },
      TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND,
    );
    expect(r.paybackYears).toBeGreaterThan(20);
    expect(Number.isFinite(r.paybackYears)).toBe(true);
  });

  it('零 outOfPocket → paybackYears = 0', () => {
    const r = computeResults(
      { ...BASE, outOfPocket: 0 },
      TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND,
    );
    expect(r.paybackYears).toBe(0);
  });
});


// ─── disaggregateBills（雙月帳單反推 12 月用電）──────────────────────────────

describe('disaggregateBills', () => {
  it('六份均等帳單 → 12 個月陣列，全為正值', () => {
    // 1240 NT$ 雙月帳單 ≈ 300 kWh/月（非夏月）
    const result = disaggregateBills([1240, 1240, 1240, 1240, 1240, 1240], 300);
    expect(result).toHaveLength(12);
    expect(result.every(v => v > 0)).toBe(true);
  });

  it('六份均等帳單年用電合計在合理範圍（2800–4200 kWh）', () => {
    const result = disaggregateBills([1240, 1240, 1240, 1240, 1240, 1240], 300);
    const annual = result.reduce((a, b) => a + b, 0);
    expect(annual).toBeGreaterThan(2800);
    expect(annual).toBeLessThan(4200);
  });

  it('全部帳單為 null 時使用 fallbackMonthlyKwh 推估', () => {
    const result = disaggregateBills([null, null, null, null, null, null], 400);
    expect(result).toHaveLength(12);
    expect(result.every(v => v > 0)).toBe(true);
    // fallback 400 kWh/月 × 12 × TEPCO_NORM → 年總量應大於 0
    const annual = result.reduce((a, b) => a + b, 0);
    expect(annual).toBeGreaterThan(0);
  });

  it('高夏月帳單（3000 NT$）推估夏月用電高於低帳單（500 NT$）', () => {
    const highBill = disaggregateBills([500, 500, 3000, 3000, 3000, 500], 300);
    const lowBill  = disaggregateBills([500, 500,  500,  500,  500, 500], 300);
    // 夏月（7–8月, index 6–7）應因高帳單而推估更多用電
    const highSummer = highBill[6] + highBill[7];
    const lowSummer  = lowBill[6]  + lowBill[7];
    expect(highSummer).toBeGreaterThan(lowSummer);
  });
});


// ─── guessCounty（地址推縣市）────────────────────────────────────────────────

describe('guessCounty', () => {
  it('台北市地址 → 台北市', () => {
    expect(guessCounty('台北市信義區松仁路')).toBe('台北市');
    expect(guessCounty('臺北市中正區')).toBe('台北市');
  });

  it('高雄市地址 → 高雄市', () => {
    expect(guessCounty('高雄市左營區重昌街')).toBe('高雄市');
  });

  it('彰化縣地址 → 彰化縣', () => {
    expect(guessCounty('彰化縣員林市中山路')).toBe('彰化縣');
  });

  it('undefined 或空字串 → 預設台北市', () => {
    expect(guessCounty(undefined)).toBe('台北市');
    expect(guessCounty('')).toBe('台北市');
  });

  it('無法辨識地址 → 預設台北市', () => {
    expect(guessCounty('某個不知名的地方')).toBe('台北市');
  });
});


// ─── computeMonthlyBill 高段費率（第三至六段）──────────────────────────────

describe('computeMonthlyBill — high tiers (第三至六段)', () => {
  // 費率計算（非夏月）：
  //   500 kWh = 120×1.78 + 210×2.26 + 170×3.13 = 213.6 + 474.6 + 532.1 = 1220.3 → 1220
  //   700 kWh = 1220.3 + 200×4.24 = 1220.3 + 848 = 2068.3 → 2068
  //  1000 kWh = 2068.3 + 300×5.27 = 2068.3 + 1581 = 3649.3 → 3649
  //  1200 kWh = 3649.3 + 200×7.03 = 3649.3 + 1406 = 5055.3 → 5055（第六段）
  it('非夏月 500 度跨至第三段（1220 NT$）', () => {
    expect(computeMonthlyBill(500, false)).toBe(1220);
  });

  it('非夏月 700 度跨至第四段（2068 NT$）', () => {
    expect(computeMonthlyBill(700, false)).toBe(2068);
  });

  it('非夏月 1000 度跨至第五段（3649 NT$）', () => {
    expect(computeMonthlyBill(1000, false)).toBe(3649);
  });

  it('非夏月 1200 度跨至第六段（5055 NT$）', () => {
    expect(computeMonthlyBill(1200, false)).toBe(5055);
  });

  // 夏月高段費率同步驗算：
  //   500 kWh = 213.6 + 535.5 + 646 = 1395.1 → 1395
  //   700 kWh = 1395.1 + 200×5.14 = 1395.1 + 1028 = 2423.1 → 2423
  //  1000 kWh = 2423.1 + 300×6.44 = 2423.1 + 1932 = 4355.1 → 4355
  //  1200 kWh = 4355.1 + 200×8.86 = 4355.1 + 1772 = 6127.1 → 6127（第六段）
  it('夏月 500 度（1395 NT$）', () => {
    expect(computeMonthlyBill(500, true)).toBe(1395);
  });

  it('夏月 1000 度（4355 NT$）', () => {
    expect(computeMonthlyBill(1000, true)).toBe(4355);
  });

  it('夏月 1200 度跨至第六段（6127 NT$）', () => {
    expect(computeMonthlyBill(1200, true)).toBe(6127);
  });

  it('所有高段費率：夏月帳單高於非夏月', () => {
    for (const kwh of [500, 700, 1000, 1200]) {
      expect(computeMonthlyBill(kwh, true)).toBeGreaterThan(computeMonthlyBill(kwh, false));
    }
  });
});


// ─── convertBillToMonthlyKwh — round-trip 逆函式一致性 ──────────────────────

describe('convertBillToMonthlyKwh — round-trip consistency', () => {
  it('非夏月：2 × computeMonthlyBill(k) 反推回 k（六段全覆蓋）', () => {
    // 各 kWh 值分別命中第一至第六段費率
    for (const kwh of [100, 200, 300, 500, 700, 1000, 1200]) {
      const biMonthly = computeMonthlyBill(kwh, false) * 2;
      expect(convertBillToMonthlyKwh(biMonthly, false)).toBe(kwh);
    }
  });

  it('夏月：2 × computeMonthlyBill(k) 反推回 k（六段全覆蓋）', () => {
    for (const kwh of [100, 200, 300, 500, 700, 1000, 1200]) {
      const biMonthly = computeMonthlyBill(kwh, true) * 2;
      expect(convertBillToMonthlyKwh(biMonthly, true)).toBe(kwh);
    }
  });

  it('夏月帳單用非夏月費率反推 → 結果偏高（費率算少了）', () => {
    // 夏月帳單 1395（500 kWh 夏月），用非夏月費率反推會得到 > 500 kWh
    const summerBill = computeMonthlyBill(500, true) * 2; // 2790
    const wrongSeason = convertBillToMonthlyKwh(summerBill, false);
    expect(wrongSeason).toBeGreaterThan(500);
  });
});


// ─── capCapacityToMaxBudget（預算截容量）────────────────────────────────────

describe('capCapacityToMaxBudget', () => {
  it('預算充裕時回傳屋頂上限容量', () => {
    // 10 kWp × 40000 NT$/kW = 400000 ≤ budget 600000 → 回傳 10
    expect(capCapacityToMaxBudget(10, 50000, 10000, 600000)).toBe(10);
  });

  it('預算不足時依預算截斷容量', () => {
    // 200000 / 40000 = 5.0 kWp < roof 10 kWp → 回傳 5
    expect(capCapacityToMaxBudget(10, 50000, 10000, 200000)).toBe(5);
  });

  it('預算恰好等於屋頂滿裝成本時回傳屋頂容量', () => {
    // 10 kWp × 40000 = 400000 = budget → 回傳 10
    expect(capCapacityToMaxBudget(10, 50000, 10000, 400000)).toBe(10);
  });

  it('補助超過成本（netCostPerKw ≤ 0）時直接回傳屋頂上限（不受預算限制）', () => {
    expect(capCapacityToMaxBudget(10, 20000, 30000, 1)).toBe(10);
    expect(capCapacityToMaxBudget(7, 15000, 15000, 0)).toBe(7);
  });

  it('大樓模式：totalBudget = 每戶預算 × 戶數 → 容量正確截斷', () => {
    // 每戶 50000 × 10 戶 = 500000 total；500000 / 40000 = 12.5 < roof 15
    expect(capCapacityToMaxBudget(15, 50000, 10000, 500000)).toBe(12.5);
  });
});


// ─── selfSufficiency 大樓模式：annualUsage 乘以 unitCount ───────────────────

describe('computeResults — selfSufficiency with unitCount', () => {
  it('unitCount=10（相同容量）使自給率降為 unitCount=1 的約 1/10', () => {
    // 同一容量服務 10 倍用電 → 自給率 / 10
    const r1  = computeResults({ ...BASE, unitCount:  1, capacity: 5, monthlyKwh: 200 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r10 = computeResults({ ...BASE, unitCount: 10, capacity: 5, monthlyKwh: 200 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const ratio = r1.selfSufficiency / r10.selfSufficiency;
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(12);
  });

  it('容量與 unitCount 同比例放大時，自給率不變', () => {
    // unitCount × 10 且 capacity × 10 → annualKwh × 10，annualUsage × 10 → 比值不變
    const r1  = computeResults({ ...BASE, unitCount:  1, capacity:  5, monthlyKwh: 200 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const r10 = computeResults({ ...BASE, unitCount: 10, capacity: 50, monthlyKwh: 200 }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(r10.selfSufficiency).toBe(r1.selfSufficiency);
  });
});


// ─── computeResults — monthlyUsage 自訂 12 月明細覆蓋 ──────────────────────

describe('computeResults — monthlyUsage override', () => {
  it('提供 12 個月明細時覆蓋 TEPCO_NORM 計算，影響 selfSufficiency', () => {
    // 夏月用電刻意調低 → 年用電總量變小 → 自給率上升
    const lowSummer: number[] = [300,300,300,300,300, 10, 10, 10, 10, 300,300,300];
    const withCustom  = computeResults({ ...BASE, monthlyUsage: lowSummer },   TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const withDefault = computeResults({ ...BASE, monthlyKwh: 300 },            TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(withCustom.selfSufficiency).toBeGreaterThan(withDefault.selfSufficiency);
  });

  it('長度非 12 的 monthlyUsage 不被採用，退回 TEPCO_NORM', () => {
    const invalid = computeResults({ ...BASE, monthlyUsage: [300, 300, 300] }, TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const fallbk  = computeResults({ ...BASE },                                TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    expect(invalid.selfSufficiency).toBe(fallbk.selfSufficiency);
    expect(invalid.annualRevenue).toBe(fallbk.annualRevenue);
  });

  it('全月均一用電時 selfSufficiency 介於高峰與低谷 TEPCO_NORM 之間', () => {
    // 均一 300 kWh/月，TEPCO_NORM 最高月 1.26 最低 0.77 → 均一總量 3600
    // TEPCO_NORM 總量 = 300 × 12.01 ≈ 3603（非常接近），自給率應幾乎相同
    const uniform  = new Array(12).fill(300);
    const withFlat = computeResults({ ...BASE, monthlyUsage: uniform },    TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    const withNorm = computeResults({ ...BASE, monthlyKwh: 300 },          TAIPEI_GHI, TAIPEI_TEMP, TAIPEI_WIND);
    // 兩者年用電相近（差距 < 0.5%），自給率差距應在 ±2% 以內
    expect(Math.abs(withFlat.selfSufficiency - withNorm.selfSufficiency)).toBeLessThanOrEqual(2);
  });
});


// ─── disaggregateBills — 部分填寫（Denton 比例分解）────────────────────────

describe('disaggregateBills — partial fill', () => {
  it('只填第四份帳單（7–8月高夏月用電）時，7–8月推算用電高於全 null 情況', () => {
    // 3000 NT$ 夏月帳單 → convertBillToMonthlyKwh ≈ 670 kWh，globalScale 遠高於 fallback 300
    const partial = disaggregateBills([null, null, null, 3000, null, null], 300);
    const allNull  = disaggregateBills([null, null, null, null,  null, null], 300);
    expect(partial[6] + partial[7]).toBeGreaterThan(allNull[6] + allNull[7]);
  });

  it('只填第一份帳單時，已填的 1–2月月份照帳單推算，其餘照 globalScale 填補', () => {
    const partial = disaggregateBills([1240, null, null, null, null, null], 300);
    expect(partial).toHaveLength(12);
    expect(partial.every(v => v > 0)).toBe(true);
  });

  it('部分填寫年用電量介於全填與全 null 的合理範圍內', () => {
    const allFull  = disaggregateBills([1240, 1240, 1240, 1240, 1240, 1240], 300);
    const halfFill = disaggregateBills([1240, null, 1240, null, 1240, null], 300);
    const allNull  = disaggregateBills([null, null, null, null, null, null], 300);
    const fullAnnual = allFull.reduce((a, b) => a + b, 0);
    const halfAnnual = halfFill.reduce((a, b) => a + b, 0);
    const nullAnnual = allNull.reduce((a, b) => a + b, 0);
    // 三份填 1240（≈300 kWh/月），三份用 fallback 300 → 全年用電應接近全填
    expect(halfAnnual).toBeGreaterThan(nullAnnual * 0.7);
    expect(halfAnnual).toBeLessThan(fullAnnual * 1.3);
  });
});
