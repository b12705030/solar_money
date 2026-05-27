"""
GBA Taiwan buildings direct import to Neon (no intermediate files).

Pipeline (per tile, in-memory):
  1. Stream height JSON -> Python dict  (ijson, no temp files)
  2. Stream ODbLPolygon + Polygon GeoJSON -> bbox filter -> height lookup -> INSERT Neon
  3. CRS conversion: EPSG:3857 -> EPSG:4326

Usage:
  cd solar_money
  python scripts/import_gba_to_db.py

Options:
  --data-dir    path to data/ folder (default: ./data)
  --bbox        WGS84 clip bbox (default: Taiwan 119.8,21.9,122.1,25.4)
  --batch-size  INSERT batch size (default: 500)
  --dry-run     parse only, no DB write
  --tile        process only this tile name (e.g. e120_n25_e125_n20)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import asyncpg
import fiona
import ijson
from pyproj import Transformer

# ─── Taiwan default bbox ──────────────────────────────────────────────────────
TAIWAN_BBOX_4326 = "119.8,21.9,122.1,25.4"

# CRS transformer (shared)
_TR_3857_TO_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
_TR_4326_TO_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)


# ─── Helpers ─────────────────────────────────────────────────────────────────

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


# ─── Load height dict (streaming, no temp files) ─────────────────────────────

def load_height_dict(json_path: Path) -> dict:
    """
    Stream height JSON into memory dict.
    Format: { "source+id+region": {"height": float, "var": float}, ... }
    Returns dict of key -> (height, var).
    """
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


# ─── Stream GeoJSON -> DB ─────────────────────────────────────────────────────

async def import_geojson_source(
    conn: asyncpg.Connection,
    geojson_path: Path,
    tile_name: str,
    source_tag: str,
    height_dict: dict,
    bbox_3857: tuple,
    batch_size: int,
    dry_run: bool,
) -> int:
    bx0, by0, bx1, by1 = bbox_3857
    batch = []
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
            # Taiwan bbox filter (centroid test in EPSG:3857)
            if not centroid_in_bbox(outer, bx0, by0, bx1, by1):
                continue

            # Look up height from in-memory dict
            raw_key = (
                str(props.get("source") or "") +
                str(props.get("id") or "") +
                str(props.get("region") or "")
            )
            h_entry = height_dict.get(raw_key)
            height = (h_entry[0] if h_entry and h_entry[0] is not None else None) or 10.0

            # CRS: EPSG:3857 -> EPSG:4326
            footprint = ring_to_4326(outer)
            if len(footprint) < 3:
                continue

            lngs = [c[0] for c in footprint]
            lats = [c[1] for c in footprint]

            build_id = (
                f"{tile_name}_{source_tag}_{raw_key}"
                if raw_key.strip()
                else f"{tile_name}_{source_tag}_{i}"
            )

            batch.append((
                build_id,
                json.dumps(footprint),
                float(height),
                source_tag,
                min(lngs), max(lngs),
                min(lats), max(lats),
            ))

            if len(batch) >= batch_size:
                if not dry_run:
                    await conn.executemany(
                        """INSERT INTO gba_buildings
                               (id, footprint, height, source,
                                min_lon, max_lon, min_lat, max_lat)
                           VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8)
                           ON CONFLICT (id) DO NOTHING""",
                        batch,
                    )
                total += len(batch)
                batch.clear()
                print(f"    ... {total:,} features processed", end="\r", flush=True)

    if batch:
        if not dry_run:
            await conn.executemany(
                """INSERT INTO gba_buildings
                       (id, footprint, height, source,
                        min_lon, max_lon, min_lat, max_lat)
                   VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8)
                   ON CONFLICT (id) DO NOTHING""",
                batch,
            )
        total += len(batch)

    return total


# ─── Ensure table ─────────────────────────────────────────────────────────────

async def ensure_table(conn: asyncpg.Connection) -> None:
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS gba_buildings (
            id        TEXT   PRIMARY KEY,
            footprint JSONB  NOT NULL,
            height    REAL,
            source    TEXT,
            min_lon   REAL,
            max_lon   REAL,
            min_lat   REAL,
            max_lat   REAL
        )
    """)
    await conn.execute("""
        CREATE INDEX IF NOT EXISTS gba_buildings_bbox
            ON gba_buildings (min_lon, max_lon, min_lat, max_lat)
    """)
    print("[OK] Table gba_buildings ready", flush=True)


# ─── Main ─────────────────────────────────────────────────────────────────────

async def main(args: argparse.Namespace) -> None:
    data_dir = Path(args.data_dir).resolve()
    odbl_dir    = data_dir / "ODbLPolygon"
    polygon_dir = data_dir / "Polygon"
    lod1_dir    = data_dir / "LoD1"

    # Parse bbox
    min_lon, min_lat, max_lon, max_lat = [float(v) for v in args.bbox.split(",")]
    bbox_3857 = bbox_4326_to_3857(min_lon, min_lat, max_lon, max_lat)
    print(f"[BBOX] Taiwan filter: WGS84 ({min_lon},{min_lat},{max_lon},{max_lat})", flush=True)

    # Find tiles
    tiles = sorted(t.stem for t in odbl_dir.glob("*.geojson"))
    if args.tile:
        tiles = [t for t in tiles if t == args.tile]
        if not tiles:
            print(f"[ERROR] Tile '{args.tile}' not found in {odbl_dir}")
            sys.exit(1)
    print(f"[INFO] Tiles to process: {tiles}", flush=True)

    if args.dry_run:
        print("\n[INFO] DRY RUN - no DB writes\n", flush=True)

    # Connect DB
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "backend" / ".env")
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[ERROR] DATABASE_URL not set in backend/.env")
        sys.exit(1)

    print("[DB] Connecting...", flush=True)
    conn = await asyncpg.connect(db_url)
    try:
        if not args.dry_run:
            await ensure_table(conn)

        total_all = 0
        t_start = time.time()

        for tile in tiles:
            odbl_path    = odbl_dir    / f"{tile}.geojson"
            polygon_path = polygon_dir / f"{tile}.geojson"
            json_path    = lod1_dir    / f"{tile}.json"

            # Only check files that are actually needed for the chosen source
            required = [json_path]
            if args.source in ("odbl", "both"):
                required.append(odbl_path)
            if args.source in ("polygon", "both"):
                required.append(polygon_path)
            for p in required:
                if not p.exists():
                    print(f"[ERROR] Missing: {p}")
                    sys.exit(1)

            print(f"\n[FILE] Processing tile: {tile}", flush=True)

            # Load height dict once per tile (in-memory, no temp files)
            height_dict = load_height_dict(json_path)

            # Import ODbL source
            n1 = 0
            if args.source in ("odbl", "both"):
                print(f"  >> ODbL source ({odbl_path.name})...", flush=True)
                n1 = await import_geojson_source(
                    conn, odbl_path, tile, "odbl",
                    height_dict, bbox_3857, args.batch_size, args.dry_run,
                )
                print(f"  [OK] ODbL: {n1:,} Taiwan buildings imported", flush=True)

            # Import non-ODbL polygon source
            n2 = 0
            if args.source in ("polygon", "both"):
                print(f"  >> Polygon source ({polygon_path.name})...", flush=True)
                n2 = await import_geojson_source(
                    conn, polygon_path, tile, "polygon",
                    height_dict, bbox_3857, args.batch_size, args.dry_run,
                )
                print(f"  [OK] Polygon: {n2:,} Taiwan buildings imported", flush=True)

            del height_dict  # free memory before next tile
            total_all += n1 + n2

        elapsed = time.time() - t_start
        print(f"\n[DONE] Total: {total_all:,} buildings in {elapsed:.1f}s")

        if not args.dry_run:
            row = await conn.fetchrow("SELECT COUNT(*) AS cnt FROM gba_buildings")
            print(f"[DB] gba_buildings total: {row['cnt']:,} rows")

    finally:
        await conn.close()


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Import GBA Taiwan buildings to Neon (no intermediate files)"
    )
    parser.add_argument("--data-dir",   default="./data",          help="data/ folder path")
    parser.add_argument("--bbox",       default=TAIWAN_BBOX_4326,  help="WGS84 clip bbox")
    parser.add_argument("--batch-size", type=int, default=500,     help="INSERT batch size")
    parser.add_argument("--tile",       default=None,              help="Process only this tile")
    parser.add_argument("--source",     default="odbl",            choices=["odbl", "polygon", "both"],
                                                                   help="Which source(s) to import (default: odbl)")
    parser.add_argument("--dry-run",    action="store_true",       help="Parse only, no DB write")
    asyncio.run(main(parser.parse_args()))
