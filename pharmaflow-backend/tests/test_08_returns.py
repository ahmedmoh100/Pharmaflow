"""
Test 08 — Returns
Covers: GET /returns/lookup/{invoice}, POST /returns,
        GET /returns, GET /returns/{id}
Tests: full return with restock, partial return, non-restockable return,
       over-quantity rejection, credit sale return
"""

import requests
import pytest
import uuid

BASE = "http://localhost:8000"


@pytest.fixture(autouse=True)
def ensure_open_session(pharm_token):
    """Ensure a shift is open before return tests."""
    r = requests.get(f"{BASE}/sessions/current",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    if r.status_code == 404:
        requests.post(f"{BASE}/sessions/open",
                      json={"opening_float": 500.0},
                      headers={"Authorization": f"Bearer {pharm_token}"})


def _create_test_sale(pharm_token, quantity=2):
    """Helper: create a sale and return (sale_id, invoice_number, item_id, medicine_id)."""
    r_meds = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=20",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    med = next((m for m in r_meds.json()["items"]
                if m["stock_quantity"] >= quantity and not m["is_controlled"]), None)
    if not med:
        return None

    r = requests.post(f"{BASE}/sales",
                      json={
                          "branch_id": "br-001",
                          "payment_method": "cash",
                          "items": [{"medicine_id": med["id"],
                                     "quantity": quantity,
                                     "unit_price": med["selling_price"]}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}",
                               "X-Idempotency-Key": str(uuid.uuid4())})
    if r.status_code != 201:
        return None

    data = r.json()
    return {
        "sale_id": data["id"],
        "invoice_number": data["invoice_number"],
        "item_id": data["items"][0]["id"],
        "medicine_id": med["id"],
        "quantity": quantity,
        "total_amount": float(data["total_amount"]),
    }


# ── Lookup ─────────────────────────────────────────────────────────────────────

def test_lookup_sale_by_invoice(pharm_token, state):
    """GET /returns/lookup/{invoice} returns sale with returnable items."""
    invoice = state.get("test_invoice_number")
    if not invoice:
        pytest.skip("test_invoice_number not set")
    r = requests.get(f"{BASE}/returns/lookup/{invoice}",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert len(data["items"]) > 0
    item = data["items"][0]
    assert "returnable_qty" in item
    assert item["returnable_qty"] >= 0


def test_lookup_nonexistent_invoice(pharm_token):
    """Lookup of non-existent invoice returns 404."""
    r = requests.get(f"{BASE}/returns/lookup/FAKE-INV-000000",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 404


# ── Full return with restock ───────────────────────────────────────────────────

def test_create_full_return_with_restock(pharm_token, state):
    """POST /returns full return restocks the item and creates credit note."""
    sale = _create_test_sale(pharm_token, quantity=2)
    if not sale:
        pytest.skip("Could not create test sale")

    # Get stock before return
    r_med = requests.get(f"{BASE}/medicines?search=&branch_id=br-001&page_size=50",
                          headers={"Authorization": f"Bearer {pharm_token}"})
    med_before = next((m for m in r_med.json()["items"]
                       if m["id"] == sale["medicine_id"]), None)
    stock_before = med_before["stock_quantity"] if med_before else None

    r = requests.post(f"{BASE}/returns",
                      json={
                          "sale_id": sale["sale_id"],
                          "reason": "Customer changed mind",
                          "items": [{"sale_item_id": sale["item_id"],
                                     "quantity": 2,
                                     "restockable": True,
                                     "reason": "Unopened, full condition"}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 201
    data = r.json()
    state["test_return_id"] = data.get("return_id") or data.get("id")
    assert "credit_note_number" in data
    assert data["credit_note_number"].startswith("CN-")
    assert float(data["total_refund"]) == sale["total_amount"]

    # Verify stock increased
    if stock_before is not None:
        r_med2 = requests.get(f"{BASE}/medicines?branch_id=br-001&page_size=50",
                               headers={"Authorization": f"Bearer {pharm_token}"})
        med_after = next((m for m in r_med2.json()["items"]
                          if m["id"] == sale["medicine_id"]), None)
        if med_after:
            assert med_after["stock_quantity"] == stock_before + 2


def test_create_partial_return(pharm_token):
    """POST /returns partial return — return 1 of 2 units."""
    sale = _create_test_sale(pharm_token, quantity=2)
    if not sale:
        pytest.skip("Could not create test sale")

    r = requests.post(f"{BASE}/returns",
                      json={
                          "sale_id": sale["sale_id"],
                          "reason": "Customer kept one unit",
                          "items": [{"sale_item_id": sale["item_id"],
                                     "quantity": 1,  # Only 1 of 2
                                     "restockable": True,
                                     "reason": "Partial return"}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 201
    data = r.json()
    # Refund should be half the total
    expected_refund = sale["total_amount"] / 2
    assert abs(float(data["total_refund"]) - expected_refund) < 0.01


def test_create_non_restockable_return(pharm_token):
    """POST /returns with restockable=False — stock does NOT increase."""
    sale = _create_test_sale(pharm_token, quantity=1)
    if not sale:
        pytest.skip("Could not create test sale")

    # Stock before
    r_med = requests.get(f"{BASE}/medicines?branch_id=br-001&page_size=50",
                          headers={"Authorization": f"Bearer {pharm_token}"})
    med_before = next((m for m in r_med.json()["items"]
                       if m["id"] == sale["medicine_id"]), None)
    stock_before = med_before["stock_quantity"] if med_before else None

    r = requests.post(f"{BASE}/returns",
                      json={
                          "sale_id": sale["sale_id"],
                          "reason": "Product damaged",
                          "items": [{"sale_item_id": sale["item_id"],
                                     "quantity": 1,
                                     "restockable": False,  # Do NOT restock
                                     "reason": "Damaged — cannot resell"}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 201

    # Stock should NOT have changed
    if stock_before is not None:
        r_med2 = requests.get(f"{BASE}/medicines?branch_id=br-001&page_size=50",
                               headers={"Authorization": f"Bearer {pharm_token}"})
        med_after = next((m for m in r_med2.json()["items"]
                          if m["id"] == sale["medicine_id"]), None)
        if med_after:
            assert med_after["stock_quantity"] == stock_before, \
                "Non-restockable return should not change stock"


def test_cannot_return_more_than_sold(pharm_token, state):
    """Return quantity > sold quantity returns 400."""
    invoice = state.get("test_invoice_number")
    if not invoice:
        pytest.skip("test_invoice_number not set")

    r_lookup = requests.get(f"{BASE}/returns/lookup/{invoice}",
                             headers={"Authorization": f"Bearer {pharm_token}"})
    if r_lookup.status_code != 200:
        pytest.skip("Cannot lookup invoice")

    items = r_lookup.json()["items"]
    if not items:
        pytest.skip("No items to return")

    item = items[0]
    r = requests.post(f"{BASE}/returns",
                      json={
                          "sale_id": r_lookup.json()["id"],
                          "reason": "Over-return attempt",
                          "items": [{"sale_item_id": item["id"],
                                     "quantity": item["quantity"] + 100,
                                     "restockable": True,
                                     "reason": "Test"}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 400


# ── List + detail ──────────────────────────────────────────────────────────────

def test_list_returns(pharm_token):
    """GET /returns returns list for current branch."""
    r = requests.get(f"{BASE}/returns",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert len(data["items"]) > 0


def test_get_return_detail(pharm_token, state):
    """GET /returns/{id} returns return with credit note."""
    return_id = state.get("test_return_id")
    if not return_id:
        pytest.skip("test_return_id not set")
    r = requests.get(f"{BASE}/returns/{return_id}",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "credit_note_number" in data
    assert "items" in data
    assert len(data["items"]) > 0
    assert data["credit_note_number"].startswith("CN-")
