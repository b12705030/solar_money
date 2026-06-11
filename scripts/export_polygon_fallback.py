"""
Export Taiwan-clipped Polygon GeoJSON to compact NDJSON fallback file.

Output: data/taiwan_polygon_fallback.ndjson.gz
  - One JSON object per line
  - All coordinates in EPSG:4326 (lng, lat)
  - Fields: id, footprint [[lng,lat],...], height, min_lon, max_lon, min_lat, max_lat

Usage (run from solar_money/):
  python scripts/export_polygon_fallback.py
  python scripts/export_polygon_fallback.py --tile e120_n25_e125_n20
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

import fiona
import ijson
from pyproj import Transformer

TAIWAN_BBOX_4326 = "119.8,21.9,122.1,25.4"

_TR_3857_TO_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
_TR_4326_TO_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)


def bbox_4326_to_3857(min_lon, min_lat, max_lon, max_lat):
    bx0, by0 = _TR_4326_TO_3857.transform(min_lon, min_lat)
    bx1, by1 = _TR_4326_TO_3857.transform(max_lon, max_lat)
    return bx0, by0, bx1, by1


def ring_to_4326(ring_3857: list) -> list[list[float]]:
    result = []
    for coord in ring_3857:
        lng, lat = _TR_3857_TO_4326.transform(float(coord[0]), float(coord[1]))
        result.append([round(lng, 7), round(lat, 7)])
    return result


def centroid_in_bbox(coords, bx0, by0, bx1, by1) -> bool:
    if not coords:
        return False
    cx = sum(c[0] for c in coords) / len(coords)
    cy = sum(c[1] for c in coords) / len(coords)
    return bx0 < cx < bx1 and by0 < cy < by1


def load_height_dict(json_path: Path) -> dict:
    size_mb = json_path.stat().st_size // 1024 // 1024
    print(f"  Loading height index from {json_path.name} ({size_mb} MB)...", flush=True)
    t0 = time.time()
    d = {}
    with open(json_path, "rb") as f:
        for i, (key, val) in enumerate(ijson.kvitems(f, "")):
            h = val.get("height")
            v = val.get("var")
            d[key] = (
                float(h) if h is not None else None,
                float(v) if v is not None else None,
            )
            if i % 500_000 == 0 and i > 0:
                print(f"    ... {i:,} keys loaded", flush=True)
    print(f"  Height dict: {len(d):,} keys in {time.time()-t0:.1f}s", flush=True)
    return d


def export_polygon_source(
    out_gz,
    geojson_path: Path,
    tile_name: str,
    height_dict: dict,
    bbox_3857: tuple,
) -> int:
    bx0, by0, bx1, by1 = bbox_3857
    total = 0

    with fiona.open(str(geojson_path), "r") as src:
        for i, feat in enumerate(src):
            geom = feat.get("geometry")
            props = feat.get("properties") or {}

            if not geom or geom.get("type") != "Polygon":
                continue
            rings = geom.get("coordinates") or []
            if not rings or len(rings[0]) < 3:
                continue

            outer = rings[0]
            if not centroid_in_bbox(outer, bx0, by0, bx1, by1):
                continue

            raw_key = (
                str(props.get("source") or "") +
                str(props.get("id") or "") +
                str(props.get("region") or "")
            )
            h_entry = height_dict.get(raw_key)
            height = (h_entry[0] if h_entry and h_entry[0] is not None else None) or 10.0

            footprint = ring_to_4326(outer)
            if len(footprint) < 3:
                continue

            lngs = [c[0] for c in footprint]
            lats = [c[1] for c in footprint]

            build_id = (
                f"{tile_name}_polygon_{raw_key}"
                if raw_key.strip()
                else f"{tile_name}_polygon_{i}"
            )

            record = {
                "id":      build_id,
                "footprint": footprint,
                "height":  float(height),
                "min_lon": min(lngs),
                "max_lon": max(lngs),
                "min_lat": min(lats),
                "max_lat": max(lats),
            }
            out_gz.write((json.dumps(record, separators=(",", ":")) + "\n").encode())
            total += 1

            if total % 50_000 == 0:
                print(f"    ... {total:,} features written", end="\r", flush=True)

    return total


def main(args: argparse.Namespace) -> None:
    data_dir     = Path(args.data_dir).resolve()
    polygon_dir  = data_dir / "Polygon"
    lod1_dir     = data_dir / "LoD1"
    out_path     = data_dir / args.output

    # Parse bbox
    min_lon, min_lat, max_lon, max_lat = [float(v) for v in args.bbox.split(",")]
    bbox_3857 = bbox_4326_to_3857(min_lon, min_lat, max_lon, max_lat)
    print(f"[BBOX] Taiwan filter: WGS84 ({min_lon},{min_lat},{max_lon},{max_lat})", flush=True)

    # ── Parse tile bbox from name (e.g. e120_n25_e125_n20 → lon 120-125, lat 20-25)
    def tile_bbox_4326(tile_name: str):
        """Return (min_lon, min_lat, max_lon, max_lat) from tile name, or None if unparseable."""
        import re
        parts = re.findall(r'[ew]\d+|[ns]\d+', tile_name)
        if len(parts) < 4:
            return None
        def deg(token):
            sign = -1 if token[0] in ('w', 's') else 1
            return sign * int(token[1:])
        lons = sorted(deg(p) for p in parts if p[0] in ('e', 'w'))
        lats = sorted(deg(p) for p in parts if p[0] in ('n', 's'))
        if len(lons) < 2 or len(lats) < 2:
            return None
        return lons[0], lats[0], lons[1], lats[1]

    def tile_overlaps_bbox(tile_name, q_min_lon, q_min_lat, q_max_lon, q_max_lat) -> bool:
        tb = tile_bbox_4326(tile_name)
        if tb is None:
            return True  # can't determine → include
        t_min_lon, t_min_lat, t_max_lon, t_max_lat = tb
        return (t_min_lon < q_max_lon and t_max_lon > q_min_lon and
                t_min_lat < q_max_lat and t_max_lat > q_min_lat)

    # Find tiles
    all_tiles = sorted(t.stem for t in polygon_dir.glob("*.geojson"))
    if args.tile:
        all_tiles = [t for t in all_tiles if t == args.tile]
        if not all_tiles:
            print(f"[ERROR] Tile '{args.tile}' not found in {polygon_dir}")
            sys.exit(1)

    # Pre-filter: skip tiles that don't overlap with the Taiwan bbox
    tiles = []
    for t in all_tiles:
        if tile_overlaps_bbox(t, min_lon, min_lat, max_lon, max_lat):
            tiles.append(t)
        else:
            print(f"[SKIP] Tile {t} does not overlap with bbox → skipped", flush=True)
    print(f"[INFO] Tiles to process: {tiles}", flush=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    total_all = 0
    t_start = time.time()

    print(f"[OUT] Writing to {out_path} (gzip)...", flush=True)
    with gzip.open(out_path, "wb", compresslevel=6) as gz:
        for tile in tiles:
            polygon_path = polygon_dir / f"{tile}.geojson"
            json_path    = lod1_dir    / f"{tile}.json"

            for p in (polygon_path, json_path):
                if not p.exists():
                    print(f"[ERROR] Missing: {p}")
                    sys.exit(1)

            print(f"\n[FILE] Tile: {tile}", flush=True)
            height_dict = load_height_dict(json_path)

            n = export_polygon_source(gz, polygon_path, tile, height_dict, bbox_3857)
            print(f"  [OK] {n:,} Taiwan Polygon buildings written", flush=True)

            del height_dict
            total_all += n

    elapsed = time.time() - t_start
    size_mb = out_path.stat().st_size // 1024 // 1024
    print(f"\n[DONE] {total_all:,} buildings in {elapsed:.1f}s")
    print(f"[OUT] {out_path} ({size_mb} MB compressed)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Export Taiwan Polygon buildings to NDJSON.gz fallback file"
    )
    parser.add_argument("--data-dir", default="./data",               help="data/ folder path")
    parser.add_argument("--bbox",     default=TAIWAN_BBOX_4326,       help="WGS84 clip bbox")
    parser.add_argument("--output",   default="taiwan_polygon_fallback.ndjson.gz",
                                                                       help="Output filename in data/")
    parser.add_argument("--tile",     default=None,                    help="Process only this tile")
    main(parser.parse_args())
