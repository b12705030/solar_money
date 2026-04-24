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
  onBuildingFound?: (info: { height: number; areaPing: number }) => void;
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

function ensureCCW(coords: [number, number][]): [number, number][] {
  let signedArea = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    signedArea += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return signedArea < 0 ? [...coords].reverse() : coords;
}

function polygonsConnected(a: [number, number][], b: [number, number][]): boolean {
  const T = 0.00001 * 0.00001;
  for (const pa of a) {
    for (const pb of b) {
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
      if (dx * dx + dy * dy <= T) return true;
    }
  }
  return false;
}

function connectedGroup(primaryIdx: number, allCoords: [number, number][][]): Set<number> {
  const group = new Set([primaryIdx]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < allCoords.length; i++) {
      if (group.has(i)) continue;
      for (const j of group) {
        if (polygonsConnected(allCoords[i], allCoords[j])) { group.add(i); changed = true; break; }
      }
    }
  }
  return group;
}

// ─── All-buildings shadow API ─────────────────────────────────────────────────

// AbortController for the in-flight shadow fetch — cancelled when a newer one starts
let _shadowFetchCtrl: AbortController | null = null;

async function refreshAllShadows(map: mapboxgl.Map, sunHour: number): Promise<void> {
  _shadowFetchCtrl?.abort();
  _shadowFetchCtrl = new AbortController();
  const { signal } = _shadowFetchCtrl;

  // Use clientWidth/clientHeight (CSS pixels) — canvas.width is device pixels and
  // would exceed the viewport bounds on HiDPI displays.
  const canvas = map.getCanvas();
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const M = Math.round(Math.max(W, H) * 0.4); // 40% margin — catches tall buildings outside viewport whose shadows reach in
  const rendered = map.queryRenderedFeatures([[-M, -M], [W + M, H + M]]);

  // Deduplicate: queryRenderedFeatures returns the same polygon across tile boundaries.
  const seen = new Set<string>();
  const buildings: { footprint: [number, number][]; height: number }[] = [];

  const addPolygon = (coords: [number, number][][], height: number) => {
    const exterior = coords[0] as [number, number][];
    const key = JSON.stringify(exterior[0]);
    if (seen.has(key)) return;
    seen.add(key);
    buildings.push({ footprint: exterior, height });
  };

  for (const f of rendered) {
    if (f.properties?.group !== 'building-3d') continue;
    const height = Number(f.properties?.height ?? 10);
    if (f.geometry.type === 'Polygon') {
      addPolygon(f.geometry.coordinates as [number, number][][], height);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates as [number, number][][][]) {
        addPolygon(poly, height);
      }
    }
  }

  const center = map.getCenter();
  const b = map.getBounds();
  if (!b) return;

  console.log('[MapView] buildings found for shadow:', buildings.length);

  const source = map.getSource('all-shadows') as mapboxgl.GeoJSONSource | undefined;
  if (!source || buildings.length === 0) return;

  try {
    const res = await fetch(`${API_URL}/api/shadows/from-features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildings, lat: center.lat, lng: center.lng, local_hour: sunHour }),
      signal,
    });
    if (!res.ok || signal.aborted) return;
    const data = await res.json();
    if (signal.aborted) return;
    if (data.features?.length > 0) source.setData(data);
  } catch {
    // aborted or network error
  }
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

// ─── OSM fetching ─────────────────────────────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassFetch(query: string, signal?: AbortSignal): Promise<any | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) return null;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 9000);
      signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) return await res.json();
    } catch (e: any) {
      if (signal?.aborted) return null;
    }
  }
  return null;
}

function wayToHeight(tags: Record<string, string>): number {
  if (tags?.height) return parseFloat(tags.height) || 10;
  if (tags?.['building:levels']) return (parseFloat(tags['building:levels']) || 3) * 3.2;
  return 10;
}

async function fetchBuildingFromOSM(
  lng: number, lat: number,
  signal?: AbortSignal,
): Promise<{ features: GeoJSON.Feature[]; primaryHeight: number; primaryArea: GeoJSON.Polygon } | null> {
  const query = `[out:json][timeout:8];way["building"](around:120,${lat},${lng});out geom tags;`;
  const data = await overpassFetch(query, signal);
  if (!data) { if (!signal?.aborted) console.warn('[MapView] All Overpass endpoints failed'); return null; }
  if (!data.elements?.length) return null;

  const point: [number, number] = [lng, lat];
  const parsed: { coords: [number, number][]; el: any }[] = [];
  for (const el of data.elements) {
    if (!el.geometry?.length) continue;
    const coords: [number, number][] = el.geometry.map((n: any) => [n.lon, n.lat] as [number, number]);
    const first = coords[0], last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
    parsed.push({ coords, el });
  }
  if (!parsed.length) return null;

  let primaryIdx = parsed.findIndex(({ coords }) => pointInPolygon(point, coords));
  if (primaryIdx < 0) {
    let minDist = Infinity;
    parsed.forEach(({ coords }, i) => {
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const dx = cx - point[0], dy = cy - point[1];
      const d = dx * dx + dy * dy;
      if (d < minDist) { minDist = d; primaryIdx = i; }
    });
  }

  const allCoords = parsed.map(p => p.coords);
  const group = connectedGroup(primaryIdx, allCoords);

  const features: GeoJSON.Feature[] = [];
  for (const i of group) {
    const { coords, el } = parsed[i];
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ensureCCW(coords)] },
      properties: { height: wayToHeight(el.tags ?? {}) },
    });
  }

  const primary = parsed[primaryIdx];
  const primaryHeight = wayToHeight(primary.el.tags ?? {});
  console.log('[MapView] Building found —', features.length, '/', parsed.length, 'polygons, height:', primaryHeight);
  return { features, primaryHeight, primaryArea: { type: 'Polygon', coordinates: [primary.coords] } };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MapView({ selectedAddress, onBuildingFound, sunHour = 12 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const onBuildingFoundRef = useRef(onBuildingFound);
  const buildingCacheRef = useRef<BuildingCache | null>(null);
  const sunHourRef = useRef(sunHour);
  const moveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      config: { basemap: { lightPreset: 'day', show3dObjects: true, shadows: false } },
      center: NTU_CENTER,
      zoom: 15,
      pitch: 45,
      bearing: 0,
      antialias: true,
      language: 'zh-Hant',
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('style.load', () => {
      // All-buildings shadow layer — added once, updated on move/sunHour
      map.addSource('all-shadows', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      (map as any).addLayer({
        id: 'all-shadows-fill', type: 'fill', slot: 'middle', source: 'all-shadows',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.15 },
      });
      setMapLoaded(true);

      // style.load fires before building tiles are downloaded.
      // Wait for the first idle (all tiles loaded + rendered) before querying features.
      map.once('idle', () => refreshAllShadows(map, sunHourRef.current));
    });

    // After panning, wait for new tiles to finish loading (idle) before querying
    map.on('moveend', () => {
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      moveDebounceRef.current = setTimeout(() => {
        map.once('idle', () => refreshAllShadows(map, sunHourRef.current));
      }, 300);
    });

    // DEBUG: click any building to see its Mapbox properties in the console
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point);
      console.log('[MapView] click features:', features.map(f => ({
        group: f.properties?.group,
        height: f.properties?.height,
        layer: f.layer?.id,
        sourceLayer: f.sourceLayer,
        type: f.geometry.type,
      })));
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

  // sunHour change (or initial map load) → refresh all-buildings shadows
  useEffect(() => {
    if (!mapLoaded || !mapInstance) return;
    refreshAllShadows(mapInstance, sunHour);
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

    const applyResult = (features: GeoJSON.Feature[], footprint: [number, number][], height: number, areaPing: number) => {
      if (abortCtrl.signal.aborted) return;
      buildingCacheRef.current = { features, footprint, height, lat: lngLat[1], lng: lngLat[0] };
      showHighlight(mapInstance!, features);
      onBuildingFoundRef.current?.({ height, areaPing });
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    };

    const onIdle = async () => {
      if (abortCtrl.signal.aborted) return;

      const screenPt = mapInstance!.project(lngLat);
      const rendered = mapInstance!.queryRenderedFeatures(screenPt);
      const bldgFeatures = rendered.filter(f =>
        f.properties?.group === 'building-3d' && f.geometry.type === 'Polygon'
      );

      if (bldgFeatures.length > 0) {
        const height = Number(bldgFeatures[0].properties?.height || 10);
        const feats: GeoJSON.Feature[] = bldgFeatures.map(f => ({
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: (f.geometry as GeoJSON.Polygon).coordinates },
          properties: { height },
        }));
        const footprint = (bldgFeatures[0].geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
        const areaPing = Math.max(1, Math.round(
          bldgFeatures.reduce((sum, f) => sum + polygonAreaM2((f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]), 0) * PING_PER_M2
        ));
        applyResult(feats, footprint, height, areaPing);
        return;
      }

      // Fallback: OSM Overpass
      try {
        const result = await fetchBuildingFromOSM(lngLat[0], lngLat[1], abortCtrl.signal);
        if (abortCtrl.signal.aborted || !result) return;
        const footprint = result.primaryArea.coordinates[0] as [number, number][];
        applyResult(
          result.features, footprint, result.primaryHeight,
          Math.max(1, Math.round(polygonAreaM2(footprint) * PING_PER_M2)),
        );
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.error('[MapView] Building detection error:', err);
      }
    };

    mapInstance.once('idle', onIdle);
    return () => { abortCtrl.abort(); mapInstance.off('idle', onIdle as any); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, mapInstance, selectedAddress]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
