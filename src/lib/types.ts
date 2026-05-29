export type Region = '北部' | '中部' | '南部';

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
  message: string | null;
  vendorReply: string | null;
  repliedAt: string | null;
  caseStatus: CaseStatus;
  inquirerEmail: string | null;
  createdAt: string;
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

export interface UserInquiry {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorLogo: string | null;
  address: string | null;
  county: string | null;
  capacityKw: number;
  annualKwh: number;
  paybackYears: number;
  message: string | null;
  vendorReply: string | null;
  repliedAt: string | null;
  createdAt: string;
  reviewId: string | null;
  reviewRating: number | null;
}
