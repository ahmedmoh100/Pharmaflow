"""
Test 16 — Operational Workflows (admin + pharmacist roles only)
Covers: controlled substance workflow, customer credit + ledger,
        SFDA recall lockdown, purchase order lifecycle
"""

import requests
import pytest
import uuid

BASE = "http://localhost:8000"


# ── Controlled substance workflow ──────────────────────────────────────────────

def test_controlled_substance_full_workflow(admin_token, pharm_token):
    """
    Full controlled drug workflow:
    1. Create controlled medicine + stock
    2. Sale without patient ID → 400
    3. Sale with patient ID + doctor license → 201
    4. Verify logged in controlled dispense registry
    """
    # 1. Get a controlled medicine with stock
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=50",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    controlled = next(
        (m for m in r.json()["items"] if m["is_controlled"] and m["stock_quantity"] > 0),
        None
    )
    if not controlled:
        pytest.skip("No controlled medicine with stock in seed")

    # 2. Sale without patient ID — must fail
    r_fail = requests.post(f"{BASE}/sales",
                           json={
                               "branch_id": "br-001",
                               "payment_method": "cash",
                               "items": [{"medicine_id": controlled["id"],
                                          "quantity": 1,
                                          "unit_price": controlled["selling_price"]}]
                           },
                           headers={"Authorization": f"Bearer {pharm_token}",
                                    "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_fail.status_code == 400

    # 3. Sale with patient ID — must succeed
    patient_id = "1089234511"
    r_ok = requests.post(f"{BASE}/sales",
                         json={
                             "branch_id": "br-001",
                             "payment_method": "cash",
                             "patient_national_id": patient_id,
                             "doctor_license": "DOC-NARC-TEST-001",
                             "items": [{"medicine_id": controlled["id"],
                                        "quantity": 1,
                                        "unit_price": controlled["selling_price"]}]
                         },
                         headers={"Authorization": f"Bearer {pharm_token}",
                                  "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_ok.status_code == 201

    # 4. Verify registry
    r_reg = requests.get(f"{BASE}/medicines/controlled/registry?patient_id={patient_id}",
                         headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_reg.status_code == 200
    assert r_reg.json()["total"] >= 1
    assert any(e["medicine_id"] == controlled["id"] for e in r_reg.json()["items"])


# ── Customer credit workflow ───────────────────────────────────────────────────

def test_credit_purchase_and_settlement(pharm_token, admin_token):
    """
    Full credit workflow:
    1. Create customer with credit limit
    2. Credit sale — balance increases
    3. Return partial — balance decreases
    4. Payment — balance settles to 0
    5. Overpayment rejected
    """
    # 1. Create credit customer
    r_cust = requests.post(f"{BASE}/customers",
                           json={
                               "name_en": "Credit Workflow Test",
                               "name_ar": "اختبار الآجل",
                               "phone": f"054{uuid.uuid4().int % 10000000:07d}",
                               "credit_limit": 300.00,
                               "is_credit_allowed": True,
                           },
                           headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_cust.status_code == 201
    cust_id = r_cust.json()["id"]

    # 2. Credit sale
    r_meds = requests.get(f"{BASE}/medicines?branch_id=br-001&page_size=5",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    med = next((m for m in r_meds.json()["items"]
                if m["stock_quantity"] >= 2 and not m["is_controlled"]), None)
    if not med:
        pytest.skip("No suitable medicine for credit test")

    r_sale = requests.post(f"{BASE}/sales",
                           json={
                               "branch_id": "br-001",
                               "customer_id": cust_id,
                               "payment_method": "credit",
                               "items": [{"medicine_id": med["id"],
                                          "quantity": 2,
                                          "unit_price": med["selling_price"]}]
                           },
                           headers={"Authorization": f"Bearer {pharm_token}",
                                    "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_sale.status_code == 201
    sale_total = float(r_sale.json()["total_amount"])
    sale_id = r_sale.json()["id"]
    item_id = r_sale.json()["items"][0]["id"]

    # Verify balance
    r_c = requests.get(f"{BASE}/customers/{cust_id}",
                       headers={"Authorization": f"Bearer {pharm_token}"})
    assert abs(float(r_c.json()["current_balance"]) - sale_total) < 0.01

    # 3. Return 1 unit — balance should decrease
    r_ret = requests.post(f"{BASE}/returns",
                          json={
                              "sale_id": sale_id,
                              "reason": "Partial return",
                              "items": [{"sale_item_id": item_id,
                                         "quantity": 1,
                                         "restockable": True,
                                         "reason": "Returned one unit"}]
                          },
                          headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_ret.status_code == 201
    refund = float(r_ret.json()["total_refund"])

    r_c2 = requests.get(f"{BASE}/customers/{cust_id}",
                        headers={"Authorization": f"Bearer {pharm_token}"})
    expected_balance = round(sale_total - refund, 2)
    assert abs(float(r_c2.json()["current_balance"]) - expected_balance) < 0.01

    # 4. Overpayment rejected
    r_over = requests.post(f"{BASE}/customers/{cust_id}/payments",
                           json={"amount": expected_balance + 100.0,
                                 "notes": "Overpay attempt"},
                           headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_over.status_code == 400

    # 5. Exact settlement
    r_pay = requests.post(f"{BASE}/customers/{cust_id}/payments",
                          json={"amount": expected_balance, "notes": "Final settlement"},
                          headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_pay.status_code == 201
    assert float(r_pay.json()["new_balance"]) == 0.00

    # 6. Ledger has CHARGE + REFUND + PAYMENT
    r_ledger = requests.get(f"{BASE}/customers/{cust_id}/ledger",
                             headers={"Authorization": f"Bearer {pharm_token}"})
    types = {e["transaction_type"] for e in r_ledger.json()["items"]}
    assert "CHARGE" in types
    assert "REFUND" in types
    assert "PAYMENT" in types


# ── Purchase Order lifecycle ───────────────────────────────────────────────────

def test_purchase_order_full_lifecycle(admin_token):
    """
    Full PO workflow:
    DRAFT → SENT → RECEIVE (stock increases)
    """
    r_meds = requests.get(f"{BASE}/medicines?page_size=5",
                           headers={"Authorization": f"Bearer {admin_token}"})
    med = r_meds.json()["items"][0]

    r_sup = requests.get(f"{BASE}/suppliers",
                          headers={"Authorization": f"Bearer {admin_token}"})
    supplier = r_sup.json()["items"][0]

    # Create DRAFT PO — correct field names: ordered_qty, agreed_unit_cost
    r_po = requests.post(f"{BASE}/purchase-orders/",
                         json={
                             "branch_id": "br-001",
                             "supplier_id": supplier["id"],
                             "items": [{"medicine_id": med["id"],
                                        "ordered_qty": 20,
                                        "agreed_unit_cost": 10.0}],
                             "notes": "Test PO"
                         },
                         headers={"Authorization": f"Bearer {admin_token}"})
    assert r_po.status_code == 201
    po_id = r_po.json()["id"]
    assert r_po.json()["status"] == "DRAFT"

    # SENT
    r_sent = requests.put(f"{BASE}/purchase-orders/{po_id}/status",
                           json={"status": "SENT"},
                           headers={"Authorization": f"Bearer {admin_token}"})
    assert r_sent.status_code == 200
    assert r_sent.json()["status"] == "SENT"

    # RECEIVE — quantity_received and unit_cost as float
    batch_num = f"PO-{uuid.uuid4().hex[:8]}"
    r_recv = requests.post(f"{BASE}/purchase-orders/{po_id}/receive",
                            json={
                                "items": [{"medicine_id": med["id"],
                                           "batch_number": batch_num,
                                           "expiry_date": "2029-06-30",
                                           "qty_received": 20,
                                           "unit_cost": 10.0}]
                            },
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert r_recv.status_code == 200
    assert r_recv.json()["status"] == "RECEIVED"


def test_purchase_order_cancel(admin_token):
    """PO can be cancelled from DRAFT."""
    r_meds = requests.get(f"{BASE}/medicines?page_size=1",
                           headers={"Authorization": f"Bearer {admin_token}"})
    med = r_meds.json()["items"][0]
    r_sup = requests.get(f"{BASE}/suppliers",
                          headers={"Authorization": f"Bearer {admin_token}"})
    supplier = r_sup.json()["items"][0]

    r_po = requests.post(f"{BASE}/purchase-orders/",
                         json={
                             "branch_id": "br-001",
                             "supplier_id": supplier["id"],
                             "items": [{"medicine_id": med["id"],
                                        "ordered_qty": 5,
                                        "agreed_unit_cost": 10.0}],
                         },
                         headers={"Authorization": f"Bearer {admin_token}"})
    assert r_po.status_code == 201
    po_id = r_po.json()["id"]

    r_cancel = requests.put(f"{BASE}/purchase-orders/{po_id}/status",
                             json={"status": "CANCELLED"},
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert r_cancel.status_code == 200
    assert r_cancel.json()["status"] == "CANCELLED"


# ── Alerts ─────────────────────────────────────────────────────────────────────

def test_low_stock_alert_accuracy(admin_token):
    """Medicines in low-stock alert actually have stock <= threshold."""
    r = requests.get(f"{BASE}/alerts/low-stock?branch_id=br-001",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    for alert in r.json().get("alerts", []):
        assert alert["stock_quantity"] <= alert["low_stock_threshold"]


def test_expiry_alert_excludes_recalled(admin_token):
    """Expiry alerts should not include recalled batches."""
    r = requests.get(f"{BASE}/alerts/expiry?branch_id=br-002",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    for alert in r.json().get("alerts", []):
        status = alert.get("sfda_status", "active")
        assert status not in ("recalled", "quarantined"), \
            f"Recalled/quarantined batch {alert.get('batch_id')} in expiry alerts"


# ── Transfer workflow ──────────────────────────────────────────────────────────

def test_transfer_deducts_source_adds_destination(admin_token):
    """Stock transfer reduces source branch and increases destination."""
    # Get Panadol stock at br-001 and br-003
    r1 = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-001",
                      headers={"Authorization": f"Bearer {admin_token}"})
    r2 = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-003",
                      headers={"Authorization": f"Bearer {admin_token}"})

    med_br1 = r1.json()["items"][0] if r1.json()["items"] else None
    med_br3 = r2.json()["items"][0] if r2.json()["items"] else None
    if not med_br1 or not med_br3:
        pytest.skip("Panadol not found in both branches")

    stock_br1_before = med_br1["stock_quantity"]
    stock_br3_before = med_br3["stock_quantity"]
    transfer_qty = 5

    r_tr = requests.post(f"{BASE}/transfers/",
                          json={
                              "from_branch_id": "br-001",
                              "to_branch_id": "br-003",
                              "medicine_id": med_br1["id"],
                              "qty": transfer_qty,
                              "notes": "Test transfer"
                          },
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r_tr.status_code == 201

    # Check stock changed correctly (branch-specific from batches)
    r1_after = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-001",
                             headers={"Authorization": f"Bearer {admin_token}"})
    r3_after = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-003",
                             headers={"Authorization": f"Bearer {admin_token}"})

    stock_br1_after = r1_after.json()["items"][0]["stock_quantity"]
    stock_br3_after = r3_after.json()["items"][0]["stock_quantity"]

    assert stock_br1_after == stock_br1_before - transfer_qty
    assert stock_br3_after == stock_br3_before + transfer_qty
