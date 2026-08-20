"""
Test 14 — Dashboard
Covers: GET /dashboard/summary, GET /dashboard/branch-comparison
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_dashboard_summary(admin_token):
    """GET /dashboard/summary returns all KPI fields."""
    r = requests.get(f"{BASE}/dashboard/summary",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    required = [
        "today_sales_count", "today_revenue", "today_vat",
        "revenue_trend", "sparkline_30d",
        "low_stock_count", "out_of_stock_count",
        "expiring_90_count", "expiring_30_count",
        "expired_count", "total_medicines"
    ]
    for key in required:
        assert key in data, f"Missing key: {key}"


def test_dashboard_summary_branch_scoped(admin_token):
    """GET /dashboard/summary?branch_id=br-001 returns branch-scoped KPIs."""
    r = requests.get(f"{BASE}/dashboard/summary?branch_id=br-001",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "today_revenue" in data


def test_branch_comparison(admin_token):
    """GET /dashboard/branch-comparison returns all active branches."""
    r = requests.get(f"{BASE}/dashboard/branch-comparison",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "branches" in data
    assert len(data["branches"]) >= 2
    total_share = sum(b["share_pct"] for b in data["branches"])
    # Share percentages should sum to ~100
    assert abs(total_share - 100.0) < 1.0 or total_share == 0


def test_dashboard_accessible_to_pharmacist(pharm_token):
    """Pharmacist can also access dashboard summary."""
    r = requests.get(f"{BASE}/dashboard/summary",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200


def test_sparkline_is_list(admin_token):
    """sparkline_30d is a list of floats."""
    r = requests.get(f"{BASE}/dashboard/summary",
                     headers={"Authorization": f"Bearer {admin_token}"})
    sparkline = r.json()["sparkline_30d"]
    assert isinstance(sparkline, list)
    for val in sparkline:
        assert isinstance(val, (int, float))
