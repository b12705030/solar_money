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
  // 六都
  '台北市': { amount: 15000, per: 'kW', source: '台北市政府產業發展局' },
  '新北市': { amount: 12000, per: 'kW', source: '新北市政府環境保護局' },
  '桃園市': { amount: 10000, per: 'kW', source: '桃園市政府環境保護局' },
  '台中市': { amount: 10000, per: 'kW', source: '台中市政府環境保護局' },
  '台南市': { amount: 15000, per: 'kW', source: '台南市政府經濟發展局' },
  '高雄市': { amount: 18000, per: 'kW', source: '高雄市政府經濟發展局' },
  // 省轄市
  '基隆市': { amount: 10000, per: 'kW', source: '基隆市政府產業發展處' },
  '新竹市': { amount: 10000, per: 'kW', source: '新竹市政府環境保護處' },
  '嘉義市': { amount: 12000, per: 'kW', source: '嘉義市政府環境保護局' },
  // 縣
  '新竹縣': { amount: 8000,  per: 'kW', source: '新竹縣政府環境保護局' },
  '苗栗縣': { amount: 8000,  per: 'kW', source: '苗栗縣政府建設及工程處' },
  '彰化縣': { amount: 10000, per: 'kW', source: '彰化縣政府環境保護局' },
  '南投縣': { amount: 8000,  per: 'kW', source: '南投縣政府建設處' },
  '雲林縣': { amount: 10000, per: 'kW', source: '雲林縣政府工務處' },
  '嘉義縣': { amount: 10000, per: 'kW', source: '嘉義縣政府環境保護局' },
  '屏東縣': { amount: 12000, per: 'kW', source: '屏東縣政府環境保護局' },
  '宜蘭縣': { amount: 8000,  per: 'kW', source: '宜蘭縣政府建設處' },
  '花蓮縣': { amount: 8000,  per: 'kW', source: '花蓮縣政府建設處' },
  '台東縣': { amount: 8000,  per: 'kW', source: '台東縣政府建設處' },
  // 離島
  '澎湖縣': { amount: 15000, per: 'kW', source: '澎湖縣政府建設處' },
  '金門縣': { amount: 15000, per: 'kW', source: '金門縣政府建設局' },
  '連江縣': { amount: 15000, per: 'kW', source: '連江縣政府建設局' },
};

export const SUGGESTIONS: AddressOption[] = [
  { label: '台北市信義區松仁路 100 號', meta: '住宅大樓 · 地上12層', area: 78,  type: '公寓大廈', floors: 12, region: '北部' as Region, lat: 25.0340, lng: 121.5645 },
  { label: '新北市板橋區文化路一段 50 號', meta: '透天厝 · 地上4層',   area: 42,  type: '透天厝',   floors: 4,  region: '北部' as Region, lat: 25.0143, lng: 121.4627 },
  { label: '台中市西屯區市政路 200 號',  meta: '住宅大樓 · 地上15層', area: 92,  type: '公寓大廈', floors: 15, region: '中部' as Region, lat: 24.1634, lng: 120.6497 },
  { label: '高雄市前鎮區中山二路 80 號', meta: '透天厝 · 地上3層',    area: 38,  type: '透天厝',   floors: 3,  region: '南部' as Region, lat: 22.6089, lng: 120.3019 },
];

export const TW_IRRADIANCE: Record<Region, number[]> = {
  '北部': [2.6, 2.8, 3.5, 3.9, 4.2, 4.4, 4.8, 4.6, 4.1, 3.6, 2.9, 2.5],
  '中部': [3.1, 3.4, 4.0, 4.5, 4.8, 4.9, 5.3, 5.0, 4.6, 4.1, 3.4, 2.9],
  '南部': [3.6, 3.9, 4.5, 4.9, 5.2, 5.1, 5.5, 5.2, 4.9, 4.5, 3.9, 3.4],
};
