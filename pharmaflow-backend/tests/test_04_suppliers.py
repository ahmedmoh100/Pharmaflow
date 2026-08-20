"""
Test 04 — Suppliers
Covers: GET /suppliers, POST /suppliers, PUT /suppliers
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_list_suppliers(admin_token):
    """GET /suppliers returns supplier list."""
    r = requests.get(f"{BASE}/suppliers",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) > 0
    state_supplier = data["items"][0]
    assert "name_en" in state_supplier
    assert "name_ar" in state_supplier


def test_create_supplier(admin_token, state):
    """POST /suppliers creates a supplier."""
    payload = {
        "name_en": "Test Supplier Ltd",
        "name_ar": "شركة الاختبار",
        "tax_number": "300123456700003",
        "contact_person": "Ali Hassan",
        "phone": "0512345678",
        "email": "test@supplier.sa",
        "address": "Riyadh Industrial Zone",
        "supplier_type": "distributor"
    }
    r = requests.post(f"{BASE}/suppliers", json=payload,
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 201
    s = r.json()
    state["test_supplier_id"] = s["id"]
    assert s["name_en"] == "Test Supplier Ltd"


def test_update_supplier(admin_token, state):
    """PUT /suppliers/{id} updates supplier contact."""
    sup_id = state.get("test_supplier_id")
    if not sup_id:
        pytest.skip("test_supplier_id not set")
    r = requests.put(f"{BASE}/suppliers/{sup_id}",
                     json={"contact_person": "Mohammed Al-Ali"},
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert r.json()["contact_person"] == "Mohammed Al-Ali"


def test_supplier_blocked_for_pharmacist(pharm_token):
    """Pharmacist cannot create suppliers."""
    r = requests.post(f"{BASE}/suppliers",
                      json={"name_en": "X", "name_ar": "X"},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code in (401, 403)
