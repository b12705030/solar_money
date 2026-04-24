"""Shadow computation using pvlib + shapely, ported from ntu-cool."""
from __future__ import annotations

from datetime import date

import httpx
import numpy as np
import pandas as pd
import pvlib
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .db import get_osm_cache, set_osm_cache

OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]


def _bbox_key(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> str:
    return f'{min_lon:.2f},{min_lat:.2f},{max_lon:.2f},{max_lat:.2f}'


# ─── Solar position ────────────────────────────────────────────────────────────

def compute_solar_position(lat: float, lon: float, timestamp: pd.Timestamp) -> tuple[float, float]:
    """Return (azimuth_deg, apparent_elevation_deg) via pvlib NREL SPA."""
    loc = pvlib.location.Location(lat, lon, tz='Asia/Taipei')
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize('Asia/Taipei')
    solpos = loc.get_solarposition(timestamp)
    return float(solpos['azimuth'].iloc[0]), float(solpos['apparent_elevation'].iloc[0])


def _make_timestamp(local_hour: int) -> pd.Timestamp:
    today = date.today()
    return pd.Timestamp(year=today.year, month=today.month, day=today.day,
                        hour=local_hour, tz='Asia/Taipei')


# ─── Single-building shadow (used by /api/shadow) ────────────────────────────

def project_shadow(
    footprint_4326: list[list[float]],  # [[lng, lat], ...] EPSG:4326
    height: float,
    lat: float,
    lon: float,
    local_hour: int,
) -> list[list[float]] | None:
    """
    Convex hull of union(footprint, translated_footprint) — same algorithm as ntu-cool.
    Returns [[lng, lat], ...] in EPSG:4326, or None when sun is below horizon.
    """
    azimuth, altitude = compute_solar_position(lat, lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return None

    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)

    coords_3857 = [to_3857.transform(lng, lt) for lng, lt in footprint_4326]
    building = Polygon(coords_3857)

    shadow_len = height / np.tan(np.radians(altitude))
    shadow_len = min(shadow_len, 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0)

    angle = np.radians(azimuth + 180)
    dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)

    shadow_tip = Polygon([(x + dx, y + dy) for x, y in building.exterior.coords])
    shadow_poly = unary_union([building, shadow_tip]).convex_hull
    if shadow_poly.is_empty:
        return None

    return [list(to_4326.transform(x, y)) for x, y in shadow_poly.exterior.coords]


# ─── Shadow from frontend-supplied building features ─────────────────────────

def _project_buildings(buildings: list[dict], to_3857) -> list[tuple]:
    """Project footprints to EPSG:3857. Returns [(Polygon|None, height), ...]."""
    result = []
    for bldg in buildings:
        try:
            height = float(bldg.get('height') or 10)
            coords = [to_3857.transform(lng, lt) for lng, lt in bldg['footprint']]
            if len(coords) < 3:
                result.append((None, height))
                continue
            poly = Polygon(coords)
            result.append((poly.buffer(0) if not poly.is_valid else poly, height))
        except Exception:
            result.append((None, float(bldg.get('height') or 10)))
    return result


def _shadows_for_sun(
    bldg_polys: list[tuple],   # [(Polygon|None, height), ...]
    azimuth: float,
    altitude: float,
    to_4326,
) -> tuple[list, list]:
    """Return (ground_features, roof_shadow_features) for a given sun position."""
    angle = np.radians(azimuth + 180)
    max_shadow_len = 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0

    # ── Phase 1: per-building shadow polygons ─────────────────────────────────
    shadow_data: list[tuple] = []   # (bldg_poly, shadow_poly | None, height)
    features = []

    for bldg_poly, height in bldg_polys:
        if bldg_poly is None:
            shadow_data.append((None, None, height))
            continue
        try:
            shadow_len = min(height / np.tan(np.radians(altitude)), max_shadow_len)
            dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)
            tip = Polygon([(x + dx, y + dy) for x, y in bldg_poly.exterior.coords])
            sp = unary_union([bldg_poly, tip]).convex_hull
            shadow_data.append((bldg_poly, sp if not sp.is_empty else None, height))
            if not sp.is_empty:
                coords_out = [list(to_4326.transform(x, y)) for x, y in sp.exterior.coords]
                features.append({'type': 'Feature',
                                  'geometry': {'type': 'Polygon', 'coordinates': [coords_out]},
                                  'properties': {}})
        except Exception:
            shadow_data.append((bldg_poly, None, height))

    # ── Phase 2: roof intersections via STRtree (O(n log n)) ─────────────────
    roof_features = []
    valid = [(i, bp, sp, h) for i, (bp, sp, h) in enumerate(shadow_data)
             if bp is not None and sp is not None]

    if len(valid) >= 2:
        tree = STRtree([sp for _, _, sp, _ in valid])
        for i, (bp_i, _, h_i) in enumerate(shadow_data):
            if bp_i is None:
                continue
            overlap = None
            for k in tree.query(bp_i):
                orig, bp_j, sp_j, h_j = valid[k]
                if orig == i or h_j <= h_i:
                    continue
                try:
                    inter = bp_i.intersection(sp_j.difference(bp_j))
                    if not inter.is_empty:
                        overlap = inter if overlap is None else overlap.union(inter)
                except Exception:
                    continue
            if overlap is not None and not overlap.is_empty:
                geoms = list(overlap.geoms) if overlap.geom_type.startswith('Multi') else [overlap]
                for g in geoms:
                    if g.geom_type == 'Polygon' and not g.is_empty:
                        try:
                            c = [list(to_4326.transform(x, y)) for x, y in g.exterior.coords]
                            roof_features.append({'type': 'Feature',
                                                   'geometry': {'type': 'Polygon', 'coordinates': [c]},
                                                   'properties': {'height': h_i}})
                        except Exception:
                            continue

    return features, roof_features


def compute_shadows_from_features(
    buildings: list[dict],
    center_lat: float,
    center_lon: float,
    local_hour: int,
) -> dict:
    if not buildings:
        return {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)
    bldg_polys = _project_buildings(buildings, to_3857)
    features, roof_features = _shadows_for_sun(bldg_polys, azimuth, altitude, to_4326)
    return {'type': 'FeatureCollection', 'features': features, 'roofShadows': roof_features}


def precompute_shadows_all_hours(
    buildings: list[dict],
    center_lat: float,
    center_lon: float,
) -> dict:
    """Compute shadows for hours 6–19, projecting building footprints only once."""
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)
    empty = {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    if not buildings:
        return {str(h): empty for h in range(6, 20)}
    bldg_polys = _project_buildings(buildings, to_3857)
    result = {}
    for hour in range(6, 20):
        az, alt = compute_solar_position(center_lat, center_lon, _make_timestamp(hour))
        if alt <= 0:
            result[str(hour)] = empty
            continue
        features, roof_features = _shadows_for_sun(bldg_polys, az, alt, to_4326)
        result[str(hour)] = {'type': 'FeatureCollection', 'features': features, 'roofShadows': roof_features}
    return result


# ─── All-buildings shadow (used by /api/shadows) ──────────────────────────────

async def get_buildings(
    min_lon: float, min_lat: float, max_lon: float, max_lat: float,
) -> list[dict]:
    """Return OSM building ways for the bbox. DB cache (7 days) → Overpass fallback."""
    key = _bbox_key(min_lon, min_lat, max_lon, max_lat)

    cached = await get_osm_cache(key)
    if cached is not None:
        return cached

    query = (
        f'[out:json][timeout:25];'
        f'way["building"]({min_lat},{min_lon},{max_lat},{max_lon});'
        f'out geom tags;'
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                res = await client.post(endpoint, data={'data': query})
                if res.status_code == 200:
                    elements = res.json().get('elements', [])
                    if elements:
                        await set_osm_cache(key, elements)
                    return elements
            except Exception:
                continue
    return []


def _way_height(tags: dict) -> float:
    if tags.get('height'):
        try:
            return float(str(tags['height']).split()[0])
        except ValueError:
            pass
    if tags.get('building:levels'):
        try:
            return float(tags['building:levels']) * 3.2
        except ValueError:
            pass
    return 10.0


def compute_bbox_shadows(
    elements: list[dict],
    center_lat: float,
    center_lon: float,
    local_hour: int,
) -> dict:
    """
    Compute shadow polygons for all OSM building elements in the bbox.
    Returns a GeoJSON FeatureCollection.
    """
    if not elements:
        return {'type': 'FeatureCollection', 'features': []}

    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return {'type': 'FeatureCollection', 'features': []}

    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)

    angle = np.radians(azimuth + 180)
    max_shadow_len = 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0

    features = []
    for el in elements:
        if el.get('type') != 'way' or not el.get('geometry'):
            continue
        try:
            height = _way_height(el.get('tags', {}))
            shadow_len = min(height / np.tan(np.radians(altitude)), max_shadow_len)
            dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)

            coords_3857 = [to_3857.transform(n['lon'], n['lat']) for n in el['geometry']]
            if len(coords_3857) < 3:
                continue

            building = Polygon(coords_3857)
            if not building.is_valid:
                building = building.buffer(0)

            shadow_tip = Polygon([(x + dx, y + dy) for x, y in building.exterior.coords])
            shadow_poly = unary_union([building, shadow_tip]).convex_hull
            if shadow_poly.is_empty:
                continue

            coords_out = [list(to_4326.transform(x, y)) for x, y in shadow_poly.exterior.coords]
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': [coords_out]},
                'properties': {},
            })
        except Exception:
            continue

    return {'type': 'FeatureCollection', 'features': features}
