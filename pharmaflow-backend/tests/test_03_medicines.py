"""
Test 03 — Medicines
Covers: GET /medicines (search, branch_id, low_stock), GET /medicines/{id},
        POST /medicines, PUT /medicines, DELETE /medicines
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_list_medicines_default(admin_token):
    """GET /medicines returns paginated list."""
    r = requests.get(f"{BASE}/medicines",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert len(data["items"]) > 0


def test_list_medicines_with_branch(pharm_token, state):
    """GET /medicines?branch_id=br-001 returns branch-specific stock."""
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) > 0
    # Every item should have stock_quantity field
    for item in data["items"]:
        assert "stock_quantity" in item


def test_search_medicines(admin_token):
    """Search by name returns relevant results."""
    r = requests.get(f"{BASE}/medicines?search=paracetamol",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    # Should find Paracetamol
    names = [i["name_en"].lower() for i in data["items"]]
    assert any("paracetamol" in n for n in names)


def test_low_stock_filter(admin_token):
    """?low_stock=true returns only medicines at or below threshold."""
    r = requests.get(f"{BASE}/medicines?low_stock=true&is_active=true",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    for item in data["items"]:
        assert item["stock_quantity"] <= item["low_stock_threshold"]


def test_get_medicine_by_id(admin_token, state):
    """GET /medicines/{id} returns medicine detail."""
    # Get first medicine
    r = requests.get(f"{BASE}/medicines",
                     headers={"Authorization": f"Bearer {admin_token}"})
    first_id = r.json()["items"][0]["id"]
    state["medicine_id"] = first_id

    r2 = requests.get(f"{BASE}/medicines/{first_id}",
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r2.status_code == 200
    assert r2.json()["id"] == first_id


def test_create_medicine(admin_token, state):
    """POST /medicines creates a new medicine."""
    payload = {
        "name_en": "Test Medicine EN",
        "name_ar": "دواء تجريبي",
        "generic_name": "testgeneric",
        "barcode": "9990000000001",
        "category": "Analgesics",
        "form": "tablet",
        "strength": "100mg",
        "unit": "box",
        "selling_price": "25.000",
        "low_stock_threshold": 5,
        "requires_prescription": False,
        "vat_category": "zero_rated",
        "requires_cold_chain": False,
        "sfda_registration_no": "",
        "max_public_price": "30.000"
    }
    r = requests.post(f"{BASE}/medicines", json=payload,
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 201
    med = r.json()
    state["test_medicine_id"] = med["id"]
    assert med["name_en"] == "Test Medicine EN"
    assert med["barcode"] == "9990000000001"


def test_update_medicine(admin_token, state):
    """PUT /medicines/{id} updates medicine."""
    med_id = state.get("test_medicine_id")
    if not med_id:
        pytest.skip("test_medicine_id not set")
    r = requests.put(f"{BASE}/medicines/{med_id}",
                     json={"selling_price": "28.000"},
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert float(r.json()["selling_price"]) == 28.0


def test_get_medicine_movements(admin_token, state):
    """GET /medicines/{id}/movements returns stock movement history."""
    med_id = state.get("medicine_id")
    if not med_id:
        pytest.skip("medicine_id not set")
    r = requests.get(f"{BASE}/medicines/{med_id}/movements",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert "items" in r.json()
