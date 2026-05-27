'use client';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { AddressOption } from '@/lib/types';

const NTU_CENTER: [number, number] = [121.5396, 25.0174];
const PING_PER_M2 = 1 / 3.30579;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type Props = {
  selectedAddress?: AddressOption | null;
  onBuildingFound?: (info: { height: number; areaPing: number; usableFraction?: number }) => void;
  sunHour?: number; // local Taiwan time (UTC+8), 0–23
};

interface BuildingCache {
  features: GeoJSON.Feature[];
  footprint: [number, number][];
  height: number;
  lat: number;
  lng: number;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function polygonAreaM2(coords: [number, number][]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    area += coords[i][0] * coords[i + 1][1];
    area -= coords[i + 1][0] * coords[i][1];
  }
  const midLat = coords.reduce((s, c) => s + c[1], 0) / n;
  const latRad = (midLat * Math.PI) / 180;
  return (Math.abs(area) / 2) * 110540 * (111320 * Math.cos(latRad));
}

function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}



// ─── All-buildings shadow API ─────────────────────────────────────────────────

type HourData = { type: string; features: GeoJSON.Feature[]; roofShadows: GeoJSON.Feature[] };

// AbortController for the in-flight precompute fetch
let _shadowFetchCtrl: AbortController | null = null;

function _applyHourData(map: mapboxgl.Map, data: HourData) {
  const source = map.getSource('all-shadows') as mapboxgl.GeoJSONSource | undefined;
  const roofSource = map.getSource('roof-shadows') as mapboxgl.GeoJSONSource | undefined;
  console.log('[Shadow] apply — ground:', data.features?.length, 'roof:', data.roofShadows?.length);
  if (source)
    source.setData({ type: 'FeatureCollection', features: data.features ?? [] });
  if (roofSource) {
    // Scale overlay slightly outside the building footprint to avoid depth-test z-fighting
    // (same trick used by the amber highlight layer: scalePoly + height+0.5)
    const scaled = (data.roofShadows ?? []).map(f => {
      const geom = f.geometry as GeoJSON.Polygon;
      if (geom?.type !== 'Polygon') return f;
      const coords = geom.coordinates[0] as [number, number][];
      return {
        ...f,
        geometry: { ...geom, coordinates: [scalePoly(coords, 1.015)] },
        properties: { ...f.properties, height: (f.properties?.height ?? 10) + 0.5 },
      };
    });
    roofSource.setData({ type: 'FeatureCollection', features: scaled });
  }
}

async function refreshAllShadows(
  map: mapboxgl.Map,
  sunHourRef: React.MutableRefObject<number>,
  cacheRef: React.MutableRefObject<Map<number, HourData>>,
  buildingsRef: React.MutableRefObject<{ footprint: [number, number][]; height: number }[]>,
  setLoading?: (v: boolean) => void,
): Promise<void> {
  _shadowFetchCtrl?.abort();
  _shadowFetchCtrl = new AbortController();
  const { signal } = _shadowFetchCtrl;
  setLoading?.(true);

  const center = map.getCenter();
  const bounds = map.getBounds();
  const sw = bounds!.getSouthWest();
  const ne = bounds!.getNorthEast();
  let buildings: { footprint: [number, number][]; height: number }[] = [];
  try {
    const res = await fetch(
      `${API_URL}/api/buildings?min_lon=${sw.lng}&min_lat=${sw.lat}&max_lon=${ne.lng}&max_lat=${ne.lat}`,
      { signal },
    );
    if (res.ok) {
      ({ buildings } = await res.json());
      buildingsRef.current = buildings;  // 儲存供 slider fallback 使用
    }
  } catch { /* network error; buildings 留空 */ }

  console.log('[Shadow] buildings:', buildings.length);

  // 更新自訂 3D 建物 layer（GBA/NLSC 資料）
  const bldgSource3d = map.getSource('api-buildings-3d') as mapboxgl.GeoJSONSource | undefined;
  if (bldgSource3d && !signal.aborted) {
    const bldgFeats: GeoJSON.Feature[] = buildings.map(b => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [b.footprint] },
      properties: { height: b.height },
    }));
    bldgSource3d.setData({ type: 'FeatureCollection', features: bldgFeats });
  }

  const source = map.getSource('all-shadows') as mapboxgl.GeoJSONSource | undefined;
  if (!source || signal.aborted || buildings.length === 0) { setLoading?.(false); return; }

  const bodyBase = { buildings, lat: center.lat, lng: center.lng };

  // Phase 1 — current hour only (~300 ms): sole owner of the display update.
  // Phase 2 — all 14 hours: fills cacheRef for the time slider only, never touches display.
  // Separating responsibilities avoids stale DB cache overwriting Phase 1's correct result.
  const phase1 = fetch(`${API_URL}/api/shadows/from-features`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bodyBase, local_hour: sunHourRef.current }),
    signal,
  }).then(async r => {
    if (!r.ok || signal.aborted) return;
    const data: HourData = await r.json();
    if (signal.aborted) return;
    _applyHourData(map, data);
    if (!signal.aborted) setLoading?.(false);
  }).catch(() => {});

  // Phase 2 — all 14 hours (2–5 s, or instant on DB cache hit): fills cacheRef for slider
  const phase2 = fetch(`${API_URL}/api/shadows/precompute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bodyBase, local_hour: 12 }),
    signal,
  }).then(async r => {
    if (!r.ok || signal.aborted) return;
    const allHours: Record<string, HourData> = await r.json();
    if (signal.aborted) return;
    cacheRef.current.clear();
    for (const [h, data] of Object.entries(allHours)) {
      cacheRef.current.set(Number(h), data);
    }
    if (!signal.aborted) setLoading?.(false);
  }).catch(() => {});

  await Promise.all([phase1, phase2]);
}

// ─── Map layer helpers ────────────────────────────────────────────────────────

function scalePoly(coords: [number, number][], factor: number): [number, number][] {
  const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return coords.map(([lng, lat]) => [cx + (lng - cx) * factor, cy + (lat - cy) * factor] as [number, number]);
}

function clearHighlight(map: mapboxgl.Map) {
  ['highlight-base', 'highlight-fill'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource('highlighted-building')) map.removeSource('highlighted-building');
}

function showHighlight(map: mapboxgl.Map, features: GeoJSON.Feature[]) {
  clearHighlight(map);
  map.addSource('highlighted-building', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: features.map(f => {
        const geom = f.geometry as GeoJSON.Polygon;
        return {
          ...f,
          geometry: { ...geom, coordinates: [scalePoly(geom.coordinates[0] as [number, number][], 1.012)] },
          properties: { ...f.properties, height: (f.properties?.height ?? 10) + 0.5 },
        };
      }),
    } as GeoJSON.FeatureCollection,
  });
  (map as any).addLayer({
    id: 'highlight-base', type: 'fill-extrusion', slot: 'top', source: 'highlighted-building',
    paint: { 'fill-extrusion-color': '#E8A53C', 'fill-extrusion-height': 1, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1, 'fill-extrusion-emissive-strength': 1 },
  });
  (map as any).addLayer({
    id: 'highlight-fill', type: 'fill-extrusion', slot: 'top', source: 'highlighted-building',
    paint: { 'fill-extrusion-color': '#E8A53C', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1, 'fill-extrusion-emissive-strength': 1 },
  });
}


// ─── Component ────────────────────────────────────────────────────────────────

export default function MapView({ selectedAddress, onBuildingFound, sunHour = 12 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [shadowLoading, setShadowLoading] = useState(false);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const onBuildingFoundRef = useRef(onBuildingFound);
  const buildingCacheRef = useRef<BuildingCache | null>(null);
  const sunHourRef = useRef(sunHour);
  const moveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shadowCacheRef = useRef<Map<number, HourData>>(new Map());
  const buildingsRef = useRef<{ footprint: [number, number][]; height: number }[]>([]);

  useEffect(() => { onBuildingFoundRef.current = onBuildingFound; });
  useEffect(() => { sunHourRef.current = sunHour; }, [sunHour]);

  // Map init — also adds the persistent all-shadows source/layer
  useEffect(() => {
    if (!containerRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
    if (!token || !token.startsWith('pk.')) { console.error('[MapView] Invalid or missing Mapbox token'); return; }
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      config: { basemap: { lightPreset: 'day', show3dObjects: false, shadows: false } },
      center: NTU_CENTER,
      zoom: 15,
      pitch: 45,
      bearing: 0,
      antialias: true,
      language: 'zh-Hant',
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('style.load', () => {
      // Ensure Mapbox native 3D buildings are hidden (must re-apply on every style.load)
      try { (map as any).setConfigProperty('basemap', 'show3dObjects', false); } catch (_) {}

      // All-buildings shadow layer — added once, updated on move/sunHour
      map.addSource('all-shadows', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      (map as any).addLayer({
        id: 'all-shadows-fill', type: 'fill', slot: 'middle', source: 'all-shadows',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.15 },
      });

      // 自訂 3D 建物層（來自 /api/buildings，GBA/NLSC 官方資料）
      // Mapbox 原生 show3dObjects 已關閉，改由此 layer 渲染
      map.addSource('api-buildings-3d', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      (map as any).addLayer({
        id: 'api-buildings-fill',
        type: 'fill-extrusion',
        slot: 'middle',
        source: 'api-buildings-3d',
        paint: {
          'fill-extrusion-color': '#d4d0c8',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
        },
      });

      // Shadow overlay on buildings: the intersection polygon (partial footprint in shadow)
      // extruded to the shadowed building's full height.
      map.addSource('roof-shadows', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      (map as any).addLayer({
        id: 'roof-shadows-fill', type: 'fill-extrusion', slot: 'top', source: 'roof-shadows',
        paint: {
          'fill-extrusion-color': '#000000',
          'fill-extrusion-emissive-strength': 1,
          'fill-extrusion-opacity': 0.25,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
        },
      });

      setMapLoaded(true);
      setShadowLoading(true); // show spinner immediately; cleared when first idle calculation completes

      // style.load fires before building tiles are downloaded.
      // Wait for the first idle (all tiles loaded + rendered) before querying features.
      map.once('idle', () => refreshAllShadows(map, sunHourRef, shadowCacheRef, buildingsRef, setShadowLoading));
    });

    // After panning, refresh shadows once tiles are settled.
    // If tiles are cached, map may already be idle when the timer fires —
    // in that case map.once('idle') never fires, so call directly via map.loaded() check.
    map.on('moveend', () => {
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      moveDebounceRef.current = setTimeout(() => {
        setShadowLoading(true); // spinner only when calculation is actually about to start
        const doRefresh = () => refreshAllShadows(map, sunHourRef, shadowCacheRef, buildingsRef, setShadowLoading);
        if (map.loaded()) {
          doRefresh();
        } else {
          map.once('idle', doRefresh);
        }
      }, 600);
    });

    map.on('error', (e) => console.error('[MapView] error:', e));
    setMapInstance(map);
    return () => {
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      map.remove();
      setMapInstance(null);
      setMapLoaded(false);
    };
  }, []);

  // sunHour change → use cache (instant); fallback to live fetch on cache miss / empty
  useEffect(() => {
    if (!mapLoaded || !mapInstance) return;
    const cached = shadowCacheRef.current.get(sunHour);
    if (cached && (cached.features?.length ?? 0) > 0) {
      _applyHourData(mapInstance, cached);
      return;
    }
    // Cache miss 或全空 → 即時呼叫 from-features，結果回填記憶體快取
    const buildings = buildingsRef.current;
    if (!buildings.length) return;
    const center = mapInstance.getCenter();
    fetch(`${API_URL}/api/shadows/from-features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildings, lat: center.lat, lng: center.lng, local_hour: sunHour }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: HourData | null) => {
        if (data) {
          shadowCacheRef.current.set(sunHour, data);  // 回填，下次拖到同小時立即回應
          _applyHourData(mapInstance!, data);
        }
      })
      .catch(() => {});
  }, [sunHour, mapLoaded, mapInstance]);

  // Address change → detect building → show amber highlight
  useEffect(() => {
    if (!mapLoaded || !mapInstance) return;
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    clearHighlight(mapInstance);
    buildingCacheRef.current = null;
    if (!selectedAddress?.lat || !selectedAddress?.lng) return;

    const lngLat: [number, number] = [selectedAddress.lng, selectedAddress.lat];
    markerRef.current = new mapboxgl.Marker({ color: '#2D6A4F' }).setLngLat(lngLat).addTo(mapInstance);
    mapInstance.flyTo({ center: lngLat, zoom: 17, pitch: 45, duration: 1500 });

    const abortCtrl = new AbortController();

    const applyResult = (features: GeoJSON.Feature[], footprint: [number, number][], height: number, areaPing: number, usableFraction?: number) => {
      if (abortCtrl.signal.aborted) return;
      buildingCacheRef.current = { features, footprint, height, lat: lngLat[1], lng: lngLat[0] };
      showHighlight(mapInstance!, features);
      onBuildingFoundRef.current?.({ height, areaPing, usableFraction });
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    };

    const detectBuilding = async () => {
      if (abortCtrl.signal.aborted) return;

      // 計算可用屋頂比例 — 使用 buildingsRef 中已快取的視口 GBA 建物（無需額外 API 呼叫）
      const fetchUsableFraction = async (targetFootprint: [number, number][]): Promise<number | undefined> => {
        try {
          const vpBuildings = buildingsRef.current;
          const res = await fetch(`${API_URL}/api/usable-fraction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_footprint: targetFootprint, buildings: vpBuildings, lat: lngLat[1], lng: lngLat[0] }),
            signal: abortCtrl.signal,
          });
          if (!res.ok || abortCtrl.signal.aborted) return undefined;
          const data = await res.json();
          return typeof data.usable_fraction === 'number' ? data.usable_fraction : undefined;
        } catch { return undefined; }
      };

      try {
        const res = await fetch(
          `${API_URL}/api/buildings?lat=${lngLat[1]}&lng=${lngLat[0]}&radius_m=150`,
          { signal: abortCtrl.signal },
        );
        if (!res.ok || abortCtrl.signal.aborted) return;
        const { buildings: nearby }: { buildings: { footprint: [number, number][]; height: number }[] } = await res.json();
        if (!nearby?.length || abortCtrl.signal.aborted) return;

        // 優先找包含點的建物，其次取最近 centroid
        const point: [number, number] = lngLat;
        let primary = nearby.find(b => pointInPolygon(point, b.footprint)) ?? null;
        if (!primary) {
          let minD = Infinity;
          for (const b of nearby) {
            const cx = b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length;
            const cy = b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length;
            const d = (cx - point[0]) ** 2 + (cy - point[1]) ** 2;
            if (d < minD) { minD = d; primary = b; }
          }
        }
        if (!primary) return;

        // 橙色 highlight 只顯示選中的那棟；周邊建物由 api-buildings-fill（灰色）統一顯示
        const primaryFeat: GeoJSON.Feature = {
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [primary.footprint] },
          properties: { height: primary.height },
        };
        const areaPing = Math.max(1, Math.round(polygonAreaM2(primary.footprint) * PING_PER_M2));
        const usableFraction = await fetchUsableFraction(primary.footprint);
        console.log('[MapView] GBA building — height:', primary.height, 'area ping:', areaPing, 'usable:', usableFraction);
        applyResult([primaryFeat], primary.footprint, primary.height, areaPing, usableFraction);
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.error('[MapView] Building detection error:', err);
      }
    };

    mapInstance.once('idle', detectBuilding);
    return () => { abortCtrl.abort(); mapInstance.off('idle', detectBuilding as any); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, mapInstance, selectedAddress]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {shadowLoading && (
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 10,
          background: 'rgba(255,255,255,0.88)', borderRadius: 8,
          padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: '#555', boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            border: '2px solid #ddd', borderTopColor: '#2D6A4F',
            animation: 'spin 0.6s linear infinite',
          }} />
          計算陰影中…
        </div>
      )}
    </div>
  );
}
