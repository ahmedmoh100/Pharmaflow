"""
Adversarial Concurrency & Row-Locking Test Suite
=================================================
Validates that `SELECT ... FOR UPDATE` row locks and transaction isolation
prevent race conditions, negative inventory, credit overdrafts, double-dispenses,
and duplicate transfers under true simultaneous multithreaded load.
"""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
import pytest
import pymysql
from fastapi.testclient import TestClient

from main import app
from db.connection import get_connection

client = TestClient(app)


def _admin_token():
    res = client.post("/auth/login", json={"email": "admin@demo.pharmaflow", "password": "Demo@1234"})
    assert res.status_code == 200, f"Login failed: {res.text}"
    return res.json()["access_token"]


def _pharmacist_token():
    res = client.post("/auth/login", json={"email": "pharm1@demo.pharmaflow", "password": "Demo@1234"})
    assert res.status_code == 200, f"Login failed: {res.text}"
    return res.json()["access_token"]


# ==============================================================================
# TEST 1: Inventory Batch Concurrency Race (Double-Spend Prevention)
# ==============================================================================
def test_concurrent_inventory_batch_deduction_race():
    """
    Scenario:
    - A single batch has qty_remaining = 5.
    - Two separate threads hit POST /sales at the exact same millisecond.
    - Thread 1 requests 4 units.
    - Thread 2 requests 4 units.
    - Total requested = 8 units (Available = 5).

    Expected Invariant:
    - Without FOR UPDATE: Both threads read qty_remaining = 5, both succeed, final qty becomes -3 (CORRUPTION).
    - With FOR UPDATE: Exactly ONE thread succeeds, the second thread fails with HTTP 400 (Insufficient stock).
    - Final database qty_remaining MUST be EXACTLY 1 (5 - 4).
    """
    token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {token}"}
    conn = get_connection()
    now = datetime.now(timezone.utc)

    med_id = f"med-race-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-race-{uuid.uuid4().hex[:8]}"
    branch_id = "br-001"
    initial_batch_qty = 5
    req_qty = 4

    try:
        # 1. Setup isolated medicine and batch
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO medicines
                   (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                   VALUES (%s, %s, %s, %s, 'tablets', 20.00, 'zero', 1, %s)""",
                (med_id, f"Race Med {med_id}", "دواء سباق", f"BAR-{med_id[:8]}", initial_batch_qty),
            )
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 10.00, 'active', %s)""",
                (batch_id, med_id, branch_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), initial_batch_qty, initial_batch_qty, now),
            )
        conn.commit()

        # 2. Prepare barrier to ensure simultaneous dispatch
        barrier = threading.Barrier(2)
        results = []

        def worker_sale(worker_idx: int):
            # Synchronize at barrier
            barrier.wait()
            resp = client.post(
                "/sales",
                json={
                    "branch_id": branch_id,
                    "payment_method": "cash",
                    "items": [{
                        "medicine_id": med_id,
                        "quantity": req_qty,
                        "unit_price": 20.00,
                    }],
                },
                headers=headers,
            )
            return {"worker": worker_idx, "status": resp.status_code, "body": resp.json()}

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(worker_sale, i) for i in range(2)]
            for f in as_completed(futures):
                results.append(f.result())

        # 3. Assertions on results
        status_codes = [r["status"] for r in results]
        print(f"\n[Test 1] Concurrency Results: {status_codes}")
        for r in results:
            print(f"  Worker {r['worker']}: status={r['status']}, body={r['body']}")

        # Exactly one must succeed (201/200) and one must be rejected (400)
        assert status_codes.count(200) + status_codes.count(201) == 1, f"Expected exactly 1 success, got {status_codes}"
        assert status_codes.count(400) == 1, f"Expected exactly 1 400 Insufficient Stock rejection, got {status_codes}"

        # 4. Assertions on Database State
        with conn.cursor() as cur:
            cur.execute("SELECT qty_remaining FROM batches WHERE id = %s", (batch_id,))
            final_batch_qty = cur.fetchone()["qty_remaining"]

            cur.execute("SELECT stock_quantity FROM medicines WHERE id = %s", (med_id,))
            final_med_qty = cur.fetchone()["stock_quantity"]

            cur.execute("SELECT COUNT(*) AS c FROM sales WHERE id IN (SELECT sale_id FROM sale_items WHERE medicine_id = %s)", (med_id,))
            sales_count = cur.fetchone()["c"]

        print(f"[Test 1] Initial: {initial_batch_qty}, Final Batch Qty: {final_batch_qty}, Med Qty: {final_med_qty}, Sales Count: {sales_count}")
        assert final_batch_qty == initial_batch_qty - req_qty == 1, f"Batch qty corrupted: {final_batch_qty}"
        assert final_med_qty == 1, f"Medicine stock cache corrupted: {final_med_qty}"
        assert sales_count == 1, f"Expected 1 completed sale, got {sales_count}"

    finally:
        # Cleanup
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM stock_movements WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM sale_items WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass


# ==============================================================================
# TEST 2: Customer Credit Limit Concurrency Race (Overdraft Prevention)
# ==============================================================================
def test_concurrent_customer_credit_limit_race():
    """
    Scenario:
    - Customer has credit_limit = 100.00 and current_balance = 0.00.
    - 3 simultaneous threads attempt credit purchases of 60.00 each (total 180.00 > 100.00).

    Expected Invariant:
    - Without FOR UPDATE: Multiple threads read balance = 0, all 3 pass, customer balance becomes 180.00 (CREDIT BREACH).
    - With FOR UPDATE: Thread 1 sets balance to 60.00 (<= 100). Thread 2 & 3 attempt 60 + 60 = 120 > 100 and are rejected with HTTP 400.
    - Final database current_balance MUST be EXACTLY 60.00 (<= 100.00).
    - Customer ledger MUST have EXACTLY 1 'CHARGE' transaction matching 60.00.
    """
    token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {token}"}
    conn = get_connection()
    now = datetime.now(timezone.utc)

    cust_id = f"cust-race-{uuid.uuid4().hex[:8]}"
    med_id = f"med-cred-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-cred-{uuid.uuid4().hex[:8]}"
    credit_limit = 100.00
    sale_price = 60.00

    try:
        # 1. Setup customer, medicine, large batch
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO customers
                   (id, name_en, name_ar, phone, national_id, credit_limit, current_balance, is_credit_allowed, created_at, updated_at)
                   VALUES (%s, 'Credit Race Cust', 'عميل السباق', %s, %s, %s, 0.00, 1, %s, %s)""",
                (cust_id, f"+9665{uuid.uuid4().hex[:8]}", f"1{uuid.uuid4().hex[:9]}", credit_limit, now, now),
            )
            cur.execute(
                """INSERT INTO medicines
                   (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                   VALUES (%s, %s, %s, %s, 'tablets', %s, 'zero', 1, 100)""",
                (med_id, f"Credit Med {med_id}", "دواء ائتمان", f"BAR-{med_id[:8]}", sale_price),
            )
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                   VALUES (%s, %s, 'br-001', %s, %s, 100, 100, 10.00, 'active', %s)""",
                (batch_id, med_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), now),
            )
        conn.commit()

        # 2. Dispatch 3 simultaneous credit sales
        num_threads = 3
        barrier = threading.Barrier(num_threads)
        results = []

        def worker_credit_sale(worker_idx: int):
            barrier.wait()
            resp = client.post(
                "/sales",
                json={
                    "branch_id": "br-001",
                    "customer_id": cust_id,
                    "payment_method": "credit",
                    "items": [{
                        "medicine_id": med_id,
                        "quantity": 1,
                        "unit_price": sale_price,
                    }],
                },
                headers=headers,
            )
            return {"worker": worker_idx, "status": resp.status_code, "body": resp.json()}

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(worker_credit_sale, i) for i in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # 3. Assertions
        status_codes = [r["status"] for r in results]
        print(f"\n[Test 2] Credit Concurrency Results: {status_codes}")
        for r in results:
            print(f"  Worker {r['worker']}: status={r['status']}, body={r['body']}")

        success_count = status_codes.count(200) + status_codes.count(201)
        fail_count = status_codes.count(400)

        assert success_count == 1, f"Expected exactly 1 credit sale to succeed, got {success_count} ({status_codes})"
        assert fail_count == 2, f"Expected 2 credit sales to fail with limit exceeded, got {fail_count} ({status_codes})"

        # 4. Check DB Customer and Ledger
        with conn.cursor() as cur:
            cur.execute("SELECT current_balance, credit_limit FROM customers WHERE id = %s", (cust_id,))
            cust_row = cur.fetchone()
            cur_bal = float(cust_row["current_balance"])

            cur.execute("SELECT COUNT(*) AS c, SUM(amount) as total_charged FROM customer_ledger WHERE customer_id = %s", (cust_id,))
            ledger_row = cur.fetchone()
            ledger_count = ledger_row["c"]
            total_charged = float(ledger_row["total_charged"] or 0.0)

        print(f"[Test 2] Limit: {credit_limit}, Final Balance: {cur_bal}, Ledger Count: {ledger_count}, Total Charged: {total_charged}")
        assert cur_bal == sale_price == 60.00, f"Customer balance corrupted: {cur_bal}"
        assert cur_bal <= credit_limit, f"Customer credit limit breached: {cur_bal} > {credit_limit}"
        assert ledger_count == 1, f"Expected exactly 1 ledger record, got {ledger_count}"
        assert total_charged == cur_bal == 60.00, f"Ledger does not match customer balance: {total_charged} vs {cur_bal}"

    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM customer_ledger WHERE customer_id = %s", (cust_id,))
                cur.execute("DELETE FROM customers WHERE id = %s", (cust_id,))
                cur.execute("DELETE FROM stock_movements WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM sale_items WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass


# ==============================================================================
# TEST 3: Inter-Branch Stock Transfer Concurrency Race
# ==============================================================================
def test_concurrent_stock_transfer_race():
    """
    Scenario:
    - Batch at br-001 has qty_remaining = 6.
    - Two simultaneous transfer requests to br-002 attempt to transfer 5 units each (total 10 > 6).

    Expected Invariant:
    - With FOR UPDATE on source batch: Exactly ONE transfer succeeds, the other fails with HTTP 400.
    - Source batch final qty_remaining MUST be EXACTLY 1 (6 - 5).
    - Destination branch receives exactly 5 units.
    """
    admin_token = _admin_token()
    headers = {"Authorization": f"Bearer {admin_token}"}
    conn = get_connection()
    now = datetime.now(timezone.utc)

    med_id = f"med-tx-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-tx-{uuid.uuid4().hex[:8]}"
    initial_qty = 6
    transfer_qty = 5

    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO medicines
                   (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                   VALUES (%s, %s, %s, %s, 'tablets', 15.00, 'zero', 1, %s)""",
                (med_id, f"Transfer Med {med_id}", "دواء نقل", f"BAR-{med_id[:8]}", initial_qty),
            )
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                   VALUES (%s, %s, 'br-001', %s, %s, %s, %s, 8.00, 'active', %s)""",
                (batch_id, med_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), initial_qty, initial_qty, now),
            )
        conn.commit()

        barrier = threading.Barrier(2)
        results = []

        def worker_transfer(worker_idx: int):
            barrier.wait()
            resp = client.post(
                "/transfers",
                json={
                    "from_branch_id": "br-001",
                    "to_branch_id": "br-002",
                    "medicine_id": med_id,
                    "batch_id": batch_id,
                    "qty": transfer_qty,
                    "reason": "Adversarial concurrency test transfer",
                },
                headers=headers,
            )
            return {"worker": worker_idx, "status": resp.status_code, "body": resp.json()}

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(worker_transfer, i) for i in range(2)]
            for f in as_completed(futures):
                results.append(f.result())

        status_codes = [r["status"] for r in results]
        print(f"\n[Test 3] Transfer Concurrency Results: {status_codes}")
        for r in results:
            print(f"  Worker {r['worker']}: status={r['status']}")

        success_count = status_codes.count(200) + status_codes.count(201)
        fail_count = status_codes.count(400)

        assert success_count == 1, f"Expected 1 transfer success, got {success_count} ({status_codes})"
        assert fail_count == 1, f"Expected 1 transfer failure (insufficient stock), got {fail_count} ({status_codes})"

        # Check DB State
        with conn.cursor() as cur:
            cur.execute("SELECT qty_remaining FROM batches WHERE id = %s", (batch_id,))
            src_qty = cur.fetchone()["qty_remaining"]

            cur.execute("SELECT COALESCE(SUM(qty_remaining), 0) AS dest_qty FROM batches WHERE medicine_id = %s AND branch_id = 'br-002'", (med_id,))
            dest_qty = cur.fetchone()["dest_qty"]

        print(f"[Test 3] Source Remaining: {src_qty}, Dest Received: {dest_qty}")
        assert src_qty == 1, f"Source batch corrupted: {src_qty}"
        assert dest_qty == 5, f"Destination batch corrupted: {dest_qty}"

    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM transfers WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM stock_movements WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass


# ==============================================================================
# TEST 4: Controlled Substance Prescription Dispense Concurrency Race
# ==============================================================================
def test_concurrent_controlled_prescription_dispense_race():
    """
    Scenario:
    - A prescription is created for 5 units of a controlled narcotic medicine.
    - Only 5 units exist in stock.
    - Two pharmacists attempt to dispense the same prescription at the same millisecond.

    Expected Invariant:
    - With FOR UPDATE on prescription and batch rows:
      - Exactly ONE pharmacist succeeds in dispensing (HTTP 200).
      - The other pharmacist receives HTTP 400 ('Prescription is already DISPENSED').
      - Exactly 5 units are deducted (stock becomes 0, never negative -5).
      - Exactly ONE set of records is written to controlled_dispense_log.
    """
    token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {token}"}
    conn = get_connection()
    now = datetime.now(timezone.utc)

    med_id = f"med-narc-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-narc-{uuid.uuid4().hex[:8]}"
    rx_id = None
    patient_id = f"1{uuid.uuid4().hex[:9]}"
    initial_qty = 5

    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO medicines
                   (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_controlled, is_active, stock_quantity)
                   VALUES (%s, %s, %s, %s, 'tablets', 50.00, 'zero', 1, 1, %s)""",
                (med_id, f"Narcotic Med {med_id}", "مخدر سباق", f"BAR-{med_id[:8]}", initial_qty),
            )
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                   VALUES (%s, %s, 'br-001', %s, %s, %s, %s, 25.00, 'active', %s)""",
                (batch_id, med_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), initial_qty, initial_qty, now),
            )
        conn.commit()

        # Create Prescription
        rx_resp = client.post(
            "/prescriptions",
            json={
                "branch_id": "br-001",
                "patient_name": "Controlled Concurrency Patient",
                "patient_id_number": patient_id,
                "patient_phone": "+966509998877",
                "prescriber_name": "Dr. Narcotic Specialist",
                "prescriber_license": "DOC-NARC-CONC",
                "items": [{
                    "medicine_id": med_id,
                    "quantity": initial_qty,
                    "dosage_instructions": "1 unit daily strictly",
                }],
            },
            headers=headers,
        )
        assert rx_resp.status_code == 201, f"Failed to create rx: {rx_resp.text}"
        rx_id = rx_resp.json()["id"]

        barrier = threading.Barrier(2)
        results = []

        def worker_dispense(worker_idx: int):
            barrier.wait()
            resp = client.post(
                f"/prescriptions/{rx_id}/dispense",
                json={
                    "payment_method": "cash",
                    "patient_national_id": patient_id,
                    "doctor_license": "DOC-NARC-CONC",
                },
                headers=headers,
            )
            return {"worker": worker_idx, "status": resp.status_code, "body": resp.json()}

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(worker_dispense, i) for i in range(2)]
            for f in as_completed(futures):
                results.append(f.result())

        status_codes = [r["status"] for r in results]
        print(f"\n[Test 4] Rx Dispense Concurrency Results: {status_codes}")
        for r in results:
            print(f"  Worker {r['worker']}: status={r['status']}, body={r['body']}")

        success_count = status_codes.count(200) + status_codes.count(201)
        fail_count = status_codes.count(400)

        assert success_count == 1, f"Expected exactly 1 dispense success, got {success_count} ({status_codes})"
        assert fail_count == 1, f"Expected 1 already-dispensed rejection, got {fail_count} ({status_codes})"

        # Check DB State
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM prescriptions WHERE id = %s", (rx_id,))
            rx_status = cur.fetchone()["status"]

            cur.execute("SELECT qty_remaining FROM batches WHERE id = %s", (batch_id,))
            batch_rem = cur.fetchone()["qty_remaining"]

            cur.execute("SELECT COUNT(*) AS c, SUM(quantity) as tot FROM controlled_dispense_log WHERE medicine_id = %s", (med_id,))
            cdl_row = cur.fetchone()
            cdl_count = cdl_row["c"]
            cdl_tot = cdl_row["tot"]

        print(f"[Test 4] Rx Status: {rx_status}, Batch Rem: {batch_rem}, CDL Count: {cdl_count}, CDL Total: {cdl_tot}")
        assert rx_status == "DISPENSED", f"Expected rx DISPENSED, got {rx_status}"
        assert batch_rem == 0, f"Expected batch qty 0, got {batch_rem}"
        assert cdl_count == 1, f"Expected 1 controlled dispense record, got {cdl_count}"
        assert cdl_tot == 5, f"Expected 5 units logged to controlled registry, got {cdl_tot}"

    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM controlled_dispense_log WHERE medicine_id = %s", (med_id,))
                if rx_id:
                    cur.execute("DELETE FROM prescription_items WHERE prescription_id = %s", (rx_id,))
                    cur.execute("DELETE FROM prescriptions WHERE id = %s", (rx_id,))
                cur.execute("DELETE FROM stock_movements WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM sale_items WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass

