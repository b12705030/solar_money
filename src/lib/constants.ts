import type { AddressOption, Region } from './types';

export const STEPS = ['地址', '用電', '目標', '參數', '結果'] as const;

export const TWEAKS_DEFAULTS = {
  theme: 'forest' as const,
  density: 'comfortable' as const,
};

export const MISCONCEPTIONS = [
  {
    myth: '北部日照不足，裝了也沒用',
    truth: '北部容量因數約 12.47%，與德國、日本水準相當，太陽能在北部依然可行。',
    stat: '12.47%',
    statLabel: '北部容量因數',
    compare: '德國 11% · 日本 13%',
  },
  {
    myth: '裝了太陽能板，室內會更熱',
    truth: '板子擋住屋頂直射陽光，實測室內溫度反而降低 2–4°C，空調需求下降。',
    stat: '−3.1°C',
    statLabel: '頂樓室內降溫',
    compare: '夏季實測平均值',
  },
  {
    myth: '太陽能板很難回收，對環境有害',
    truth: '鋁殼、玻璃、矽晶皆可回收。台灣已建立回收產業鏈，能源部訂有回收處理專章。',
    stat: '94%',
    statLabel: '材料可回收比例',
    compare: '板材質量占比',
  },
  {
    myth: '要10年才能回本，設備那時候都壞了',
    truth: '台北信義新城社區實例：年售電收入約 100 萬元，7–8 年回本。設備保固可達 25 年。',
    stat: '7–8 年',
    statLabel: '實例回本期',
    compare: '保固 25 年 · 餘 17 年純收益',
  },
  {
    myth: '多餘的電台電不收，自己用不完',
    truth: '台電躉購制度 (FIT) 保障收購 20 年，小容量屋頂每度最高 5.7 元。',
    stat: '$5.7 /度',
    statLabel: 'FIT 最高躉購費率',
    compare: '保障 20 年收購',
  },
] as const;

export const GOALS = [
  { id: 'annual',  title: '全年總發電量最高', desc: '讓板子一整年盡量多發電',            icon: 'annual' },
  { id: 'summer',  title: '夏季發電量最高',   desc: '夏天冷氣用電多，讓太陽能補上這塊',  icon: 'summer' },
  { id: 'winter',  title: '冬季發電量最高',   desc: '適合冬天用電需求高的家庭',          icon: 'winter' },
  { id: 'peak',    title: '正午峰值最高',     desc: '讓每天最強的那段陽光被充分利用',     icon: 'peak' },
  { id: 'match',   title: '與用電曲線最匹配', desc: '讓發電時間對齊你的用電時間，減少浪費', icon: 'match' },
  { id: 'roi',     title: '投資回收最快',     desc: '最快看到錢回來',                   icon: 'roi' },
] as const;

export const SUBSIDIES: Record<string, { amount: number; per: string; source: string }> = {
  '台北市': { amount: 15000, per: 'kW', source: '台北市政府產發局' },
  '新北市': { amount: 12000, per: 'kW', source: '新北市綠能推動計畫' },
  '台中市': { amount: 10000, per: 'kW', source: '台中市環保局' },
  '高雄市': { amount: 18000, per: 'kW', source: '高雄市經發局' },
};

export const SUGGESTIONS: AddressOption[] = [
  { label: '台北市信義區松仁路 100 號', meta: '住宅大樓 · 地上12層', area: 78,  type: '公寓大廈', floors: 12, region: '北部' as Region },
  { label: '新北市板橋區文化路一段 50 號', meta: '透天厝 · 地上4層',   area: 42,  type: '透天厝',   floors: 4,  region: '北部' as Region },
  { label: '台中市西屯區市政路 200 號',  meta: '住宅大樓 · 地上15層', area: 92,  type: '公寓大廈', floors: 15, region: '中部' as Region },
  { label: '高雄市前鎮區中山二路 80 號', meta: '透天厝 · 地上3層',    area: 38,  type: '透天厝',   floors: 3,  region: '南部' as Region },
];

export const TW_IRRADIANCE: Record<Region, number[]> = {
  '北部': [2.6, 2.8, 3.5, 3.9, 4.2, 4.4, 4.8, 4.6, 4.1, 3.6, 2.9, 2.5],
  '中部': [3.1, 3.4, 4.0, 4.5, 4.8, 4.9, 5.3, 5.0, 4.6, 4.1, 3.4, 2.9],
  '南部': [3.6, 3.9, 4.5, 4.9, 5.2, 5.1, 5.5, 5.2, 4.9, 4.5, 3.9, 3.4],
};
