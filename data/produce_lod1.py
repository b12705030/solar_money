import sqlite3
import ijson
import fiona
from pathlib import Path
from typing import Tuple, List, Optional
import argparse

SCHEMA = {
        "geometry": "Polygon",
        "properties":{
            "source": "str",
            "id": "str",
            "region": "str",
            "height": "float",
            "var": "float"
            }
        }

# ============================================================
# 1. JSON → SQLite (streaming, memory safe)
# ============================================================
def build_sqlite_index(json_path: Path, sqlite_path: Path):
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(sqlite_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            height REAL,
            var REAL
        )
    """)

    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=OFF")
    cur.execute("PRAGMA cache_size=-65536")   # 64 MB page cache

    BATCH = 50_000
    batch_rows = []
    count = 0

    with open(json_path, "rb") as f:
        for key, value in ijson.kvitems(f, ""):
            height = value.get("height")
            var    = value.get("var")

            height = float(height) if height is not None else None
            var    = float(var)    if var    is not None else None

            batch_rows.append((key, height, var))
            count += 1

            if len(batch_rows) >= BATCH:
                cur.executemany("INSERT OR REPLACE INTO kv VALUES (?, ?, ?)", batch_rows)
                conn.commit()
                batch_rows.clear()
                print(f"    ... {count:,} keys indexed", end="\r")

    if batch_rows:
        cur.executemany("INSERT OR REPLACE INTO kv VALUES (?, ?, ?)", batch_rows)

    conn.commit()
    conn.close()
    print(f"    ... {count:,} keys indexed (done)")

# ============================================================
# 2. GeoJSON enrichment (streaming)
# ============================================================
def enrich_geojson(
    geojson1: Path,
    geojson2: Path,
    sqlite_path: Path,
    geojson_out: Path,
    bbox_3857: Optional[Tuple[float, float, float, float]] = None,
):
    """
    Merge two GeoJSON sources with height data from SQLite.

    Args:
        geojson1: Path to ODbLPolygon GeoJSON (EPSG:3857)
        geojson2: Path to non-ODbL Polygon GeoJSON (EPSG:3857)
        sqlite_path: SQLite index with height/var keyed by source+id+region
        geojson_out: Output path
        bbox_3857: Optional (min_x, min_y, max_x, max_y) in EPSG:3857 to clip features.
                   Only features whose centroid falls within this bbox are written.
    """
    geojson_out.parent.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------
    # Open SQLite
    # ---------------------------------------------------------
    conn = sqlite3.connect(sqlite_path)
    cur = conn.cursor()

    # ---------------------------------------------------------
    # Read schema from geojson1 (assumed compatible)
    # ---------------------------------------------------------
    meta = {}
    meta["schema"] = SCHEMA
    meta["crs"] = "EPSG:3857"

    # ---------------------------------------------------------
    # Write output
    # ---------------------------------------------------------
    written = 0
    skipped = 0

    with fiona.open(geojson_out, "w", **meta) as dst:

        # ---- helper to enrich & write one feature
        def process_feature(feat):
            nonlocal written, skipped

            # --------------------------------------------------
            # Bbox filter (Taiwan clip) — centroid test in 3857
            # --------------------------------------------------
            if bbox_3857 is not None:
                coords = feat["geometry"]["coordinates"][0]
                if coords:
                    cx = sum(c[0] for c in coords) / len(coords)
                    cy = sum(c[1] for c in coords) / len(coords)
                    bx0, by0, bx1, by1 = bbox_3857
                    if not (bx0 < cx < bx1 and by0 < cy < by1):
                        skipped += 1
                        return

            p = dict(feat["properties"])

            key = (
                str(p.get("source", "")) +
                str(p.get("id", "")) +
                str(p.get("region", ""))
            )

            cur.execute(
                "SELECT height, var FROM kv WHERE key=?",
                (key,)
            )
            row = cur.fetchone()

            if row:
                p["height"], p["var"] = row
            else:
                p["height"] = None
                p["var"] = None

            feat["properties"] = p
            dst.write(feat)
            written += 1

        # ---- stream geojson1
        with fiona.open(geojson1, "r") as src1:
            for feat in src1:
                process_feature(feat)

        # ---- stream geojson2
        with fiona.open(geojson2, "r") as src2:
            for feat in src2:
                process_feature(feat)

    conn.close()
    print(f"  [OK] Written {written} features, skipped {skipped} (outside bbox)")

# ============================================================
# 3. Integrity check (2 GeoJSON + 1 JSON)
# ============================================================
def check_integrity(
    geojson1_root: Path,
    geojson2_root: Path,
    json_root: Path,
) -> List[Tuple[Path, Path, Path]]:
    """
    Returns list of (geojson1_path, geojson2_path, json_path)
    Enforces:
      - identical relative paths
      - identical filenames
      - .geojson ↔ .json
    """

    pairs = []

    for g1 in geojson1_root.rglob("*.geojson"):
        rel = g1.relative_to(geojson1_root)

        g2 = geojson2_root / rel
        j  = json_root / rel.with_suffix(".json")

        if not g2.exists():
            raise FileNotFoundError(f"Missing GeoJSON2: {g2}")

        if not j.exists():
            raise FileNotFoundError(f"Missing JSON: {j}")

        pairs.append((g1, g2, j))

    # Optional: ensure GeoJSON2 doesn't have extra files
    for g2 in geojson2_root.rglob("*.geojson"):
        rel = g2.relative_to(geojson2_root)
        g1 = geojson1_root / rel
        if not g1.exists():
            raise FileNotFoundError(f"Extra GeoJSON2 file: {g2}")

    return pairs

# ============================================================
# 4. Main
# ============================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Merge GBA.ODbLPolygon and GBA.Polygon, produce GBA.LoD1 in GeoJSON."
    )
    parser.add_argument("--odbl_root", type=Path, help="Path to GBA.ODbLPolygon GeoJSON folder.", default=Path("./ODbLPolygon"))
    parser.add_argument("--polygon_root", type=Path, help="Path to GBA.Polygon GeoJSON folder.", default=Path("./Polygon"))
    parser.add_argument("--json_root", type=Path, help="Path to GBA.LoD1 JSON folder", default=Path("./LoD1"))
    parser.add_argument("--output_root", type=Path, help="Path to write GBA.LoD1 GeoJSON files", default=Path("./LoD1_GeoJSON"))
    parser.add_argument("--sqlite_root", type=Path, default=Path("/tmp/json_sqlite_index"),
                        help="Path for temporary SQLite indices")
    parser.add_argument(
        "--bbox", type=str, default=None,
        metavar="MIN_LON,MIN_LAT,MAX_LON,MAX_LAT",
        help=(
            "Optional WGS84 bounding box to clip output (EPSG:4326). "
            "Only features whose centroid falls within this bbox are written. "
            "Example for Taiwan: --bbox 119.8,21.9,122.1,25.4"
        ),
    )

    args = parser.parse_args()

    GEOJSON1_ROOT = args.odbl_root
    GEOJSON2_ROOT = args.polygon_root
    JSON_ROOT     = args.json_root
    OUTPUT_ROOT   = args.output_root
    SQLITE_ROOT   = args.sqlite_root

    # ----------------------------------------------------------
    # Parse and convert bbox to EPSG:3857 (data CRS)
    # ----------------------------------------------------------
    bbox_3857 = None
    if args.bbox:
        try:
            parts = [float(v) for v in args.bbox.split(",")]
            if len(parts) != 4:
                raise ValueError("bbox must have exactly 4 values")
            min_lon, min_lat, max_lon, max_lat = parts
        except ValueError as e:
            parser.error(f"--bbox parse error: {e}")

        from pyproj import Transformer
        tr = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        bx0, by0 = tr.transform(min_lon, min_lat)
        bx1, by1 = tr.transform(max_lon, max_lat)
        bbox_3857 = (bx0, by0, bx1, by1)
        print(f"[BBOX] Bbox filter enabled: WGS84 ({min_lon},{min_lat},{max_lon},{max_lat})")
        print(f"   -> EPSG:3857 ({bx0:.0f},{by0:.0f},{bx1:.0f},{by1:.0f})")

    print("[CHECK] Checking integrity...")
    triples = check_integrity(GEOJSON1_ROOT, GEOJSON2_ROOT, JSON_ROOT)
    print(f"[OK] Found {len(triples)} matching file triples")

    for g1_path, g2_path, json_path in triples:
        rel = g1_path.relative_to(GEOJSON1_ROOT)

        sqlite_path = SQLITE_ROOT / rel.with_suffix(".sqlite")
        output_path = OUTPUT_ROOT / rel

        print(f">> Processing {rel}")
        print(f"  Building SQLite index from {json_path.name} ...")
        build_sqlite_index(json_path, sqlite_path)

        print(f"  Enriching GeoJSON ...")
        enrich_geojson(g1_path, g2_path, sqlite_path, output_path, bbox_3857=bbox_3857)

        sqlite_path.unlink()  # clean up temporary SQLite file

    print("[DONE] All files processed successfully")


