import type { SolarState, ComputedResults, Region } from './types';
import { TW_IRRADIANCE, DEFAULT_TEMP, DEFAULT_WIND, PANEL_GRADES } from './constants';

// ─── Faiman (2008) T_cell model, as cited by Han et al. (2026) Eq.(13) ────────
// T_cell = T_a + I_total / (U0 + U1·WS)
// Simplified efficiency correction replaces the full ADR (Driesse et al.) which
// requires panel-specific constants unavailable at system level.
const FAIMAN = {
  U0: 25,       // W/m²K  — constant heat transfer coefficient
  U1: 6.84,     // W/m³sK — wind-speed-dependent heat transfer coefficient
  gamma: -0.0045, // /°C  — power temperature coefficient (c-Si, IEC 61215)
  T_ref: 25,    // °C    — STC reference temperature
  base_PR: 0.78, // —    — baseline system performance ratio (inverter + wiring + soiling)
};

// Han et al. (2026) Fig.11 suitability thresholds (Z-score ±σ).
// Paper reports values in kWh per 325W Panasonic HIT panel; divide by 0.325 kWp to get kWh/kWp.
const PV_YIELD_GOOD = Math.round(461 / 0.325);  // 1418 kWh/kWp/yr  (+1σ)
const PV_YIELD_POOR = Math.round(373 / 0.325);  // 1148 kWh/kWp/yr  (−1σ)

function calcMonthlyPR(ghiArr: number[], tempArr: number[], windArr: number[], basePR = FAIMAN.base_PR): number[] {
  return ghiArr.map((ghi, i) => {
    const T_cell = tempArr[i] + ghi / (FAIMAN.U0 + FAIMAN.U1 * windArr[i]);
    const eta = 1 + FAIMAN.gamma * (T_cell - FAIMAN.T_ref);
    // Clamp: physically reasonable range 0.50–1.00
    return Math.min(1.0, Math.max(0.50, basePR * eta));
  });
}

const GOAL_ADJ: Record<string, number[]> = {
  annual: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  summer: [0.85, 0.88, 0.95, 1.05, 1.10, 1.15, 1.18, 1.15, 1.05, 0.95, 0.90, 0.85],
  winter: [1.18, 1.15, 1.10, 1.05, 0.95, 0.85, 0.82, 0.85, 0.95, 1.05, 1.15, 1.20],
  peak:   [0.95, 0.98, 1.02, 1.05, 1.05, 1.08, 1.10, 1.08, 1.05, 1.02, 0.98, 0.95],
  match:  [0.95, 0.98, 1.00, 1.03, 1.05, 1.08, 1.10, 1.08, 1.03, 1.00, 0.98, 0.95],
  roi:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

const BEST_ANGLE: Record<string, number> = {
  annual: 22, summer: 10, winter: 45, peak: 18, match: 20, roi: 22,
};

// 台電住宅用電累進費率（115年度公告）
// 夏月：6/1–9/30；非夏月：其餘
const TPC_SUMMER_TIERS     = [{l:120,r:1.78},{l:330,r:2.55},{l:500,r:3.80},{l:700,r:5.14},{l:1000,r:6.44},{l:Infinity,r:8.86}];
const TPC_NON_SUMMER_TIERS = [{l:120,r:1.78},{l:330,r:2.26},{l:500,r:3.13},{l:700,r:4.24},{l:1000,r:5.27},{l:Infinity,r:7.03}];
// 0-indexed: Jun=5, Jul=6, Aug=7, Sep=8
const SUMMER_MONTH_IDX = new Set([5, 6, 7, 8]);

function calcTpcBill(kwh: number, isSummer: boolean): number {
  const tiers = isSummer ? TPC_SUMMER_TIERS : TPC_NON_SUMMER_TIERS;
  let bill = 0, prev = 0;
  for (const {l, r} of tiers) {
    if (kwh <= prev) break;
    bill += (Math.min(kwh, l) - prev) * r;
    prev = l;
  }
  return bill;
}

// 台電住宅月別用電正規化曲線（來源：台電電燈月別售電量，夏季單峰，9 月最高）
// 用於 match 目標 fallback 權重，以及 StepUsage 12 月展開預設值
export const TEPCO_MONTHLY_NORM = [
  0.82, 0.77, 0.84, 0.81, 0.87, 0.97,
  1.14, 1.21, 1.26, 1.25, 1.19, 0.88,
];

// 115年度屋頂型躉購費率（能源局公告）— 依裝置容量級距
const FIT_RATE_TABLE: { maxKw: number; rate: number }[] = [
  { maxKw: 10,  rate: 5.6279 },
  { maxKw: 20,  rate: 5.3819 },
  { maxKw: 50,  rate: 4.2505 },
  { maxKw: 100, rate: 4.0459 },
  { maxKw: 500, rate: 3.7152 },
  { maxKw: Infinity, rate: 3.6236 },
];

export function getFitRateForCapacity(kw: number): number {
  return FIT_RATE_TABLE.find(t => kw < t.maxKw)?.rate ?? 3.6236;
}

export const DEFAULT_FIT_RATE = 5.6279; // 最小級距費率（供 UI 顯示用）
export const DEFAULT_DEGRADATION_RATE = 0.005; // 0.5%/年，c-Si 面板業界標準保固值

// 日間用電習慣對應的自用比例上限（無電池儲能）
export const SELF_USE_CAP: Record<string, number> = {
  home:   0.88, // 白天在家：發電高峰與用電高峰大量重疊
  normal: 0.75, // 一般作息：業界通用預設估值
  away:   0.42, // 白天外出：夜間用電為主，自用率低
};

/**
 * Scales down capacity so that out-of-pocket cost (after subsidy) stays within maxBudget.
 * outOfPocket = capacity × (costPerKw − subsidyPerKw) ≤ maxBudget
 */
export function capCapacityToMaxBudget(
  capacityFromRoof: number,
  costPerKw: number,
  subsidyPerKw: number,
  maxBudget: number,
): number {
  const netCostPerKw = costPerKw - subsidyPerKw;
  if (netCostPerKw <= 0) return capacityFromRoof;
  const budgetCap = parseFloat((maxBudget / netCostPerKw).toFixed(1));
  return Math.min(capacityFromRoof, budgetCap);
}

/** Forward: monthly kWh → monthly bill (NT$) using TPC tiered rates. */
export function computeMonthlyBill(kwh: number, isSummer: boolean): number {
  return Math.round(calcTpcBill(kwh, isSummer));
}

/**
 * Inverse: bi-monthly bill (NT$) → monthly kWh.
 * Taipower bills every 2 months, so divide by 2 to get the single-month amount,
 * then walk the progressive tiers to find the corresponding kWh.
 */
export function convertBillToMonthlyKwh(biMonthlyBill: number, isSummer: boolean): number {
  let remaining = biMonthlyBill / 2;
  const tiers = isSummer ? TPC_SUMMER_TIERS : TPC_NON_SUMMER_TIERS;
  let kwh = 0;
  let prev = 0;
  for (const {l, r} of tiers) {
    if (l === Infinity) {
      kwh += remaining / r;
      break;
    }
    const band = l - prev;
    const tierCost = band * r;
    if (remaining <= tierCost) {
      kwh += remaining / r;
      break;
    }
    kwh += band;
    remaining -= tierCost;
    prev = l;
  }
  return Math.round(kwh);
}

export function computeResults(
  state: SolarState,
  monthlyGhi?: number[],
  monthlyTemp?: number[],
  monthlyWind?: number[],
  apiGoalAdj?: number[],
  apiBestAngle?: number,
  fitRateOverride?: number,
  degradationRateOverride?: number,
): ComputedResults {
  const region = (state.address?.region ?? '北部') as Region;
  const irr  = (monthlyGhi  && monthlyGhi.length  === 12) ? monthlyGhi  : TW_IRRADIANCE[region];
  const temp = (monthlyTemp && monthlyTemp.length  === 12) ? monthlyTemp : DEFAULT_TEMP[region];
  const wind = (monthlyWind && monthlyWind.length  === 12) ? monthlyWind : DEFAULT_WIND[region];
  const capacity = state.capacity ?? 7.7;
  const goalAdj = (apiGoalAdj && apiGoalAdj.length === 12) ? apiGoalAdj : GOAL_ADJ[state.goal ?? 'summer'];

  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Panel grade sets the base_PR fed into the Faiman model — higher grade = better thermal performance
  const gradeEntry = PANEL_GRADES.find(g => g.id === (state.panelGrade ?? 'standard'));
  const gradePerfRatio = gradeEntry?.perfRatio ?? FAIMAN.base_PR;

  // Dynamic PR per month via Faiman T_cell model (Han et al. 2026, Eq.13)
  const monthlyPR = calcMonthlyPR(irr, temp, wind, gradePerfRatio);

  const monthlyKwh = irr.map((ghi, i) =>
    Math.round(capacity * ghi * daysInMonth[i] * monthlyPR[i] * goalAdj[i])
  );
  const annualKwh = monthlyKwh.reduce((a, b) => a + b, 0);

  // PV yield per kWp (for suitability classification)
  const pvYieldPerKwp = parseFloat((annualKwh / capacity).toFixed(1));
  const suitability: 'good' | 'fair' | 'poor' =
    pvYieldPerKwp >= PV_YIELD_GOOD ? 'good' :
    pvYieldPerKwp >= PV_YIELD_POOR ? 'fair' : 'poor';

  const monthlyUse = state.monthlyKwh ?? 350;

  // 年用電量：優先用使用者輸入的 12 月明細總和，否則 monthlyKwh × 12
  const monthlyUsageArr = (state.monthlyUsage?.length === 12)
    ? state.monthlyUsage
    : TEPCO_MONTHLY_NORM.map(w => monthlyUse * w);
  const annualUsageTotal = monthlyUsageArr.reduce((a, b) => a + b, 0);

  const selfSufficiency = Math.min(100, Math.round((annualKwh / annualUsageTotal) * 100));

  // selfUseRatio：受實際用電量上限約束（不可能自用超過消費量）
  // 上限依用電習慣：0.88 在宅 / 0.75 一般 / 0.42 外出（無電池儲能）
  const selfUseCapMax = SELF_USE_CAP[state.selfUseHabit ?? 'normal'];
  const selfUseRatio = Math.min(selfUseCapMax, annualUsageTotal / annualKwh);
  const selfUsedKwh = annualKwh * selfUseRatio;
  const soldKwh = annualKwh - selfUsedKwh;
  const fitRate = fitRateOverride ?? getFitRateForCapacity(capacity);

  // 月別收益：自用電 = 月帳單差額（台電六段累進）；餘電賣台電 FIT
  let selfUseRevenue = 0;
  let fitRevenue = 0;
  monthlyKwh.forEach((kwh, i) => {
    const monthUsage = monthlyUsageArr[i];
    const monthSelfUseRatio = monthUsage > 0
      ? Math.min(selfUseCapMax, monthUsage / kwh)
      : selfUseRatio;
    const selfUsed = kwh * monthSelfUseRatio;
    const isSummer = SUMMER_MONTH_IDX.has(i);
    selfUseRevenue += calcTpcBill(monthUsage, isSummer)
                    - calcTpcBill(Math.max(0, monthUsage - selfUsed), isSummer);
    fitRevenue += (kwh - selfUsed) * fitRate;
  });
  selfUseRevenue = Math.round(selfUseRevenue);
  const annualRevenue = Math.round(selfUseRevenue + fitRevenue);

  const outOfPocket = state.outOfPocket ?? 400000;
  const paybackYears = parseFloat((outOfPocket / annualRevenue).toFixed(1));

  const degradationRate = degradationRateOverride ?? DEFAULT_DEGRADATION_RATE;
  const total20yr = Array.from({ length: 20 }, (_, y) =>
    Math.round(annualRevenue * Math.pow(1 - degradationRate, y))
  ).reduce((a, b) => a + b, 0);

  const bestAngle = apiBestAngle ?? BEST_ANGLE[state.goal ?? 'summer'];
  const recommendedAngle = `朝南，仰角 ${bestAngle}°`;

  return {
    region, annualKwh, selfSufficiency, paybackYears, total20yr,
    monthlyKwh, annualRevenue, outOfPocket, bestAngle, recommendedAngle,
    selfUsedKwh, soldKwh, selfUseRevenue,
    monthlyPR, pvYieldPerKwp, suitability,
  };
}

const COUNTY_PATTERNS: [RegExp, string][] = [
  [/新北/,       '新北市'],
  [/台北|臺北/,  '台北市'],
  [/桃園/,       '桃園市'],
  [/台中|臺中/,  '台中市'],
  [/台南|臺南/,  '台南市'],
  [/高雄/,       '高雄市'],
  [/基隆/,       '基隆市'],
  [/新竹市/,     '新竹市'],
  [/嘉義市/,     '嘉義市'],
  [/新竹縣/,     '新竹縣'],
  [/苗栗/,       '苗栗縣'],
  [/彰化/,       '彰化縣'],
  [/南投/,       '南投縣'],
  [/雲林/,       '雲林縣'],
  [/嘉義縣/,     '嘉義縣'],
  [/屏東/,       '屏東縣'],
  [/宜蘭/,       '宜蘭縣'],
  [/花蓮/,       '花蓮縣'],
  [/台東|臺東/,  '台東縣'],
  [/澎湖/,       '澎湖縣'],
  [/金門/,       '金門縣'],
  [/連江|馬祖/,  '連江縣'],
];

export function guessCounty(label?: string): string {
  if (!label) return '台北市';
  for (const [re, county] of COUNTY_PATTERNS) {
    if (re.test(label)) return county;
  }
  return '台北市';
}
