"""
Tests for compute_optimal_tilt (backend/shadow.py)

Feature: 校正太陽能板安裝角度建議（六大目標）

計算邏輯：
  - 搜尋 0–60° 最佳南向仰角（步長 2°，再 ±1° 精修）
  - score(tilt) = Σ monthly_ghi[i] × POA_ratio[i] × weight[i]
  - 六個目標有不同的 weight：annual/summer/winter/peak/match/roi
  - goal_adj 固定回傳全日 POA/GHI 比值（pvlib clearsky，固定 2024 日期，可快取）

pvlib 使用固定日期（2024-{month}-15），所以 compute_optimal_tilt 是確定性函數，
不依賴 date.today()，相同輸入永遠回傳相同結果。
"""

import pytest
from backend.shadow import compute_optimal_tilt

# 台灣北部典型月均 GHI（kWh/m²/day），對應 constants.ts TW_IRRADIANCE['北部']
TAIPEI_GHI = [2.6, 2.8, 3.5, 3.9, 4.2, 4.4, 4.8, 4.6, 4.1, 3.6, 2.9, 2.5]

# 台灣南部典型月均 GHI
KAOHSIUNG_GHI = [3.6, 3.9, 4.5, 4.9, 5.2, 5.1, 5.5, 5.2, 4.9, 4.5, 3.9, 3.4]

LAT_TAIPEI    = 25.0
LON_TAIPEI    = 121.5
LAT_KAOHSIUNG = 22.6
LON_KAOHSIUNG = 120.3


# ─── 回傳結構測試 ──────────────────────────────────────────────────────────────

def test_returns_required_keys():
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    assert 'best_angle' in result
    assert 'goal_adj' in result


def test_goal_adj_has_12_values():
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    assert len(result['goal_adj']) == 12


def test_best_angle_in_valid_range():
    """所有目標的最佳角度必須在 0–60° 之間（搜尋範圍限制）。"""
    for goal in ['annual', 'summer', 'winter', 'peak', 'match', 'roi']:
        result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, goal)
        assert 0 <= result['best_angle'] <= 60, f"goal={goal} gave angle={result['best_angle']}"


def test_goal_adj_values_are_positive():
    """POA/GHI 比值物理上必須 > 0（面板一定能接收到正輻射）。"""
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    assert all(r > 0 for r in result['goal_adj'])


def test_goal_adj_values_are_physically_reasonable():
    """台灣最佳仰角下，POA/GHI 比值應在 [0.7, 1.5] 之間。
    < 0.7 代表面板比水平面少收 30% 以上，物理上不合理；
    > 1.5 代表斜面輻射遠高於水平面，在台灣緯度不應發生。"""
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    for i, r in enumerate(result['goal_adj']):
        assert 0.7 <= r <= 1.5, f"month {i+1}: goal_adj={r} out of range"


# ─── 不同目標的角度關係 ────────────────────────────────────────────────────────

def test_summer_tilt_less_than_winter_tilt():
    """夏天目標（太陽高懸）→ 較低仰角；冬天目標（太陽偏低）→ 較高仰角。
    這是物理必然性：weight 集中在夏月時，低仰角面板的 score 勝出；
    weight 集中在冬月時，高仰角面板的 score 勝出。"""
    summer = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'summer')
    winter = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'winter')
    assert summer['best_angle'] < winter['best_angle'], (
        f"summer={summer['best_angle']}° should be < winter={winter['best_angle']}°"
    )


def test_annual_tilt_between_summer_and_winter():
    """全年目標的仰角應介於夏季和冬季目標之間（均衡分配）。"""
    summer = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'summer')
    annual = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    winter = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'winter')
    assert summer['best_angle'] <= annual['best_angle'] <= winter['best_angle'], (
        f"summer={summer['best_angle']}° annual={annual['best_angle']}° winter={winter['best_angle']}°"
    )


def test_annual_tilt_reasonable_for_taiwan():
    """台灣緯度（25°N）全年最佳仰角應在 15–30° 之間（接近緯度角的業界估算）。"""
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    assert 15 <= result['best_angle'] <= 30, f"annual tilt={result['best_angle']}° unexpected for lat 25°N"


def test_kaohsiung_lower_tilt_than_taipei():
    """南部緯度較低（22.6°N）→ 太陽更高 → 最佳仰角應 ≤ 北部（25°N）。"""
    taipei = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    kaohsiung = compute_optimal_tilt(LAT_KAOHSIUNG, LON_KAOHSIUNG, KAOHSIUNG_GHI, 'annual')
    assert kaohsiung['best_angle'] <= taipei['best_angle'], (
        f"kaohsiung={kaohsiung['best_angle']}° should be ≤ taipei={taipei['best_angle']}°"
    )


# ─── match 目標個人化 ─────────────────────────────────────────────────────────

def test_match_goal_summer_heavy_usage_lowers_tilt():
    """用電量集中在夏季 → match 目標應選較低仰角（類似 summer 目標）。"""
    summer_usage = [100, 100, 150, 200, 300, 400, 500, 500, 400, 200, 100, 100]
    winter_usage = [500, 500, 400, 200, 100, 100, 100, 100, 100, 200, 400, 500]

    match_summer = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'match', summer_usage)
    match_winter = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'match', winter_usage)

    assert match_summer['best_angle'] <= match_winter['best_angle'], (
        f"summer-heavy={match_summer['best_angle']}° should be ≤ winter-heavy={match_winter['best_angle']}°"
    )


def test_match_goal_without_usage_uses_static_fallback():
    """不提供 monthly_use → 使用台電靜態月別曲線作為 weight，不應 crash。"""
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'match')
    assert 0 <= result['best_angle'] <= 60
    assert len(result['goal_adj']) == 12


# ─── roi 目標 ─────────────────────────────────────────────────────────────────

def test_roi_goal_not_maximizing_winter():
    """roi 目標強調夏月電費較高 → 最佳角度應低於冬季目標（不應選最大化冬季的高仰角）。"""
    typical_use = [350.0] * 12
    roi    = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'roi', typical_use)
    winter = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'winter')
    assert roi['best_angle'] < winter['best_angle'], (
        f"roi={roi['best_angle']}° should be < winter={winter['best_angle']}°"
    )


# ─── peak 目標 ────────────────────────────────────────────────────────────────

def test_peak_goal_returns_full_day_goal_adj():
    """peak 目標使用正午 POA 搜尋最佳角度，但回傳的 goal_adj 仍是全日 POA/GHI 比值
    （確保 monthlyKwh = capacity × ghi × goal_adj × days × PR 的物理一致性）。"""
    result = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'peak')
    # 全日比值在 [0.7, 1.5] 之間（若只回傳正午值，夏天會接近 1.0 而冬天可能 > 1.5）
    assert all(0.7 <= r <= 1.5 for r in result['goal_adj'])


# ─── 未知目標 fallback ────────────────────────────────────────────────────────

def test_unknown_goal_falls_back_to_annual():
    """不存在的目標名稱 → 使用 annual 的 weight（_GOAL_WEIGHTS.get(goal, annual)）。"""
    unknown = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'nonexistent')
    annual  = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'annual')
    assert unknown['best_angle'] == annual['best_angle']
    assert unknown['goal_adj'] == annual['goal_adj']


# ─── 確定性（相同輸入應給相同輸出）─────────────────────────────────────────

def test_deterministic_results():
    """同樣的輸入呼叫兩次，結果必須相同（pvlib 使用固定 2024 日期，非 date.today）。"""
    r1 = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'summer')
    r2 = compute_optimal_tilt(LAT_TAIPEI, LON_TAIPEI, TAIPEI_GHI, 'summer')
    assert r1['best_angle'] == r2['best_angle']
    assert r1['goal_adj'] == r2['goal_adj']
