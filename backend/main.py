from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .shadow import compute_bbox_shadows, compute_shadows_from_features, get_buildings, project_shadow

app = FastAPI(title='Solar Money API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ─── Single-building shadow ───────────────────────────────────────────────────

class ShadowRequest(BaseModel):
    lat: float
    lng: float
    local_hour: int               # Taiwan time UTC+8, 0–23
    footprint: List[List[float]]  # [[lng, lat], ...] EPSG:4326
    height: float


class ShadowResponse(BaseModel):
    shadow: Optional[List[List[float]]]  # [[lng, lat], ...] or null


@app.post('/api/shadow', response_model=ShadowResponse)
def compute_shadow(req: ShadowRequest):
    try:
        coords = project_shadow(req.footprint, req.height, req.lat, req.lng, req.local_hour)
        return ShadowResponse(shadow=coords)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ─── All-buildings shadow for a bounding box ─────────────────────────────────

@app.get('/api/shadows')
async def get_all_shadows(
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    local_hour: int = Query(...),
):
    """
    Fetch OSM buildings inside the bbox, compute their shadow polygons via pvlib,
    and return a GeoJSON FeatureCollection.
    """
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2

    elements = await get_buildings(min_lon, min_lat, max_lon, max_lat)

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: compute_bbox_shadows(elements, center_lat, center_lon, local_hour),
    )
    return result


# ─── Shadow from Mapbox-rendered features (consistent with 3D buildings) ─────

class BuildingFeature(BaseModel):
    footprint: List[List[float]]  # [[lng, lat], ...]
    height: float


class ShadowFromFeaturesRequest(BaseModel):
    buildings: List[BuildingFeature]
    lat: float   # viewport center, for solar position
    lng: float
    local_hour: int


@app.post('/api/shadows/from-features')
async def shadows_from_features(req: ShadowFromFeaturesRequest):
    buildings = [{'footprint': b.footprint, 'height': b.height} for b in req.buildings]
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: compute_shadows_from_features(buildings, req.lat, req.lng, req.local_hour),
    )
    return result


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get('/healthz')
def health():
    return {'status': 'ok'}
