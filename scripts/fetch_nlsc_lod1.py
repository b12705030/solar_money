"""
NLSC I3S v1.8 建物資料擷取模組。

供 shadow.py 直接 import，也可獨立執行做測試：
    python scripts/fetch_nlsc_lod1.py 25.05 121.52

NLSC I3S 服務：https://i3s.nlsc.gov.tw/building/i3s/SceneServer
  層 0–21 對應 22 縣市（0=台北市, 1=新北市, ..., 依 COUNTY_LAYERS 映射）
"""

from __future__ import annotations

import asyncio
import gzip
import struct
import sys
from typing import Any

import httpx
import numpy as np
from shapely.geometry import MultiPoint

# 縣市名稱 → I3S layer index（0-based）
COUNTY_LAYERS: dict[str, int] = {
    '台北市':  0, '臺北市':  0,
    '新北市':  1,
    '桃園市':  2,
    '台中市':  3, '臺中市':  3,
    '台南市':  4, '臺南市':  4,
    '高雄市':  5,
    '基隆市':  6,
    '新竹市':  7,
    '嘉義市':  8,
    '新竹縣':  9,
    '苗栗縣': 10,
    '彰化縣': 11,
    '南投縣': 12,
    '雲林縣': 13,
    '嘉義縣': 14,
    '屏東縣': 15,
    '宜蘭縣': 16,
    '花蓮縣': 17,
    '台東縣': 18, '臺東縣': 18,
    '澎湖縣': 19,
    '金門縣': 20,
    '連江縣': 21,
}

_BASE = 'https://i3s.nlsc.gov.tw/building/i3s/SceneServer'
_TIMEOUT = 30.0
_PAGE_SIZE = 64  # I3S v1.8 每頁 node 數（固定）


def _county_from_township(township_code: str) -> str | None:
    """根據 TOWNCODE 前幾碼推斷縣市名（簡易對照，供 shadow.py 呼叫端使用）。"""
    prefix_map = {
        '63': '台北市', '65': '新北市', '68': '桃園市',
        '66': '台中市', '67': '台南市', '64': '高雄市',
        '10017': '基隆市', '10018': '新竹市', '10020': '嘉義市',
        '10004': '新竹縣', '10005': '苗栗縣', '10007': '彰化縣',
        '10008': '南投縣', '10009': '雲林縣', '10010': '嘉義縣',
        '10013': '屏東縣', '10002': '宜蘭縣', '10015': '花蓮縣',
        '10014': '台東縣', '10016': '澎湖縣', '09007': '金門縣',
        '09020': '連江縣',
    }
    for prefix, county in prefix_map.items():
        if township_code.startswith(prefix):
            return county
    return None


async def _get(client: httpx.AsyncClient, url: str) -> Any:
    r = await client.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


async def _get_bytes(client: httpx.AsyncClient, url: str) -> bytes:
    r = await client.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.content


def _decode_geometry(data: bytes) -> list[dict]:
    """
    解碼 I3S v1.8 binary geometry（可能 gzip 壓縮）。
    回傳每棟建物的 footprint (2D polygon coords) 和 heights。
    """
    # 嘗試 gzip 解壓
    try:
        data = gzip.decompress(data)
    except Exception:
        pass  # 未壓縮，直接使用

    if len(data) < 8:
        return []

    offset = 0
    vertex_count = struct.unpack_from('<I', data, offset)[0]; offset += 4
    feature_count = struct.unpack_from('<I', data, offset)[0]; offset += 4

    if vertex_count == 0 or feature_count == 0:
        return []

    # positions: Float32[vertexCount × 3] → (x/lng, y/lat, z/alt)
    pos_bytes = 12 * vertex_count
    if offset + pos_bytes > len(data):
        return []
    positions = np.frombuffer(data, dtype=np.float32,
                              count=vertex_count * 3, offset=offset).reshape(vertex_count, 3)
    offset += pos_bytes

    # 跳過 normals (12B/vert), uv0 (8B/vert), color (4B/vert), uvRegion (8B/vert)
    skip_per_vert = 12 + 8 + 4 + 8
    offset += skip_per_vert * vertex_count

    # featureIds: UInt64[featureCount]
    feat_id_bytes = 8 * feature_count
    if offset + feat_id_bytes > len(data):
        return []
    offset += feat_id_bytes  # 不需要使用 featureId 值

    # faceRange: UInt32[featureCount × 2] → (firstFaceIndex, faceCount)
    face_range_bytes = 8 * feature_count
    if offset + face_range_bytes > len(data):
        return []
    face_range = np.frombuffer(data, dtype=np.uint32,
                               count=feature_count * 2, offset=offset).reshape(feature_count, 2)

    buildings = []
    for i in range(feature_count):
        first_face = int(face_range[i, 0])
        face_count  = int(face_range[i, 1])
        # 每個三角面佔 3 個頂點
        v_start = first_face * 3
        v_end   = v_start + face_count * 3
        if v_end > vertex_count:
            continue

        verts = positions[v_start:v_end]  # shape (N, 3): [lng, lat, alt]
        if len(verts) < 3:
            continue

        # 取地板頂點（z ≈ min_z，±0.5m 容忍）
        min_z = float(verts[:, 2].min())
        floor_mask = verts[:, 2] <= min_z + 0.5
        floor_verts = verts[floor_mask]

        if len(floor_verts) < 3:
            floor_verts = verts  # fallback：用所有頂點

        # 2D convex hull → footprint polygon
        try:
            hull = MultiPoint(floor_verts[:, :2].tolist()).convex_hull
            if hull.geom_type == 'Polygon':
                footprint = list(hull.exterior.coords)
            elif hull.geom_type == 'LineString':
                footprint = list(hull.coords)
            else:
                footprint = floor_verts[:, :2].tolist()
        except Exception:
            footprint = floor_verts[:, :2].tolist()

        max_z = float(verts[:, 2].max())
        buildings.append({
            'footprint': [[round(p[0], 7), round(p[1], 7)] for p in footprint],
            'height': round(max_z - min_z, 2),
            'build_id': f'nlsc_{i}',
        })

    return buildings


def _decode_build_h(data: bytes) -> list[float]:
    """
    解碼 I3S attribute binary（f_9 = BUILD_H，String 型別）。
    格式：[uint32 count][uint32 totalBytes][uint32 byteLen + UTF-8 string] × count
    """
    try:
        data = gzip.decompress(data)
    except Exception:
        pass

    if len(data) < 8:
        return []

    count = struct.unpack_from('<I', data, 0)[0]
    offset = 8  # skip count + totalBytes

    heights: list[float] = []
    for _ in range(count):
        if offset + 4 > len(data):
            break
        byte_len = struct.unpack_from('<I', data, offset)[0]; offset += 4
        raw = data[offset: offset + byte_len]; offset += byte_len
        try:
            h = float(raw.decode('utf-8').strip())
            heights.append(h)
        except (ValueError, UnicodeDecodeError):
            heights.append(0.0)

    return heights


async def _collect_leaf_nodes(
    client: httpx.AsyncClient,
    layer: int,
    min_lng: float, min_lat: float,
    max_lng: float, max_lat: float,
) -> list[str]:
    """
    遍歷 nodepages，收集與 bbox 相交的 leaf node ID。
    leaf node 定義：nodepages 中 childCount == 0（或無 children）。
    """
    leaf_ids: list[str] = []
    page = 0
    while True:
        url = f'{_BASE}/layers/{layer}/nodepages/{page}'
        try:
            resp = await _get(client, url)
        except httpx.HTTPStatusError:
            break  # 無更多頁

        nodes = resp.get('nodes', [])
        if not nodes:
            break

        for node in nodes:
            child_count = node.get('childCount', 0)
            if child_count != 0:
                continue  # 非 leaf，略過

            # 以 OBB center + halfSize 做 AABB 快速篩選
            obb = node.get('obb', {})
            cx, cy = obb.get('center', [None, None])[:2]
            if cx is None or cy is None:
                # 無空間資訊，保守納入
                leaf_ids.append(str(node.get('index', page * _PAGE_SIZE + len(leaf_ids))))
                continue

            hx = obb.get('halfSize', [1, 1, 1])[0]
            hy = obb.get('halfSize', [1, 1, 1])[1]
            node_min_lng = cx - hx
            node_max_lng = cx + hx
            node_min_lat = cy - hy
            node_max_lat = cy + hy

            # AABB 交叉測試
            if (node_max_lng < min_lng or node_min_lng > max_lng or
                    node_max_lat < min_lat or node_min_lat > max_lat):
                continue

            leaf_ids.append(str(node.get('index')))

        if len(nodes) < _PAGE_SIZE:
            break  # 最後一頁
        page += 1

    return leaf_ids


async def fetch_nlsc_buildings(
    county_name: str,
    min_lng: float, min_lat: float,
    max_lng: float, max_lat: float,
) -> list[dict]:
    """
    從 NLSC I3S 取得 bbox 範圍內的建物。
    回傳格式與 OSM shadow.py 相容：
      [{"footprint": [[lng, lat], ...], "height": float, "build_id": str}, ...]

    若 county_name 對應不到 layer，回傳空 list（呼叫端應 fallback 到 OSM）。
    """
    layer = COUNTY_LAYERS.get(county_name)
    if layer is None:
        return []

    async with httpx.AsyncClient() as client:
        # 1. 取得 leaf node IDs（在 bbox 內）
        leaf_ids = await _collect_leaf_nodes(
            client, layer, min_lng, min_lat, max_lng, max_lat
        )
        if not leaf_ids:
            return []

        buildings: list[dict] = []

        for node_id in leaf_ids:
            base_node = f'{_BASE}/layers/{layer}/nodes/{node_id}'

            # 2. 取 geometry binary → footprint
            try:
                geom_data = await _get_bytes(client, f'{base_node}/geometries/0')
                node_buildings = _decode_geometry(geom_data)
            except Exception:
                continue

            if not node_buildings:
                continue

            # 3. 取 BUILD_H attribute binary → 正式建物高度
            try:
                attr_data = await _get_bytes(client, f'{base_node}/attributes/f_9/0')
                heights = _decode_build_h(attr_data)
                for j, h in enumerate(heights):
                    if j < len(node_buildings) and h > 0:
                        node_buildings[j]['height'] = h
                        node_buildings[j]['build_id'] = f'nlsc_{node_id}_{j}'
            except Exception:
                pass  # 高度使用 geometry 推算的值

            # 4. 過濾 bbox 外的建物（centroid 判斷）
            for b in node_buildings:
                fp = b.get('footprint', [])
                if not fp:
                    continue
                cx = sum(p[0] for p in fp) / len(fp)
                cy = sum(p[1] for p in fp) / len(fp)
                if min_lng <= cx <= max_lng and min_lat <= cy <= max_lat:
                    buildings.append(b)

    return buildings


# ── 獨立測試執行 ──────────────────────────────────────────────────────────────

async def _test(lat: float, lng: float) -> None:
    delta = 0.005  # ~500m 半徑
    print(f'查詢 ({lat}, {lng}) ±{delta}°...')
    # 推斷縣市（簡化：台北測試）
    county = '台北市'
    buildings = await fetch_nlsc_buildings(
        county,
        lng - delta, lat - delta,
        lng + delta, lat + delta,
    )
    print(f'取得 {len(buildings)} 棟建物')
    for b in buildings[:3]:
        print(f'  height={b["height"]}m  footprint_pts={len(b["footprint"])}  id={b["build_id"]}')


if __name__ == '__main__':
    _lat = float(sys.argv[1]) if len(sys.argv) > 1 else 25.05
    _lng = float(sys.argv[2]) if len(sys.argv) > 2 else 121.52
    asyncio.run(_test(_lat, _lng))
