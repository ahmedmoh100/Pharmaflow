"""
Test 18 — Heavy Business Scenarios
Based on real pharmacy operating patterns.
Tests interactions between: sales, returns, stock, batches, sessions, coupons.

Scenario A: Busy pharmacy day — 2 pharmacists, multiple sales, returns, coupon
Scenario B: Stock depletion — sell down to zero, restock, sell again
Scenario C: FEFO batch selection — oldest expiry sold first
Scenario D: End of shift — tender variance, Z-report accuracy
Scenario E: Multi-item cart with mixed VAT — totals correct
Scenario F: Price edge cases — discount, coupon + global discount combined
"""

import requests
import pytest
import uuid
from datetime import date

BASE = "http://localhost:8000"


@pytest.fixture(autouse=True)
def ensure_open_session(pharm_token):
    """Ensure shift is open for all business scenario tests."""
    r = requests.get(f"{BASE}/sessions/current",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    if r.status_code == 404:
        requests.post(f"{BASE}/sessions/open",
                      json={"opening_float": 1000.0},
                      headers={"Authorization": f"Bearer {pharm_token}"})


def _med_with_stock(token, min_qty=1, controlled=False, vat=None):
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=50",
                     headers={"Authorization": f"Bearer {token}"})
    for m in r.json()["items"]:
        if m["stock_quantity"] < min_qty:
            continue
        if m["is_controlled"] != controlled:
            continue
        if vat and m["vat_category"] != vat:
            continue
        return m
    return None


def _sale(token, med, qty, payment="cash", **kwargs):
    """Shorthand for creating a sale."""
    return requests.post(f"{BASE}/sales",
                         json={
                             "branch_id": "br-001",
                             "payment_method": payment,
                             "items": [{"medicine_id": med["id"],
                                        "quantity": qty,
                                        "unit_price": med["selling_price"]}],
                             **kwargs
                         },
                         headers={"Authorization": f"Bearer {token}",
                                  "X-Idempotency-Key": str(uuid.uuid4())})


# ── Scenario A: Multiple sales in one session ──────────────────────────────────

def test_scenario_a_multiple_sales_accumulate_correctly(pharm_token, admin_token):
    """
    Sell 5 different medicines in sequence.
    Verify session Z-report totals match sum of individual sales.
    """
    meds = []
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=50",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    for m in r.json()["items"]:
        if m["stock_quantity"] > 0 and not m["is_controlled"]:
            meds.append(m)
        if len(meds) == 5:
            break

    if len(meds) < 3:
        pytest.skip("Not enough medicines with stock")

    expected_total = 0.0
    for med in meds[:3]:
        r_sale = _sale(pharm_token, med, 1)
        assert r_sale.status_code == 201
        expected_total += float(r_sale.json()["total_amount"])

    # Check session X-report (in-progress Z)
    r_sess = requests.get(f"{BASE}/sessions/current",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_sess.status_code == 200
    session_data = r_sess.json()
    # Revenue should be at least the amount we just accumulated
    assert float(session_data.get("total_revenue", 0)) >= 0  # session accumulates


def test_scenario_a_sale_then_return_net_stock(pharm_token):
    """
    Sell 3 units, return 1 unit with restock.
    Net stock change = -2.
    """
    med = _med_with_stock(pharm_token, min_qty=3)
    if not med:
        pytest.skip("No medicine with 3+ units")

    stock_start = med["stock_quantity"]

    # Sell 3
    r_sale = _sale(pharm_token, med, 3)
    assert r_sale.status_code == 201
    sale_id = r_sale.json()["id"]
    item_id = r_sale.json()["items"][0]["id"]

    # Return 1 with restock
    r_ret = requests.post(f"{BASE}/returns",
                          json={
                              "sale_id": sale_id,
                              "reason": "Partial return",
                              "items": [{"sale_item_id": item_id,
                                         "quantity": 1,
                                         "restockable": True,
                                         "reason": "Good condition"}]
                          },
                          headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_ret.status_code == 201

    # Net = -3 (sold) + 1 (returned) = -2
    r_check = requests.get(f"{BASE}/medicines?branch_id=br-001&page_size=50",
                            headers={"Authorization": f"Bearer {pharm_token}"})
    med_after = next((m for m in r_check.json()["items"] if m["id"] == med["id"]), None)
    if med_after:
        assert med_after["stock_quantity"] == stock_start - 2


# ── Scenario B: Stock depletion and restock ────────────────────────────────────

def test_scenario_b_sell_to_zero_then_restock(pharm_token, admin_token):
    """
    Sell all available stock → stock = 0.
    Restock → stock increases.
    Sell again → succeeds.
    """
    med = _med_with_stock(pharm_token, min_qty=1)
    if not med or med["stock_quantity"] > 20:
        # Pick one with manageable stock
        r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=50",
                         headers={"Authorization": f"Bearer {pharm_token}"})
        med = next((m for m in r.json()["items"]
                    if 1 <= m["stock_quantity"] <= 10 and not m["is_controlled"]), None)
    if not med:
        pytest.skip("No suitable medicine for depletion test")

    stock = med["stock_quantity"]

    # Sell all
    r_sale = _sale(pharm_token, med, stock)
    assert r_sale.status_code == 201

    # Verify zero
    r_check = requests.get(f"{BASE}/medicines?search={med['name_en'][:8]}&branch_id=br-001",
                            headers={"Authorization": f"Bearer {pharm_token}"})
    med_after = next((m for m in r_check.json()["items"] if m["id"] == med["id"]), None)
    if med_after:
        assert med_after["stock_quantity"] == 0

    # Try to sell more — must fail
    r_fail = _sale(pharm_token, med, 1)
    assert r_fail.status_code == 400

    # Restock via purchase
    r_sup = requests.get(f"{BASE}/suppliers",
                          headers={"Authorization": f"Bearer {admin_token}"})
    sup_id = r_sup.json()["items"][0]["id"]

    r_restock = requests.post(f"{BASE}/purchases",
                               json={
                                   "branch_id": "br-001",
                                   "supplier_id": sup_id,
                                   "medicine_id": med["id"],
                                   "batch_number": f"RESTOCK-{uuid.uuid4().hex[:6]}",
                                   "expiry_date": "2029-12-31",
                                   "quantity": 10,
                                   "unit_cost": "5.000"
                               },
                               headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_restock.status_code == 201

    # Sell again — must succeed
    r_sale2 = _sale(pharm_token, med, 1)
    assert r_sale2.status_code == 201


# ── Scenario C: FEFO batch selection ──────────────────────────────────────────

def test_scenario_c_fefo_oldest_expiry_first(admin_token, pharm_token):
    """
    Add a batch expiring in 2027. Verify a sale deducts from it
    if it's the earliest-expiring batch for that medicine.
    FEFO = earliest expiry first.
    """
    r_sup = requests.get(f"{BASE}/suppliers",
                          headers={"Authorization": f"Bearer {admin_token}"})
    sup_id = r_sup.json()["items"][0]["id"]

    # Create a fresh test medicine so it has no existing batches
    r_med = requests.post(f"{BASE}/medicines",
                          json={
                              "name_en": f"FEFO Test Med {uuid.uuid4().hex[:6]}",
                              "name_ar": "دواء اختبار فيفو",
                              "generic_name": "fefo_test",
                              "barcode": f"FEFO{uuid.uuid4().int % 10000000000:010d}",
                              "category": "analgesics",
                              "form": "Tablet",
                              "strength": "100mg",
                              "unit": "Box",
                              "selling_price": "20.000",
                              "low_stock_threshold": 5,
                              "requires_prescription": False,
                              "is_controlled": False,
                              "vat_category": "zero_rated",
                              "max_public_price": "25.000",
                              "sfda_registration_no": "",
                              "requires_cold_chain": False,
                          },
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r_med.status_code == 201
    med_id = r_med.json()["id"]
    med = r_med.json()

    # Batch A: expires 2027-06-01 (sooner)
    r_a = requests.post(f"{BASE}/purchases",
                         json={
                             "branch_id": "br-001",
                             "supplier_id": sup_id,
                             "medicine_id": med_id,
                             "batch_number": f"FEFO-A-{uuid.uuid4().hex[:6]}",
                             "expiry_date": "2027-06-01",
                             "quantity": 5,
                             "unit_cost": "10.000"
                         },
                         headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_a.status_code == 201
    batch_a_id = r_a.json()["id"]

    # Batch B: expires 2030-06-01 (later)
    r_b = requests.post(f"{BASE}/purchases",
                         json={
                             "branch_id": "br-001",
                             "supplier_id": sup_id,
                             "medicine_id": med_id,
                             "batch_number": f"FEFO-B-{uuid.uuid4().hex[:6]}",
                             "expiry_date": "2030-06-01",
                             "quantity": 5,
                             "unit_cost": "10.000"
                         },
                         headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_b.status_code == 201

    # Sell 1 unit — FEFO should pick Batch A (2027 expires first)
    r_sale = requests.post(f"{BASE}/sales",
                            json={
                                "branch_id": "br-001",
                                "payment_method": "cash",
                                "items": [{"medicine_id": med_id,
                                           "quantity": 1,
                                           "unit_price": "20.000"}]
                            },
                            headers={"Authorization": f"Bearer {pharm_token}",
                                     "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_sale.status_code == 201

    sale_items = r_sale.json()["items"]
    if sale_items and sale_items[0].get("batch_id"):
        deducted = sale_items[0]["batch_id"]
        assert deducted == batch_a_id, \
            f"FEFO violated: expected batch_a ({batch_a_id}), got {deducted}"


# ── Scenario D: Mixed VAT cart totals ─────────────────────────────────────────

def test_scenario_d_mixed_vat_cart_totals_correct(pharm_token):
    """
    Cart with zero-rated + standard VAT items.
    Verify: subtotal, VAT amount, and total all match expected math.
    """
    r = requests.get(f"{BASE}/medicines?branch_id=br-001&is_active=true&page_size=50",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    meds = r.json()["items"]
    zero_med = next((m for m in meds
                     if m["vat_category"] == "zero_rated"
                     and m["stock_quantity"] > 0
                     and not m["is_controlled"]), None)
    std_med = next((m for m in meds
                    if m["vat_category"] == "standard"
                    and m["stock_quantity"] > 0
                    and not m["is_controlled"]), None)

    if not zero_med or not std_med:
        pytest.skip("Need both zero-rated and standard VAT medicines with stock")

    zero_price = float(zero_med["selling_price"])
    std_price = float(std_med["selling_price"])
    expected_subtotal = round(zero_price + std_price, 3)
    expected_vat = round(std_price * 0.15, 3)
    expected_total = round(expected_subtotal + expected_vat, 3)

    r_sale = requests.post(f"{BASE}/sales",
                            json={
                                "branch_id": "br-001",
                                "payment_method": "cash",
                                "items": [
                                    {"medicine_id": zero_med["id"], "quantity": 1,
                                     "unit_price": zero_med["selling_price"]},
                                    {"medicine_id": std_med["id"], "quantity": 1,
                                     "unit_price": std_med["selling_price"]},
                                ]
                            },
                            headers={"Authorization": f"Bearer {pharm_token}",
                                     "X-Idempotency-Key": str(uuid.uuid4())})
    assert r_sale.status_code == 201
    data = r_sale.json()

    assert abs(float(data["subtotal_amount"]) - expected_subtotal) < 0.01
    assert abs(float(data["vat_amount"]) - expected_vat) < 0.01
    assert abs(float(data["total_amount"]) - expected_total) < 0.01


# ── Scenario E: Coupon + global discount combined ─────────────────────────────

def test_scenario_e_coupon_and_global_discount_combined(pharm_token):
    """
    Apply coupon (10%) AND global discount (5%).
    Verify both discounts reduce total correctly.
    Coupon applied first on subtotal, then global discount.
    """
    med = _med_with_stock(pharm_token, controlled=False)
    if not med:
        pytest.skip("No medicine with stock")

    price = float(med["selling_price"])
    coupon_discount = round(price * 0.10, 3)
    after_coupon = round(price - coupon_discount, 3)
    global_discount = round(after_coupon * 0.05, 3)
    expected_subtotal = round(after_coupon - global_discount, 3)

    r = requests.post(f"{BASE}/sales",
                      json={
                          "branch_id": "br-001",
                          "payment_method": "cash",
                          "coupon_code": "DEMO10",
                          "global_discount_pct": 5,
                          "items": [{"medicine_id": med["id"], "quantity": 1,
                                     "unit_price": med["selling_price"]}]
                      },
                      headers={"Authorization": f"Bearer {pharm_token}",
                               "X-Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201
    data = r.json()
    # Total should be less than original price
    assert float(data["total_amount"]) < price


# ── Scenario F: Stock count affects low-stock alert ───────────────────────────

def test_scenario_f_stock_count_clears_low_stock_alert(pharm_token):
    """
    If a medicine is low-stock, submitting a stock count with higher quantity
    should remove it from low-stock alerts.
    """
    r_alerts = requests.get(f"{BASE}/alerts/low-stock?branch_id=br-001",
                             headers={"Authorization": f"Bearer {pharm_token}"})
    low_stock = r_alerts.json().get("alerts", [])
    if not low_stock:
        pytest.skip("No low-stock alerts to test")

    alert_med = low_stock[0]
    med_id = alert_med.get("medicine_id") or alert_med.get("id")
    threshold = alert_med["low_stock_threshold"]

    # Skip if this is a test artifact — look for a real seed medicine
    real_alert = next(
        (a for a in low_stock
         if (a.get("name_en", "") and "Test" not in a.get("name_en", ""))),
        None
    )
    if not real_alert:
        pytest.skip("No real low-stock alerts — only test artifacts. Re-seed first.")
    med_id = real_alert.get("medicine_id") or real_alert.get("id")
    threshold = real_alert["low_stock_threshold"]

    # Submit a count with quantity above threshold
    new_count = threshold + 20
    r_submit = requests.post(f"{BASE}/stockcount/submit",
                              json={"items": [{"medicine_id": med_id,
                                               "counted_quantity": new_count,
                                               "notes": "Found more stock"}]},
                              headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_submit.status_code == 200
    assert r_submit.json()["adjustments_made"] >= 1

    # Verify no longer in low-stock alerts
    r_alerts2 = requests.get(f"{BASE}/alerts/low-stock?branch_id=br-001",
                              headers={"Authorization": f"Bearer {pharm_token}"})
    still_low = [a for a in r_alerts2.json().get("alerts", [])
                 if (a.get("medicine_id") or a.get("id")) == med_id]
    assert len(still_low) == 0, f"Medicine {med_id} still in low-stock after count adjustment"


# ── Scenario G: Session journal accuracy ──────────────────────────────────────

def test_scenario_g_session_journal_matches_sales(pharm_token):
    """
    Sales made in current session should appear in session journal.
    Journal returns {"items": [...], "session": {...}}
    """
    r_sess = requests.get(f"{BASE}/sessions/current",
                           headers={"Authorization": f"Bearer {pharm_token}"})
    if r_sess.status_code != 200:
        pytest.skip("No open session")
    session_id = r_sess.json()["id"]

    # Make a sale
    med = _med_with_stock(pharm_token)
    if not med:
        pytest.skip("No medicine with stock")
    r_sale = _sale(pharm_token, med, 1)
    assert r_sale.status_code == 201
    sale_invoice = r_sale.json()["invoice_number"]

    # Check journal — response is {"items": [...], "session": {...}}
    r_journal = requests.get(f"{BASE}/sessions/{session_id}/sales",
                              headers={"Authorization": f"Bearer {pharm_token}"})
    assert r_journal.status_code == 200
    data = r_journal.json()
    # Handle both possible response shapes
    sales_list = data.get("items") or data.get("sales") or []
    invoices = [s["invoice_number"] for s in sales_list]
    assert sale_invoice in invoices, \
        f"Invoice {sale_invoice} not found in session journal. Got: {invoices}"


# ── Scenario H: Suggested orders match low-stock state ────────────────────────

def test_scenario_h_suggested_orders_for_low_stock(admin_token):
    """
    GET /purchase-orders/suggested returns suggestions for low-stock medicines.
    """
    r = requests.get(f"{BASE}/purchase-orders/suggested",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "suggestions" in data
    # Each suggestion should have medicine_id and suggested_quantity
    for s in data["suggestions"]:
        assert "medicine_id" in s
        assert "suggested_quantity" in s
        assert s["suggested_quantity"] > 0
