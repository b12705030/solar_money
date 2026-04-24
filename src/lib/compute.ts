import type { SolarState, ComputedResults, Region } from './types';
import { TW_IRRADIANCE } from './constants';

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

export function computeResults(state: SolarState): ComputedResults {
  const region = (state.address?.region ?? '北部') as Region;
  const irr = TW_IRRADIANCE[region];
  const capacity = state.capacity ?? 7.7;
  const goalAdj = GOAL_ADJ[state.goal ?? 'summer'];

  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const perfRatio = 0.78;
  const monthlyKwh = irr.map((ghi, i) =>
    Math.round(capacity * ghi * daysInMonth[i] * perfRatio * goalAdj[i])
  );
  const annualKwh = monthlyKwh.reduce((a, b) => a + b, 0);

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

  const bestAngle = BEST_ANGLE[state.goal ?? 'summer'];
  const recommendedAngle =
    state.goal === 'summer' ? '朝南，仰角 10°' :
    state.goal === 'winter' ? '朝南，仰角 45°' :
    '朝南，仰角 22°';

  return {
    region, annualKwh, selfSufficiency, paybackYears, total20yr,
    monthlyKwh, annualRevenue, outOfPocket, bestAngle, recommendedAngle,
    selfUsedKwh, soldKwh,
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
