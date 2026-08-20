"""
Test 10 — Parked Transactions (Hold / Suspend / Recall)
Covers: POST /parked, GET /parked, POST /parked/{id}/recall, POST /parked/{id}/void
"""

import requests
import pytest

BASE = "http://localhost:8000"


def _sample_cart(med_id: str, price: str) -> list:
    return [{
        "medicine_id": med_id,
        "name_en": "Test Med",
        "name_ar": "دواء تجريبي",
        "quantity": 2,
        "unit_price": float(price),
        "batch_id": "",
        "vat_rate": 0,
        "discount_pct": 0,
        "line_comment": ""
    }]


def test_park_transaction(pharm_token, state):
    """POST /parked saves a cart as PARKED."""
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    med = r.json()["items"][0]
    cart = _sample_cart(med["id"], med["selling_price"])

    r2 = requests.post(f"{BASE}/parked",
                       json={"cart": cart, "session_id": None},
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert r2.status_code == 201
    data = r2.json()
    state["test_parked_id"] = data["id"]
    assert data["status"] == "PARKED"


def test_park_empty_cart_rejected(pharm_token):
    """POST /parked with empty cart is rejected."""
    r = requests.post(f"{BASE}/parked",
                      json={"cart": [], "session_id": None},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 400


def test_list_parked(pharm_token, state):
    """GET /parked returns list including newly parked transaction."""
    r = requests.get(f"{BASE}/parked",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    ids = [p["id"] for p in data["items"]]
    assert state.get("test_parked_id") in ids


def test_recall_transaction(pharm_token, state):
    """POST /parked/{id}/recall marks RECALLED and returns cart."""
    parked_id = state.get("test_parked_id")
    if not parked_id:
        pytest.skip("test_parked_id not set")
    r = requests.post(f"{BASE}/parked/{parked_id}/recall",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "RECALLED"
    assert "cart" in data
    assert len(data["cart"]) > 0


def test_recalled_not_in_parked_list(pharm_token, state):
    """Recalled transaction no longer shows in active parked list."""
    r = requests.get(f"{BASE}/parked",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    ids = [p["id"] for p in r.json()["items"]]
    assert state.get("test_parked_id") not in ids


def test_void_parked(pharm_token, state):
    """POST /parked/{id}/void marks VOIDED."""
    # Park a new one to void
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    med = r.json()["items"][0]
    cart = _sample_cart(med["id"], med["selling_price"])

    r2 = requests.post(f"{BASE}/parked",
                       json={"cart": cart, "session_id": None},
                       headers={"Authorization": f"Bearer {pharm_token}"})
    parked_id = r2.json()["id"]

    r3 = requests.post(f"{BASE}/parked/{parked_id}/void",
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert r3.status_code == 200
    assert r3.json()["status"] == "VOIDED"
