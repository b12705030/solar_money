export type Region = '北部' | '中部' | '南部' | '東部';

export interface AddressOption {
  label: string;
  meta: string;
  area: number;
  type: string;
  floors: number;
  region: Region;
  lat?: number;
  lng?: number;
}

export interface SolarState {
  address?: AddressOption;
  addressQuery?: string;
  roofArea?: number;
  monthlyKwh: number;
  goal?: string;
  budgetCeiling?: number;
  panelGrade?: string;
  costPerKw?: number;
  capacity?: number;
  totalCost?: number;
  subsidyAmount?: number;
  outOfPocket?: number;
  county?: string;
  /** 內政部 8 碼鄉鎮市代碼（例如 06300100），由 /api/address-township 查詢取得 */
  townshipCode?: string;
  townshipName?: string;
  usableFraction?: number;
  /** 使用者自訂 12 個月用電量 (kWh)，供 match 目標個人化優化與收益計算 */
  monthlyUsage?: number[];
  /** 日間用電習慣，決定自用比例上限 */
  selfUseHabit?: 'home' | 'normal' | 'away';
  /** 帳單輸入模式：'bill' = 輸入帳單金額自動換算，'kwh' = 直接輸入度數 */
  inputMethod?: 'bill' | 'kwh';
  /** 台電雙月帳單金額（NT$），bill 模式下使用 */
  billAmount?: number;
  /** 帳單所在季節，決定夏月/非夏月費率 */
  billSeason?: 'summer' | 'nonSummer';
  /** 建物最大可用坪數（來自 /api/building-info），用於輸入驗證 */
  roofAreaMax?: number;
  /** 使用者輸入的可用坪數超出建物面積或無效，阻擋進入下一步 */
  roofAreaError?: boolean;
  /** 六份雙月帳單明細（NT$），null 表示該份未填；有值時由 disaggregateBills 推算 monthlyUsage */
  billAmounts?: (number | null)[];
  /** 六份帳單各自的季節（'summer' | 'nonSummer'），未設時依 BILL_PAIR_META 預設值 */
  billSeasons?: ('summer' | 'nonSummer')[];
}

export type Theme = 'forest' | 'ocean' | 'earth';
export type Density = 'comfortable' | 'compact';

export interface TweaksState {
  theme: Theme;
  density: Density;
}

export interface ComputedResults {
  region: Region;
  annualKwh: number;
  selfSufficiency: number;
  paybackYears: number;
  total20yr: number;
  monthlyKwh: number[];
  annualRevenue: number;
  outOfPocket: number;
  bestAngle: number;
  recommendedAngle: string;
  selfUsedKwh: number;
  soldKwh: number;
  selfUseRevenue: number;
  /** 每月動態 Performance Ratio（Faiman T_cell 模型，考量溫度與風速） */
  monthlyPR: number[];
  /** 年發電效率 kWh/kWp，用於 Han et al. (2026) ±σ 適宜性分類 */
  pvYieldPerKwp: number;
  /** 氣候適宜性：依 Han et al. (2026) Fig.11 門檻值分類 */
  suitability: 'good' | 'fair' | 'poor';
}

export interface VendorRecommendation {
  id: string;
  name: string;
  counties: string[];
  portfolioTitle: string;
  portfolioMeta: string;
  capacityKw: number;
  rating: number;
  reviewCount: number;
  phone: string;
  email: string;
  tags: string[];
  logoUrl?: string | null;
}

export interface VendorPortfolio {
  id: string;
  title: string;
  meta: string;
  capacityKw: number;
  completedYear: number | null;
  isFeatured: boolean;
  photoUrl: string | null;
  description: string | null;
}

export interface VendorDetail extends VendorRecommendation {
  approved: boolean;
  subscriptionStatus: string;
  logoUrl: string | null;
  portfolios: VendorPortfolio[];
}

export interface MyVendor {
  id: string;
  name: string;
  counties: string[];
  rating: number;
  reviewCount: number;
  phone: string;
  email: string;
  tags: string[];
  applicationStatus: string;
  subscriptionStatus: string;
  approved: boolean;
  logoUrl: string | null;
  portfolios: VendorPortfolio[];
}

export type CaseStatus = 'new' | 'contacted' | 'quoted' | 'closed';

export interface Inquiry {
  id: string;
  address: string | null;
  county: string | null;
  capacityKw: number;
  annualKwh: number;
  paybackYears: number;
  caseStatus: CaseStatus;
  inquirerEmail: string | null;
  createdAt: string;
  vendorLastReadAt: string | null;
  messages: InquiryMessage[];
}

export interface RegionPotential {
  towncode: string;
  countyname: string;
  townname: string;
  rank: number;
  total: number;
  tier: '高潛力' | '中潛力' | '一般';
  topsis_score: number;
}

export interface PotentialLead {
  id: string;
  address: string | null;
  county: string | null;
  capacityKw: number;
  annualKwh: number;
  paybackYears: number;
  outOfPocket: number;
  accountEmail: string;
  createdAt: string;
}

export interface InquiryMessage {
  id: string;
  sender: 'user' | 'vendor';
  content: string;
  createdAt: string;
}

export interface UserInquiry {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorLogo: string | null;
  vendorRating: number;
  vendorReviewCount: number;
  address: string | null;
  county: string | null;
  capacityKw: number;
  annualKwh: number;
  paybackYears: number;
  createdAt: string;
  userLastReadAt: string | null;
  messages: InquiryMessage[];
  reviewId: string | null;
  reviewRating: number | null;
  reviewComment: string | null;
}
