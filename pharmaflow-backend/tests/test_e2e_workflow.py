"""
End-to-End Workflow Tests — PharmaFlow
==========================================
Tests full business flows from start to finish:
1. Purchase Order lifecycle (DRAFT → SENT → RECEIVE → stock verified)
2. Pharmacist shift (open → sale → close → Z-report)
3. Coupon workflow (create → apply → usage tracked)
4. Stock transfer (br-001 → br-003, stock verified both ends)
"""

import requests
import pytest
import uuid
from datetime import datetime, timezone, timedelta

BASE = "http://localhost:8000"


@pytest.fixture(autouse=True)
def ensure_open_session(pharm_token):
    """Ensure shift is open for e2e tests that need POS."""
    r = requests.get(f"{BASE}/sessions/current",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    if r.status_code == 404:
        requests.post(f"{BASE}/sessions/open",
                      json={"opening_float": 500.0},
                      headers={"Authorization": f"Bearer {pharm_token}"})


# ── PO Lifecycle ───────────────────────────────────────────────────────────────

def test_purchase_order_full_lifecycle(admin_token, state):
    """
    DRAFT PO → SENT → receive goods → stock increases → status RECEIVED.
    """
    r_meds = requests.get(f"{BASE}/medicines?page_size=5",
                           headers={"Authorization": f"Bearer {admin_token}"})
    med = r_meds.json()["items"][0]

    r_sup = requests.get(f"{BASE}/suppliers",
                          headers={"Authorization": f"Bearer {admin_token}"})
    sup = r_sup.json()["items"][0]

    # Stock before receive
    r_stock = requests.get(f"{BASE}/medicines?search={med['name_en'][:8]}&branch_id=br-001",
                            headers={"Authorization": f"Bearer {admin_token}"})
    stock_before = next((m["stock_quantity"] for m in r_stock.json()["items"]
                         if m["id"] == med["id"]), 0)

    # Create PO — correct field names: ordered_qty, agreed_unit_cost (float)
    r_po = requests.post(f"{BASE}/purchase-orders/",
                          json={
                              "branch_id": "br-001",
                              "supplier_id": sup["id"],
                              "items": [{"medicine_id": med["id"],
                                         "ordered_qty": 20,
                                         "agreed_unit_cost": 10.0}],
                              "notes": "E2E test PO"
                          },
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r_po.status_code == 201
    po_id = r_po.json()["id"]
    assert r_po.json()["status"] == "DRAFT"

    # Send
    r_sent = requests.put(f"{BASE}/purchase-orders/{po_id}/status",
                           json={"status": "SENT"},
                           headers={"Authorization": f"Bearer {admin_token}"})
    assert r_sent.status_code == 200
    assert r_sent.json()["status"] == "SENT"

    # Receive
    batch_num = f"E2E-{uuid.uuid4().hex[:8]}"
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

    # Stock should have increased at br-001
    r_after = requests.get(f"{BASE}/medicines?search={med['name_en'][:8]}&branch_id=br-001",
                            headers={"Authorization": f"Bearer {admin_token}"})
    stock_after = next((m["stock_quantity"] for m in r_after.json()["items"]
                        if m["id"] == med["id"]), 0)
    assert stock_after == stock_before + 20, \
        f"Stock should be {stock_before + 20}, got {stock_after}"


# ── Shift lifecycle ────────────────────────────────────────────────────────────

def test_pharmacist_shift_with_sale_z_report(pharm_token):
    """
    Full shift: sale made → close → Z-report shows correct totals.
    """
    # Get current open session
    r_sess = requests.get(f"{BASE}/sessions/current",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_sess.status_code == 200
    session_id = r_sess.json()["id"]

    # Make a sale
    r_meds = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=20",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    med = next((m for m in r_meds.json()["items"]
                if m["stock_quantity"] > 0 and not m["is_controlled"]), None)
    if not med:
        pytest.skip("No medicine with stock")

    r_sale = requests.post(f"{BASE}/sales",
                            json={
                                "branch_id": "br-001",
                                "payment_method": "cash",
                                "items": [{"medicine_id": med["id"], "quantity": 1,
                                           "unit_price": med["selling_price"]}]
                            },
                            headers={"Authorization": f"Bearer {pharm_token}",
                                     "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_sale.status_code == 201
    sale_total = float(r_sale.json()["total_amount"])

    # Tender and close
    r_tender = requests.post(f"{BASE}/sessions/tender",
                              json={"declared_cash": 500.0 + sale_total,
                                    "notes": "E2E test tender"},
                              headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_tender.status_code == 200

    r_close = requests.post(f"{BASE}/sessions/close",
                             headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_close.status_code == 200

    # Z-report
    r_z = requests.get(f"{BASE}/sessions/{session_id}/z-report",
                        headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_z.status_code == 200
    z = r_z.json()
    assert z["total_sales"] >= 1
    assert float(z["total_revenue"]) >= sale_total
    assert z["session_id"] == session_id


# ── Coupon workflow ────────────────────────────────────────────────────────────

def test_coupon_create_apply_track(admin_token, pharm_token):
    """
    Create coupon → apply to sale → verify discount + usage count.
    """
    code = f"E2E-{uuid.uuid4().hex[:6].upper()}"
    r_cpn = requests.post(f"{BASE}/coupons/",
                           json={
                               "code": code,
                               "type": "promotional",
                               "discount_type": "percentage",
                               "discount_value": 10.0,
                               "description_en": "E2E 10% test coupon",
                               "description_ar": "كوبون اختبار"
                           },
                           headers={"Authorization": f"Bearer {admin_token}"})
    assert r_cpn.status_code == 201
    assert r_cpn.json()["code"] == code

    # Apply to a sale
    r_meds = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=10",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    med = next((m for m in r_meds.json()["items"]
                if m["stock_quantity"] > 0 and not m["is_controlled"]), None)
    if not med:
        pytest.skip("No medicine with stock")

    price = float(med["selling_price"])
    expected_discount = round(price * 0.10, 3)

    r_sale = requests.post(f"{BASE}/sales",
                            json={
                                "branch_id": "br-001",
                                "payment_method": "cash",
                                "coupon_code": code,
                                "items": [{"medicine_id": med["id"], "quantity": 1,
                                           "unit_price": med["selling_price"]}]
                            },
                            headers={"Authorization": f"Bearer {pharm_token}",
                                     "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_sale.status_code == 201
    assert abs(float(r_sale.json().get("coupon_discount", 0)) - expected_discount) < 0.01

    # Usage count incremented
    r_coupons = requests.get(f"{BASE}/coupons/",
                              headers={"Authorization": f"Bearer {admin_token}"})
    cpn = next((c for c in r_coupons.json() if c["code"] == code), None)
    assert cpn is not None
    assert cpn["usage_count"] == 1


# ── Stock transfer workflow ────────────────────────────────────────────────────

def test_stock_transfer_verifies_both_branches(admin_token):
    """
    Transfer 5 units br-001 → br-003.
    Source stock decreases, destination stock increases.
    """
    r_br1 = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-001",
                          headers={"Authorization": f"Bearer {admin_token}"})
    r_br3 = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-003",
                          headers={"Authorization": f"Bearer {admin_token}"})

    items_br1 = r_br1.json()["items"]
    items_br3 = r_br3.json()["items"]
    if not items_br1 or not items_br3:
        pytest.skip("Panadol Extra not found in both branches")

    med_id = items_br1[0]["id"]
    stock_br1_before = items_br1[0]["stock_quantity"]
    stock_br3_before = items_br3[0]["stock_quantity"]
    qty = 3

    r_tr = requests.post(f"{BASE}/transfers/",
                          json={
                              "from_branch_id": "br-001",
                              "to_branch_id": "br-003",
                              "medicine_id": med_id,
                              "qty": qty,
                              "notes": "E2E transfer test"
                          },
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r_tr.status_code == 201
    assert r_tr.json()["status"] == "COMPLETED"

    # Verify stock
    r_br1_after = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-001",
                                headers={"Authorization": f"Bearer {admin_token}"})
    r_br3_after = requests.get(f"{BASE}/medicines?search=Panadol+Extra&branch_id=br-003",
                                headers={"Authorization": f"Bearer {admin_token}"})

    stock_br1_after = r_br1_after.json()["items"][0]["stock_quantity"]
    stock_br3_after = r_br3_after.json()["items"][0]["stock_quantity"]

    assert stock_br1_after == stock_br1_before - qty, \
        f"Source: expected {stock_br1_before - qty}, got {stock_br1_after}"
    assert stock_br3_after == stock_br3_before + qty, \
        f"Dest: expected {stock_br3_before + qty}, got {stock_br3_after}"
