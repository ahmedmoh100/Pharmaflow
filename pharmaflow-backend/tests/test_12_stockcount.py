"""
Test 12 — Stock Count
Covers: GET /stockcount, POST /stockcount/submit
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_get_count_sheet(pharm_token):
    """GET /stockcount returns all active medicines for branch."""
    r = requests.get(f"{BASE}/stockcount",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert data["branch_id"] == "br-001"
    assert len(data["items"]) > 0
    # Each item has branch_quantity and counted_quantity (null)
    for item in data["items"]:
        assert "branch_quantity" in item
        assert item["counted_quantity"] is None


def test_submit_stock_count_no_variance(pharm_token):
    """Submit count with exact current quantity — 0 adjustments made."""
    r = requests.get(f"{BASE}/stockcount",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    items = r.json()["items"]
    if not items:
        pytest.skip("No medicines in count sheet")

    payload = {
        "items": [
            {"medicine_id": item["id"],
             "counted_quantity": item["branch_quantity"],
             "notes": "No variance"}
            for item in items[:3]
        ]
    }
    r2 = requests.post(f"{BASE}/stockcount/submit", json=payload,
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert r2.status_code == 200
    data = r2.json()
    assert data["status"] == "ok"
    assert data["adjustments_made"] == 0


def test_submit_stock_count_positive_variance(pharm_token):
    """Submit count higher than system — stock increases, ADJUST movement logged."""
    r = requests.get(f"{BASE}/stockcount",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    items = r.json()["items"]
    # Find a medicine with stock to add to
    item = next((i for i in items if i["branch_quantity"] > 0), None)
    if not item:
        pytest.skip("No medicine with stock found")

    original_qty = item["branch_quantity"]
    counted_qty = original_qty + 5  # Found 5 extra units

    r2 = requests.post(f"{BASE}/stockcount/submit",
                       json={"items": [{"medicine_id": item["id"],
                                        "counted_quantity": counted_qty,
                                        "notes": "Found extra units on shelf"}]},
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert r2.status_code == 200
    data = r2.json()
    assert data["adjustments_made"] == 1

    # Verify stock went up
    r3 = requests.get(f"{BASE}/stockcount",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    updated = next((i for i in r3.json()["items"] if i["id"] == item["id"]), None)
    assert updated is not None
    assert updated["branch_quantity"] == counted_qty

    # Verify ADJUST movement was logged
    r4 = requests.get(f"{BASE}/purchases/movements/all?page_size=10",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    movements = r4.json()["items"]
    adjust = next((m for m in movements if m["movement_type"] == "ADJUST"
                   and m["medicine_id"] == item["id"]), None)
    assert adjust is not None
    assert adjust["qty_delta"] == 5


def test_submit_stock_count_negative_variance(pharm_token):
    """Submit count lower than system — stock decreases, ADJUST movement logged."""
    r = requests.get(f"{BASE}/stockcount",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    items = r.json()["items"]
    item = next((i for i in items if i["branch_quantity"] >= 3), None)
    if not item:
        pytest.skip("No medicine with enough stock for negative variance test")

    original_qty = item["branch_quantity"]
    counted_qty = original_qty - 2  # 2 units missing

    r2 = requests.post(f"{BASE}/stockcount/submit",
                       json={"items": [{"medicine_id": item["id"],
                                        "counted_quantity": counted_qty,
                                        "notes": "2 units missing — possible breakage"}]},
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert r2.status_code == 200
    data = r2.json()
    assert data["adjustments_made"] == 1

    # Verify stock went down
    r3 = requests.get(f"{BASE}/stockcount",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    updated = next((i for i in r3.json()["items"] if i["id"] == item["id"]), None)
    assert updated is not None
    assert updated["branch_quantity"] == counted_qty

    # Verify ADJUST movement was logged with negative delta
    r4 = requests.get(f"{BASE}/purchases/movements/all?page_size=10",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    movements = r4.json()["items"]
    adjust = next((m for m in movements if m["movement_type"] == "ADJUST"
                   and m["medicine_id"] == item["id"]
                   and m["qty_delta"] < 0), None)
    assert adjust is not None
    assert adjust["qty_delta"] == -2


def test_submit_empty_count_rejected(pharm_token):
    """POST /stockcount/submit with no items is rejected."""
    r = requests.post(f"{BASE}/stockcount/submit",
                      json={"items": []},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 400
