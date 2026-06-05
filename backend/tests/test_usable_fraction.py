"""
Tests for compute_usable_roof_fraction (backend/shadow.py)

Feature: 計算每座屋頂可用面積（扣掉被陰影遮住的部分）

計算邏輯：
  1. 對 footprint 向內縮 1m（parapet setback）
  2. 對 5 個時段（8, 10, 12, 14, 16 時）模擬鄰棟陰影
  3. 計算每小時未被遮蔽面積的比例，取平均後 clamp 到 [0.1, 0.95]
  4. DEM 地形修正：鄰棟有效高度 = 建物高度 + (鄰棟地形高度 - 目標地形高度)
     DEM 未載入時 get_elevation 回傳 0.0，地形修正為 0（平地假設）
"""

import pytest
from backend.shadow import compute_usable_roof_fraction


# ─── 共用 fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def taipei_footprint():
    """20m × 20m 的正方形 footprint，座標在台北市中心附近（25°N, 121.5°E）。
    使用 WGS84 [lng, lat] 格式，0.00009° ≈ 10m。"""
    d = 0.00009
    cx, cy = 121.5, 25.0
    return [
        [cx - d, cy - d],
        [cx + d, cy - d],
        [cx + d, cy + d],
        [cx - d, cy + d],
        [cx - d, cy - d],
    ]


def make_building(cx_lng, cy_lat, half_deg=0.00005, height=15.0):
    """建立一棟鄰棟建物的 dict，格式符合 compute_usable_roof_fraction 的 buildings 參數。"""
    d = half_deg
    return {
        'footprint': [
            [cx_lng - d, cy_lat - d],
            [cx_lng + d, cy_lat - d],
            [cx_lng + d, cy_lat + d],
            [cx_lng - d, cy_lat + d],
            [cx_lng - d, cy_lat - d],
        ],
        'height': height,
    }


# ─── 回傳結構測試 ──────────────────────────────────────────────────────────────

def test_returns_required_keys(taipei_footprint):
    """回傳值必須包含 usable_fraction 與 setback_area_m2。"""
    result = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    assert 'usable_fraction' in result
    assert 'setback_area_m2' in result


def test_fraction_clamped_to_valid_range(taipei_footprint):
    """usable_fraction 必須在 [0.1, 0.95] 之間（代碼 clamp 邏輯）。"""
    result = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    assert 0.1 <= result['usable_fraction'] <= 0.95


def test_setback_area_is_positive(taipei_footprint):
    """setback 後的面積必須 > 0。"""
    result = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    assert result['setback_area_m2'] > 0


# ─── 無鄰棟：可用比例應為上限 ─────────────────────────────────────────────────

def test_isolated_building_reaches_max_fraction(taipei_footprint):
    """沒有鄰棟時，每個有效時段 shaded_area=0 → fraction=1.0 → clamp 到 0.95。
    這個結果和日期無關，因為沒有陰影可以計算。"""
    result = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    assert result['usable_fraction'] == pytest.approx(0.95)


def test_setback_reduces_area_vs_full_footprint(taipei_footprint):
    """向內縮 1m 後，可用面積必須小於原始 footprint 面積。"""
    from shapely.geometry import Polygon
    from pyproj import Transformer
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    full_poly = Polygon([to_3857.transform(p[0], p[1]) for p in taipei_footprint])

    result = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    assert result['setback_area_m2'] < full_poly.area


# ─── 有鄰棟：陰影遮蔽降低可用比例 ────────────────────────────────────────────

def test_tall_surrounding_buildings_reduce_fraction(taipei_footprint):
    """四面都有 40m 高的建物（30m 外）→ 至少某個時段會被遮蔭 → 比例低於無鄰棟。"""
    cx, cy = 121.5, 25.0
    offset = 0.00027  # ~30m

    neighbors = [
        make_building(cx + offset, cy, height=40.0),  # 東
        make_building(cx - offset, cy, height=40.0),  # 西
        make_building(cx, cy + offset, height=40.0),  # 北
        make_building(cx, cy - offset, height=40.0),  # 南
    ]

    isolated = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    surrounded = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=neighbors, lat=25.0, lng=121.5
    )
    assert surrounded['usable_fraction'] < isolated['usable_fraction']


def test_taller_neighbor_casts_more_shadow(taipei_footprint):
    """同位置、更高的建物應產生更多遮蔭，使可用比例更低。"""
    cx, cy = 121.5, 25.0
    offset = 0.00018  # ~20m，緊鄰目標建物南方（台灣太陽偏南方）

    low_neighbor = [make_building(cx, cy - offset, height=8.0)]
    high_neighbor = [make_building(cx, cy - offset, height=35.0)]

    result_low = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=low_neighbor, lat=25.0, lng=121.5
    )
    result_high = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=high_neighbor, lat=25.0, lng=121.5
    )
    assert result_high['usable_fraction'] <= result_low['usable_fraction']


def test_distant_neighbor_has_less_impact_than_close(taipei_footprint):
    """距離越遠的建物，陰影投影越短，對可用面積影響越小。"""
    cx, cy = 121.5, 25.0

    close_neighbor = [make_building(cx, cy - 0.00018, height=20.0)]   # ~20m 外
    far_neighbor   = [make_building(cx, cy - 0.00090, height=20.0)]   # ~100m 外

    result_close = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=close_neighbor, lat=25.0, lng=121.5
    )
    result_far = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=far_neighbor, lat=25.0, lng=121.5
    )
    assert result_far['usable_fraction'] >= result_close['usable_fraction']


# ─── 邊界條件 ─────────────────────────────────────────────────────────────────

def test_tiny_building_fallback_to_full_polygon():
    """建物太小（setback 後面積 < 1m²）→ fallback 使用原始 polygon，不應 crash。"""
    d = 0.000005  # ~0.5m，setback 1m 後會變成空的
    tiny_fp = [
        [121.5 - d, 25.0 - d],
        [121.5 + d, 25.0 - d],
        [121.5 + d, 25.0 + d],
        [121.5 - d, 25.0 + d],
        [121.5 - d, 25.0 - d],
    ]
    result = compute_usable_roof_fraction(
        target_footprint=tiny_fp, buildings=[], lat=25.0, lng=121.5
    )
    assert 0.1 <= result['usable_fraction'] <= 0.95
    assert result['setback_area_m2'] > 0


def test_neighbor_overlapping_target_is_excluded(taipei_footprint):
    """與目標建物重疊 > 50% 的鄰棟（等同目標建物本身）應被排除，不影響結果。"""
    # 幾乎相同的 footprint（重疊 > 50%）
    d = 0.00009
    cx, cy = 121.5, 25.0
    same_building = [{
        'footprint': [
            [cx - d, cy - d], [cx + d, cy - d],
            [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d],
        ],
        'height': 30.0,
    }]

    result_with_self = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=same_building, lat=25.0, lng=121.5
    )
    result_isolated = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=25.0, lng=121.5
    )
    # 排除後結果應與無鄰棟相同
    assert result_with_self['usable_fraction'] == result_isolated['usable_fraction']


def test_southern_taiwan_coordinates(taipei_footprint):
    """高雄座標（22.6°N，120.3°E）也應正常運行，不因太陽位置不同而 crash。"""
    result = compute_usable_roof_fraction(
        target_footprint=taipei_footprint, buildings=[], lat=22.6, lng=120.3
    )
    assert 0.1 <= result['usable_fraction'] <= 0.95
