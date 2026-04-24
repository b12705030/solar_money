"""Shadow computation using pvlib + shapely, ported from ntu-cool."""
from __future__ import annotations

import threading
from datetime import date, datetime, timedelta

import httpx
import numpy as np
import pandas as pd
import pvlib
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union

OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

# ─── Buildings cache (avoids re-fetching Overpass on every slider tick) ───────
# Key: rounded bbox string  Value: (elements, fetched_at)
_bldg_cache: dict[str, tuple[list[dict], datetime]] = {}
_bldg_lock = threading.Lock()
_BLDG_TTL = timedelta(hours=1)


def _bbox_key(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> str:
    return f'{min_lon:.2f},{min_lat:.2f},{max_lon:.2f},{max_lat:.2f}'


def _cache_get(key: str) -> list[dict] | None:
    with _bldg_lock:
        entry = _bldg_cache.get(key)
        if entry and datetime.now() - entry[1] < _BLDG_TTL:
            return entry[0]
        return None


def _cache_set(key: str, elements: list[dict]) -> None:
    with _bldg_lock:
        _bldg_cache[key] = (elements, datetime.now())


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

def compute_shadows_from_features(
    buildings: list[dict],   # [{footprint: [[lng,lat],...], height: float}]
    center_lat: float,
    center_lon: float,
    local_hour: int,
) -> dict:
    """
    Compute shadows for buildings supplied by the frontend (from queryRenderedFeatures).
    Using frontend-sourced geometry ensures 100% consistency with Mapbox 3D buildings.
    """
    if not buildings:
        return {'type': 'FeatureCollection', 'features': []}

    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return {'type': 'FeatureCollection', 'features': []}

    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)

    angle = np.radians(azimuth + 180)
    max_shadow_len = 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0

    features = []
    for bldg in buildings:
        try:
            footprint = bldg['footprint']
            height = float(bldg.get('height') or 10)
            shadow_len = min(height / np.tan(np.radians(altitude)), max_shadow_len)
            dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)

            coords_3857 = [to_3857.transform(lng, lt) for lng, lt in footprint]
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


# ─── All-buildings shadow (used by /api/shadows) ──────────────────────────────

async def get_buildings(
    min_lon: float, min_lat: float, max_lon: float, max_lat: float,
) -> list[dict]:
    """Return OSM building ways for the bbox, using a 1-hour in-memory cache."""
    key = _bbox_key(min_lon, min_lat, max_lon, max_lat)
    cached = _cache_get(key)
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
                        _cache_set(key, elements)
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
