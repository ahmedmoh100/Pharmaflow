"""
Test 13 — Reports (Admin only)
Covers: GET /reports/sales, GET /reports/sales/by-pharmacist,
        GET /reports/inventory, GET /reports/purchases, GET /reports/vat
"""

import requests
import pytest
from datetime import date, timedelta

BASE = "http://localhost:8000"

TODAY = date.today().isoformat()
LAST_MONTH = (date.today() - timedelta(days=30)).isoformat()


def test_sales_report(admin_token):
    """GET /reports/sales returns revenue totals and top selling."""
    r = requests.get(f"{BASE}/reports/sales?from_date={LAST_MONTH}&to_date={TODAY}",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    for key in ("total_revenue", "total_vat", "total_count", "by_day",
                "by_payment", "top_selling"):
        assert key in data, f"Missing key: {key}"
    for item in data["top_selling"]:
        assert "gross_profit" in item
        assert "margin_pct" in item


def test_sales_report_branch_filter(admin_token):
    """GET /reports/sales?branch_id=br-001 returns br-001 data only."""
    r1 = requests.get(f"{BASE}/reports/sales?from_date={LAST_MONTH}&to_date={TODAY}&branch_id=br-001",
                      headers={"Authorization": f"Bearer {admin_token}"})
    r2 = requests.get(f"{BASE}/reports/sales?from_date={LAST_MONTH}&to_date={TODAY}&branch_id=br-002",
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Chain-wide total should be >= either branch
    r_chain = requests.get(f"{BASE}/reports/sales?from_date={LAST_MONTH}&to_date={TODAY}",
                           headers={"Authorization": f"Bearer {admin_token}"})
    chain_total = float(r_chain.json()["total_revenue"])
    br001_total = float(r1.json()["total_revenue"])
    br002_total = float(r2.json()["total_revenue"])
    assert chain_total >= br001_total
    assert chain_total >= br002_total


def test_sales_report_blocked_for_pharmacist(pharm_token):
    """Pharmacist cannot access admin reports."""
    r = requests.get(f"{BASE}/reports/sales",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code in (401, 403)


def test_sales_by_pharmacist_report(admin_token):
    """GET /reports/sales/by-pharmacist returns pharmacist performance rows."""
    r = requests.get(f"{BASE}/reports/sales/by-pharmacist?from_date={LAST_MONTH}&to_date={TODAY}",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    for row in data["rows"]:
        assert "full_name" in row
        assert "tx_count" in row
        assert "revenue" in row
        assert "avg_tx" in row


def test_sales_by_pharmacist_branch_filter(admin_token):
    """GET /reports/sales/by-pharmacist?branch_id filters correctly."""
    r = requests.get(
        f"{BASE}/reports/sales/by-pharmacist?from_date={LAST_MONTH}&to_date={TODAY}&branch_id=br-001",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert r.status_code == 200
    for row in r.json()["rows"]:
        assert row["branch_name_en"] is not None


def test_inventory_report(admin_token):
    """GET /reports/inventory returns stock summary by category."""
    r = requests.get(f"{BASE}/reports/inventory",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    for key in ("total_medicines", "inventory_value", "low_stock_count",
                "by_category", "low_stock_list"):
        assert key in data, f"Missing key: {key}"
    assert data["total_medicines"] > 0
    # inventory_value should be a valid decimal string
    assert float(data["inventory_value"]) >= 0


def test_inventory_report_branch_filter(admin_token):
    """GET /reports/inventory?branch_id returns branch-specific value."""
    r1 = requests.get(f"{BASE}/reports/inventory?branch_id=br-001",
                      headers={"Authorization": f"Bearer {admin_token}"})
    r_chain = requests.get(f"{BASE}/reports/inventory",
                           headers={"Authorization": f"Bearer {admin_token}"})
    assert r1.status_code == 200
    # Branch value should be less than or equal to chain total
    br_val = float(r1.json()["inventory_value"])
    chain_val = float(r_chain.json()["inventory_value"])
    assert chain_val >= br_val


def test_purchases_report(admin_token):
    """GET /reports/purchases returns spend by supplier and medicine."""
    r = requests.get(f"{BASE}/reports/purchases?from_date={LAST_MONTH}&to_date={TODAY}",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    for key in ("total_spend", "by_supplier", "by_medicine"):
        assert key in data
    assert float(data["total_spend"]) >= 0


def test_vat_report(admin_token):
    """GET /reports/vat returns monthly VAT breakdown."""
    r = requests.get(f"{BASE}/reports/vat?from_date={LAST_MONTH}&to_date={TODAY}",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    for row in data["rows"]:
        for key in ("month", "vat_collected", "taxable_0", "taxable_15"):
            assert key in row
        # VAT collected should equal 15% of taxable_15 amount (approximately)
        taxable_15 = float(row["taxable_15"])
        vat = float(row["vat_collected"])
        if taxable_15 > 0:
            assert abs(vat / taxable_15 - 0.15) < 0.01, \
                f"VAT rate mismatch: taxable={taxable_15}, vat={vat}"


def test_vat_report_branch_filter(admin_token):
    """GET /reports/vat?branch_id filters to branch sales."""
    r = requests.get(
        f"{BASE}/reports/vat?from_date={LAST_MONTH}&to_date={TODAY}&branch_id=br-001",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert r.status_code == 200
    assert "rows" in r.json()
