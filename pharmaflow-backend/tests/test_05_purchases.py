"""
Test 05 — Purchases (Goods Receipts / Batches)
Covers: GET /purchases, POST /purchases (creates batches + stock movements),
        PUT /purchases/{id}/write-off, GET /purchases/movements/all
"""

import requests
import pytest
import uuid

BASE = "http://localhost:8000"


def test_list_purchases(admin_token):
    """GET /purchases returns batch list with medicine names."""
    r = requests.get(f"{BASE}/purchases",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert len(data["items"]) > 0
    item = data["items"][0]
    assert "medicine_name_en" in item
    assert "batch_number" in item
    assert "expiry_date" in item


def test_list_purchases_branch_filter(admin_token):
    """GET /purchases?branch_id=br-001 returns only br-001 batches."""
    r = requests.get(f"{BASE}/purchases?branch_id=br-001",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["branch_id"] == "br-001"


def test_create_purchase_admin(admin_token, state):
    """POST /purchases by admin creates a batch and logs IN movement."""
    med_id = state.get("medicine_id")
    if not med_id:
        pytest.skip("medicine_id not set")

    r = requests.get(f"{BASE}/suppliers",
                     headers={"Authorization": f"Bearer {admin_token}"})
    supplier_id = r.json()["items"][0]["id"]

    batch_num = f"TEST-{uuid.uuid4().hex[:8]}"
    payload = {
        "branch_id": "br-001",
        "supplier_id": supplier_id,
        "medicine_id": med_id,
        "batch_number": batch_num,
        "expiry_date": "2028-12-31",
        "quantity": 50,
        "unit_cost": "10.000"
    }
    r2 = requests.post(f"{BASE}/purchases", json=payload,
                       headers={"Authorization": f"Bearer {admin_token}"})
    assert r2.status_code == 201
    data = r2.json()
    state["test_batch_id"] = data["id"]
    assert data["branch_id"] == "br-001"
    assert data["qty_received"] == 50
    assert data["qty_remaining"] == 50


def test_create_purchase_pharmacist_allowed(pharm_token, state):
    """POST /purchases by pharmacist is allowed (goods receiving on floor)."""
    med_id = state.get("medicine_id")
    if not med_id:
        pytest.skip("medicine_id not set")

    r = requests.get(f"{BASE}/suppliers",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    supplier_id = r.json()["items"][0]["id"]

    batch_num = f"PHARM-{uuid.uuid4().hex[:8]}"
    payload = {
        "branch_id": "br-001",
        "supplier_id": supplier_id,
        "medicine_id": med_id,
        "batch_number": batch_num,
        "expiry_date": "2028-06-30",
        "quantity": 10,
        "unit_cost": "10.000"
    }
    r2 = requests.post(f"{BASE}/purchases", json=payload,
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert r2.status_code == 201


def test_create_purchase_missing_required_fields(admin_token):
    """POST /purchases missing required fields returns 400."""
    r = requests.post(f"{BASE}/purchases",
                      json={"branch_id": "br-001"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 400


def test_create_purchase_zero_quantity(admin_token, state):
    """POST /purchases with quantity 0 returns 400."""
    med_id = state.get("medicine_id")
    if not med_id:
        pytest.skip("medicine_id not set")
    r = requests.get(f"{BASE}/suppliers",
                     headers={"Authorization": f"Bearer {admin_token}"})
    supplier_id = r.json()["items"][0]["id"]
    r2 = requests.post(f"{BASE}/purchases",
                       json={
                           "branch_id": "br-001",
                           "supplier_id": supplier_id,
                           "medicine_id": med_id,
                           "batch_number": "ZERO-QTY",
                           "expiry_date": "2028-12-31",
                           "quantity": 0,
                           "unit_cost": "10.000"
                       },
                       headers={"Authorization": f"Bearer {admin_token}"})
    assert r2.status_code == 400


def test_write_off_batch(admin_token, state):
    """PUT /purchases/{id}/write-off marks batch written_off."""
    batch_id = state.get("test_batch_id")
    if not batch_id:
        pytest.skip("test_batch_id not set")
    r = requests.put(f"{BASE}/purchases/{batch_id}/write-off",
                     json={"reason": "Damage during handling"},
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert r.json()["status"] == "written_off"


def test_movements_all(admin_token):
    """GET /purchases/movements/all returns stock movement ledger."""
    r = requests.get(f"{BASE}/purchases/movements/all",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert len(data["items"]) > 0
    item = data["items"][0]
    assert "movement_type" in item
    assert item["movement_type"] in ("IN", "OUT", "ADJUST", "RETURN",
                                      "WRITE_OFF", "TRANSFER_IN", "TRANSFER_OUT")
