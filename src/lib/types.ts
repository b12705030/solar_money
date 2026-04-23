export type Region = '北部' | '中部' | '南部';

export interface AddressOption {
  label: string;
  meta: string;
  area: number;
  type: string;
  floors: number;
  region: Region;
}

export interface SolarState {
  address?: AddressOption;
  addressQuery?: string;
  roofArea?: number;
  monthlyKwh: number;
  goal?: string;
  costPerKw?: number;
  capacity?: number;
  totalCost?: number;
  subsidyAmount?: number;
  outOfPocket?: number;
  county?: string;
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
}
