import type { SolarState, ComputedResults, Region } from './types';
import { TW_IRRADIANCE, DEFAULT_TEMP, DEFAULT_WIND } from './constants';

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

function calcMonthlyPR(ghiArr: number[], tempArr: number[], windArr: number[]): number[] {
  return ghiArr.map((ghi, i) => {
    const T_cell = tempArr[i] + ghi / (FAIMAN.U0 + FAIMAN.U1 * windArr[i]);
    const eta = 1 + FAIMAN.gamma * (T_cell - FAIMAN.T_ref);
    // Clamp: physically reasonable range 0.50–1.00
    return Math.min(1.0, Math.max(0.50, FAIMAN.base_PR * eta));
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

export function computeResults(
  state: SolarState,
  monthlyGhi?: number[],
  monthlyTemp?: number[],
  monthlyWind?: number[],
  apiGoalAdj?: number[],
  apiBestAngle?: number,
): ComputedResults {
  const region = (state.address?.region ?? '北部') as Region;
  const irr  = (monthlyGhi  && monthlyGhi.length  === 12) ? monthlyGhi  : TW_IRRADIANCE[region];
  const temp = (monthlyTemp && monthlyTemp.length  === 12) ? monthlyTemp : DEFAULT_TEMP[region];
  const wind = (monthlyWind && monthlyWind.length  === 12) ? monthlyWind : DEFAULT_WIND[region];
  const capacity = state.capacity ?? 7.7;
  const goalAdj = (apiGoalAdj && apiGoalAdj.length === 12) ? apiGoalAdj : GOAL_ADJ[state.goal ?? 'summer'];

  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Dynamic PR per month via Faiman T_cell model (Han et al. 2026, Eq.13)
  const monthlyPR = calcMonthlyPR(irr, temp, wind);

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
  const annualUse = monthlyUse * 12;
  const selfSufficiency = Math.min(100, Math.round((annualKwh / annualUse) * 100));

  const selfUseRatio = 0.4;
  const selfUsedKwh = annualKwh * selfUseRatio;
  const soldKwh = annualKwh - selfUsedKwh;
  const fitRate = 5.7;
  const gridAvoidRate = 2.5;
  const annualRevenue = Math.round(selfUsedKwh * gridAvoidRate + soldKwh * fitRate);

  const outOfPocket = state.outOfPocket ?? 400000;
  const paybackYears = parseFloat((outOfPocket / annualRevenue).toFixed(1));

  const total20yr = Array.from({ length: 20 }, (_, y) =>
    Math.round(annualRevenue * Math.pow(0.995, y))
  ).reduce((a, b) => a + b, 0);

  const bestAngle = apiBestAngle ?? BEST_ANGLE[state.goal ?? 'summer'];
  const recommendedAngle = `朝南，仰角 ${bestAngle}°`;

  return {
    region, annualKwh, selfSufficiency, paybackYears, total20yr,
    monthlyKwh, annualRevenue, outOfPocket, bestAngle, recommendedAngle,
    selfUsedKwh, soldKwh,
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
