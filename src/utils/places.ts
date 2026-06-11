export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetails {
  lat: number;
  lon: number;
  formattedAddress: string;
}

// L1: session memory cache（同 session 重打同字串 → 0ms，不打後端）
const _acSession = new Map<string, PlacePrediction[]>();

// L2: localStorage helpers（同裝置跨 session → ~1ms，省後端 roundtrip）
const AC_LS_PREFIX = 'gm_ac_';
const DETAIL_LS_PREFIX = 'gm_place_';
const LS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw) as { data: T; cachedAt: number };
    if (Date.now() - cachedAt > LS_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function lsSet(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

const _apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function getPlaceAutocomplete(input: string): Promise<PlacePrediction[]> {
  const key = input.trim().toLowerCase();
  if (!key || key.length < 2) return [];

  const t0 = performance.now();

  // L1: session memory
  if (_acSession.has(key)) {
    console.log(`[Places] L1 hit  key=${key} (${Math.round(performance.now() - t0)}ms)`);
    return _acSession.get(key)!;
  }

  // L2: localStorage (same device, across sessions)
  const lsCached = lsGet<PlacePrediction[]>(AC_LS_PREFIX + key);
  if (lsCached) {
    _acSession.set(key, lsCached);
    console.log(`[Places] L2 hit  key=${key} (${Math.round(performance.now() - t0)}ms)`);
    return lsCached;
  }

  // L3 + L4: backend proxy (checks DB cache, then calls Google API)
  console.log(`[Places] L3+ fetch key=${key}`);
  try {
    const resp = await fetch(`${_apiBase}/api/places/autocomplete?q=${encodeURIComponent(key)}`);
    if (!resp.ok) return [];
    const results: PlacePrediction[] = await resp.json();
    const elapsed = Math.round(performance.now() - t0);
    if (results.length > 0) {
      _acSession.set(key, results);
      lsSet(AC_LS_PREFIX + key, results);
      console.log(`[Places] L3+ done  key=${key} ${results.length} results (${elapsed}ms)`);
    } else {
      console.log(`[Places] L3+ done  key=${key} empty (${elapsed}ms)`);
    }
    return results;
  } catch {
    return [];
  }
}

export function warmAutocompleteCache(description: string, prediction: PlacePrediction): void {
  const key = description.trim().toLowerCase();
  if (!key) return;
  _acSession.set(key, [prediction]);
  lsSet(AC_LS_PREFIX + key, [prediction]);
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  // L2: localStorage
  const lsCached = lsGet<PlaceDetails>(DETAIL_LS_PREFIX + placeId);
  if (lsCached) return lsCached;

  // L3 + L4: backend proxy
  const resp = await fetch(`${_apiBase}/api/places/details?id=${encodeURIComponent(placeId)}`);
  if (!resp.ok) throw new Error('Place details unavailable');
  const result: PlaceDetails = await resp.json();
  lsSet(DETAIL_LS_PREFIX + placeId, result);
  return result;
}
