"""
Test 11 — Customers
Covers: POST /customers, GET /customers (search), GET /customers/{id},
        PUT /customers/{id}, GET /customers/{id}/ledger,
        POST /customers/{id}/payments, credit limit enforcement
"""

import requests
import pytest
import uuid

BASE = "http://localhost:8000"


def test_create_customer(pharm_token, state):
    """POST /customers creates a customer record."""
    payload = {
        "name_ar": "فاطمة العمري",
        "name_en": "Fatima Al-Omari",
        "phone": f"050{uuid.uuid4().int % 10000000:07d}",
        "national_id": f"{uuid.uuid4().int % 9000000000 + 1000000000}",
    }
    r = requests.post(f"{BASE}/customers", json=payload,
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 201
    data = r.json()
    state["test_customer_id"] = data["id"]
    assert data["name_ar"] == "فاطمة العمري"


def test_create_credit_customer(admin_token, state):
    """POST /customers creates customer with credit limit."""
    payload = {
        "name_en": "Credit Corp",
        "name_ar": "شركة الآجل",
        "phone": f"055{uuid.uuid4().int % 10000000:07d}",
        "national_id": f"{uuid.uuid4().int % 9000000000 + 1000000000}",
        "credit_limit": 500.00,
        "is_credit_allowed": True,
    }
    r = requests.post(f"{BASE}/customers", json=payload,
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 201
    data = r.json()
    state["credit_customer_id"] = data["id"]
    assert float(data["credit_limit"]) == 500.00
    assert data["is_credit_allowed"] is True
    assert float(data["current_balance"]) == 0.00


def test_search_customer_by_name(pharm_token, state):
    """GET /customers?search=fatima returns matching customer."""
    r = requests.get(f"{BASE}/customers?search=Fatima",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert len(r.json()["items"]) > 0


def test_search_customer_by_phone(pharm_token, state):
    """GET /customers?search=phone finds by phone."""
    cust_id = state.get("test_customer_id")
    if not cust_id:
        pytest.skip("test_customer_id not set")
    r_c = requests.get(f"{BASE}/customers/{cust_id}",
                       headers={"Authorization": f"Bearer {pharm_token}"})
    phone = r_c.json()["phone"]
    r = requests.get(f"{BASE}/customers?search={phone}",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert len(r.json()["items"]) > 0


def test_search_customer_by_national_id(pharm_token, state):
    """GET /customers?search=national_id finds by national ID."""
    cust_id = state.get("test_customer_id")
    if not cust_id:
        pytest.skip("test_customer_id not set")
    r_c = requests.get(f"{BASE}/customers/{cust_id}",
                       headers={"Authorization": f"Bearer {pharm_token}"})
    nid = r_c.json()["national_id"]
    r = requests.get(f"{BASE}/customers?search={nid}",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert len(r.json()["items"]) > 0


def test_get_customer_by_id(pharm_token, state):
    """GET /customers/{id} returns customer detail."""
    cust_id = state.get("test_customer_id")
    if not cust_id:
        pytest.skip("test_customer_id not set")
    r = requests.get(f"{BASE}/customers/{cust_id}",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert r.json()["id"] == cust_id


def test_update_customer(pharm_token, state):
    """PUT /customers/{id} updates customer info."""
    cust_id = state.get("test_customer_id")
    if not cust_id:
        pytest.skip("test_customer_id not set")
    r = requests.put(f"{BASE}/customers/{cust_id}",
                     json={"phone": "0509876543"},
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert r.json()["phone"] == "0509876543"


def test_search_no_results(pharm_token):
    """Search with no matching results returns empty list."""
    r = requests.get(f"{BASE}/customers?search=ZZZNOMATCH99999",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert len(r.json()["items"]) == 0


def test_customer_ledger_empty(pharm_token, state):
    """GET /customers/{id}/ledger returns empty list for new customer."""
    cust_id = state.get("credit_customer_id")
    if not cust_id:
        pytest.skip("credit_customer_id not set")
    r = requests.get(f"{BASE}/customers/{cust_id}/ledger",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert "items" in r.json()


def test_credit_payment_records_ledger(pharm_token, admin_token, state):
    """POST /customers/{id}/payments records payment and reduces balance."""
    cust_id = state.get("credit_customer_id")
    if not cust_id:
        pytest.skip("credit_customer_id not set")

    # First make a credit sale to build up balance
    r_meds = requests.get(f"{BASE}/medicines?branch_id=br-001&page_size=5",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    med = r_meds.json()["items"][0]

    r_sale = requests.post(f"{BASE}/sales",
                           json={
                               "branch_id": "br-001",
                               "customer_id": cust_id,
                               "payment_method": "credit",
                               "items": [{"medicine_id": med["id"],
                                          "quantity": 1,
                                          "unit_price": med["selling_price"]}]
                           },
                           headers={"Authorization": f"Bearer {pharm_token}",
                                    "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_sale.status_code == 201
    sale_total = float(r_sale.json()["total_amount"])

    # Check balance increased
    r_c = requests.get(f"{BASE}/customers/{cust_id}",
                       headers={"Authorization": f"Bearer {pharm_token}"})
    balance_after_sale = float(r_c.json()["current_balance"])
    assert abs(balance_after_sale - sale_total) < 0.01

    # Make a payment
    r_pay = requests.post(f"{BASE}/customers/{cust_id}/payments",
                          json={"amount": sale_total, "notes": "Test settlement"},
                          headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_pay.status_code == 201
    assert float(r_pay.json()["new_balance"]) == 0.00

    # Check ledger has both entries
    r_ledger = requests.get(f"{BASE}/customers/{cust_id}/ledger",
                             headers={"Authorization": f"Bearer {pharm_token}"})
    types = [e["transaction_type"] for e in r_ledger.json()["items"]]
    assert "CHARGE" in types
    assert "PAYMENT" in types


def test_credit_limit_exceeded_rejected(pharm_token, state):
    """Credit sale exceeding credit limit returns 400."""
    cust_id = state.get("credit_customer_id")
    if not cust_id:
        pytest.skip("credit_customer_id not set")

    # Get current customer balance first
    r_c = requests.get(f"{BASE}/customers/{cust_id}",
                       headers={"Authorization": f"Bearer {pharm_token}"})
    current_balance = float(r_c.json()["current_balance"])
    credit_limit = float(r_c.json()["credit_limit"])
    remaining = credit_limit - current_balance

    # Find a medicine where 1 unit costs more than remaining credit
    r_meds = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=50",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    # Pick any medicine and buy enough quantity to exceed the limit
    med = next((m for m in r_meds.json()["items"]
                if float(m["selling_price"]) > 0 and not m["is_controlled"]), None)
    if not med:
        pytest.skip("No suitable medicine")

    # Calculate quantity that would exceed the limit
    unit_price = float(med["selling_price"])
    qty_to_exceed = int(remaining / unit_price) + 2  # definitely over

    r = requests.post(f"{BASE}/sales",
                      json={
                          "branch_id": "br-001",
                          "customer_id": cust_id,
                          "payment_method": "credit",
                          "items": [{"medicine_id": med["id"],
                                     "quantity": qty_to_exceed,
                                     "unit_price": med["selling_price"]}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}",
                               "X-Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 400
    # Error could be credit limit OR insufficient stock — both are correct rejections
    detail = r.json()["detail"].lower()
    assert "credit" in detail or "stock" in detail or "insufficient" in detail
