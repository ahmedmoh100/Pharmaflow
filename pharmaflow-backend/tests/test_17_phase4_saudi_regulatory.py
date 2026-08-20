"""
Test 17 — Phase 4 Saudi Regulatory Roadmap & Compliance Integrations
====================================================================
Validates all Saudi Tier 3 regulatory capabilities:
1. GS1 2D DataMatrix Barcode Parsing (GTIN, Lot, Expiry, Serial)
2. SFDA RSD Track & Trace, Event Logging, and Batch Recall POS Lockdown
3. NPHIES / Waseel Insurance Policy Registry, Co-pay Engine (with Capping), and Claims
4. Wasfaty MOH e-Prescription Lookup, OTP Challenge Verification, and Dispensing
5. Mada POS Payment Terminal Protocol, STAN, and Auth Code Logging
6. ZATCA Phase 2 UBL 2.1 XML Generation, Canonical SHA-256 Digest, and 9-Tag TLV QR
"""

import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager
import pytest
from fastapi.testclient import TestClient

from main import app
from db.connection import get_connection, release_connection

client = TestClient(app)


@contextmanager
def db_conn():
    c = get_connection()
    try:
        yield c
    finally:
        release_connection(c)


def _admin_token():
    res = client.post("/auth/login", json={"email": "admin@demo.pharmaflow", "password": "Demo@1234"})
    assert res.status_code == 200
    return res.json()["access_token"]


def _pharmacist_token():
    res = client.post("/auth/login", json={"email": "pharm1@demo.pharmaflow", "password": "Demo@1234"})
    assert res.status_code == 200
    return res.json()["access_token"]


# ==============================================================================
# 1. GS1 2D DataMatrix Barcode Parsing Tests
# ==============================================================================
def test_gs1_barcode_parsing_bracketed():
    token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Standard GS1 DataMatrix with (01) GTIN, (17) Expiry, (10) Lot, (21) Serial
    raw_barcode = "(01)06281033745002(17)261231(10)LOT998811(21)SN776655"
    resp = client.post("/sfda/barcode/parse", json={"barcode": raw_barcode}, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["gtin"] == "06281033745002"
    assert data["expiry_date"] == "2026-12-31"
    assert data["batch_number"] == "LOT998811"
    assert data["serial_number"] == "SN776655"
    assert data["is_valid"] is True


def test_gs1_barcode_parsing_day_zero_and_delimiters():
    token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Expiry 260200 (Day 00 defaults to end of February 2026 -> 2026-02-28)
    raw_barcode = "0106281033745002\x1d17260200\x1d10LOTFEB26\x1d21SN1234"
    resp = client.post("/sfda/barcode/parse", json={"barcode": raw_barcode}, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["gtin"] == "06281033745002"
    assert data["expiry_date"] == "2026-02-28"
    assert data["batch_number"] == "LOTFEB26"
    assert data["is_valid"] is True


def test_gs1_barcode_invalid_rejection():
    token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post("/sfda/barcode/parse", json={"barcode": "INVALID_CORRUPTED_CODE"}, headers=headers)
    assert resp.status_code == 400
    assert "Missing required GS1 identifiers" in resp.json()["detail"]


# ==============================================================================
# 2. SFDA RSD Track & Trace & Batch Recall POS Lockdown
# ==============================================================================
def test_sfda_batch_recall_and_pos_lockdown():
    admin_token = _admin_token()
    pharm_token = _pharmacist_token()
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    pharm_headers = {"Authorization": f"Bearer {pharm_token}"}

    now = datetime.now(timezone.utc)
    med_id = f"med-sfda-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-sfda-{uuid.uuid4().hex[:8]}"
    batch_no = f"SFDA-REC-{uuid.uuid4().hex[:6]}"

    try:
        # Create test medicine and batch
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO medicines
                       (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                       VALUES (%s, %s, %s, %s, 'tablets', 30.00, 'zero', 1, 10)""",
                    (med_id, f"SFDA Med {med_id}", "دواء هيئة الغذاء", "6281033745099"),
                )
                cur.execute(
                    """INSERT INTO batches
                       (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, sfda_status, created_at)
                       VALUES (%s, %s, 'br-001', %s, %s, 10, 10, 15.00, 'active', 'active', %s)""",
                    (batch_id, med_id, batch_no, (now + timedelta(days=365)).date(), now),
                )
            conn.commit()

        # 1. Quarantine batch
        q_resp = client.post(
            f"/sfda/batches/{batch_id}/quarantine",
            json={"reason": "Suspected temperature excursion during transit"},
            headers=admin_headers,
        )
        assert q_resp.status_code == 200
        assert q_resp.json()["status"] == "quarantined"

        # 2. Release batch
        rel_resp = client.post(
            f"/sfda/batches/{batch_id}/release",
            json={"reason": "Inspection cleared by Quality Assurance"},
            headers=admin_headers,
        )
        assert rel_resp.status_code == 200
        assert rel_resp.json()["status"] == "active"

        # 3. Issue SFDA Regulatory Recall
        rec_resp = client.post(
            f"/sfda/batches/{batch_id}/recall",
            json={"reason": "Emergency SFDA Recall Directive #9982"},
            headers=admin_headers,
        )
        assert rec_resp.status_code == 200
        assert rec_resp.json()["status"] == "recalled"

        # 4. Attempt POS checkout of recalled batch -> MUST BE BLOCKED
        sale_resp = client.post(
            "/sales",
            json={
                "branch_id": "br-001",
                "payment_method": "cash",
                "items": [{
                    "medicine_id": med_id,
                    "quantity": 1,
                    "unit_price": 30.00,
                }],
            },
            headers=pharm_headers,
        )
        assert sale_resp.status_code == 400
        assert "RECALLED" in sale_resp.json()["detail"] or "Insufficient stock" in sale_resp.json()["detail"]

        # 5. Verify SFDA audit log contains the events
        events_resp = client.get(f"/sfda/events?batch_number={batch_no}", headers=admin_headers)
        assert events_resp.status_code == 200
        events = events_resp.json()["events"]
        assert len(events) >= 3
        types = [e["event_type"] for e in events]
        assert "QUARANTINE" in types and "RELEASE" in types and "RECALL" in types

    finally:
        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM sfda_rsd_events WHERE batch_number = %s", (batch_no,))
                    cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                    cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
                conn.commit()
        except Exception:
            pass


# ==============================================================================
# 3. NPHIES / Waseel Insurance Policy & Co-Pay Engine Tests
# ==============================================================================
def test_insurance_copay_engine_and_claims():
    admin_token = _admin_token()
    pharm_token = _pharmacist_token()
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    pharm_headers = {"Authorization": f"Bearer {pharm_token}"}

    now = datetime.now(timezone.utc)
    cust_id = f"cust-ins-{uuid.uuid4().hex[:8]}"
    payer_id = f"PAYER-{uuid.uuid4().hex[:6]}"
    med_id = f"med-ins-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-ins-{uuid.uuid4().hex[:8]}"
    policy_id = None
    sale_id = None

    try:
        # Create Customer and Medicine with Stock
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO customers
                       (id, name_en, name_ar, phone, national_id, credit_limit, current_balance, is_credit_allowed, created_at, updated_at)
                       VALUES (%s, 'Insured Patient', 'مريض مؤمن', %s, %s, 0.00, 0.00, 0, %s, %s)""",
                    (cust_id, f"+9665{uuid.uuid4().hex[:8]}", f"1{uuid.uuid4().hex[:9]}", now, now),
                )
                cur.execute(
                    """INSERT INTO medicines
                       (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                       VALUES (%s, %s, %s, %s, 'tablets', 100.00, 'zero', 1, 50)""",
                    (med_id, f"Insurance Med {med_id}", "دواء تأمين", f"BAR-{med_id[:8]}"),
                )
                cur.execute(
                    """INSERT INTO batches
                       (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                       VALUES (%s, %s, 'br-001', %s, %s, 50, 50, 50.00, 'active', %s)""",
                    (batch_id, med_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), now),
                )
            conn.commit()

        # 1. Register Insurance Provider
        prov_resp = client.post(
            "/insurance/providers",
            json={
                "name_en": "Bupa Arabia",
                "name_ar": "بوبا العربية",
                "nphies_payer_id": payer_id,
                "contact_email": "claims@bupa.com.sa",
            },
            headers=admin_headers,
        )
        assert prov_resp.status_code == 201
        prov_id = prov_resp.json()["id"]

        # 2. Register Patient Policy: 20% co-pay, capped at 50.00 SAR
        pol_resp = client.post(
            "/insurance/policies",
            json={
                "customer_id": cust_id,
                "provider_id": prov_id,
                "policy_number": f"POL-{uuid.uuid4().hex[:8].upper()}",
                "member_id": f"MEM-{uuid.uuid4().hex[:6].upper()}",
                "copay_percent": 20.00,
                "max_copay_amount": 50.00,
                "valid_until": (now + timedelta(days=365)).strftime("%Y-%m-%d"),
            },
            headers=pharm_headers,
        )
        assert pol_resp.status_code == 201
        policy_id = pol_resp.json()["id"]

        # 3. Test Eligibility Check (Scenario A: 100 SAR total -> 20 SAR patient, 80 SAR insurance)
        elig_resp1 = client.post(
            "/insurance/eligibility",
            json={"customer_id": cust_id, "total_amount": 100.00},
            headers=pharm_headers,
        )
        assert elig_resp1.status_code == 200
        assert elig_resp1.json()["is_eligible"] is True
        assert elig_resp1.json()["patient_share"] == 20.00
        assert elig_resp1.json()["insurance_share"] == 80.00

        # 4. Test Eligibility Check (Scenario B: 400 SAR total -> 20% is 80 > 50 cap -> Patient share is exactly 50.00 SAR)
        elig_resp2 = client.post(
            "/insurance/eligibility",
            json={"customer_id": cust_id, "total_amount": 400.00},
            headers=pharm_headers,
        )
        assert elig_resp2.status_code == 200
        assert elig_resp2.json()["patient_share"] == 50.00  # Capped at 50 SAR
        assert elig_resp2.json()["insurance_share"] == 350.00

        # 5. Pre-authorization
        preauth_resp = client.post(
            "/insurance/claims/preauth",
            json={"policy_id": policy_id, "total_amount": 100.00, "items": [{"medicine_id": med_id, "quantity": 1}]},
            headers=pharm_headers,
        )
        assert preauth_resp.status_code == 200
        preauth_code = preauth_resp.json()["pre_auth_code"]
        assert "NPHIES-AUTH" in preauth_code

        # 6. Execute POS Insurance Checkout
        sale_resp = client.post(
            "/sales",
            json={
                "branch_id": "br-001",
                "customer_id": cust_id,
                "payment_method": "insurance",
                "pre_auth_code": preauth_code,
                "items": [{
                    "medicine_id": med_id,
                    "quantity": 1,
                    "unit_price": 100.00,
                }],
            },
            headers=pharm_headers,
        )
        assert sale_resp.status_code == 201
        sale_data = sale_resp.json()
        sale_id = sale_data["id"]
        assert sale_data["insurance_claim"] is not None
        assert sale_data["insurance_claim"]["patient_share"] == 20.00
        assert sale_data["insurance_claim"]["insurance_share"] == 80.00

        # 7. Check Insurance Claims list
        claims_resp = client.get("/insurance/claims", headers=admin_headers)
        assert claims_resp.status_code == 200
        assert claims_resp.json()["count"] >= 1

    finally:
        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    if sale_id:
                        cur.execute("DELETE FROM insurance_claims WHERE sale_id = %s", (sale_id,))
                        cur.execute("DELETE FROM sale_items WHERE sale_id = %s", (sale_id,))
                        cur.execute("DELETE FROM sales WHERE id = %s", (sale_id,))
                    if policy_id:
                        cur.execute("DELETE FROM patient_insurance_policies WHERE id = %s", (policy_id,))
                    cur.execute("DELETE FROM insurance_providers WHERE nphies_payer_id = %s", (payer_id,))
                    cur.execute("DELETE FROM customers WHERE id = %s", (cust_id,))
                    cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                    cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
                conn.commit()
        except Exception:
            pass


# ==============================================================================
# 4. Wasfaty e-Prescription Lookup, OTP Challenge & Dispensing
# ==============================================================================
def test_wasfaty_eprescription_otp_and_dispense():
    pharm_token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {pharm_token}"}
    now = datetime.now(timezone.utc)

    wasfaty_rx_id = f"WASF-RX-{uuid.uuid4().hex[:8].upper()}"
    national_id = f"1{uuid.uuid4().hex[:9]}"
    med_id = f"med-wasf-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-wasf-{uuid.uuid4().hex[:8]}"

    try:
        # Create medicine and stock
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO medicines
                       (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                       VALUES (%s, %s, %s, %s, 'tablets', 45.00, 'zero', 1, 10)""",
                    (med_id, f"Wasfaty Med {med_id}", "دواء وصفتي", f"BAR-{med_id[:8]}"),
                )
                cur.execute(
                    """INSERT INTO batches
                       (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                       VALUES (%s, %s, 'br-001', %s, %s, 10, 10, 20.00, 'active', %s)""",
                    (batch_id, med_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), now),
                )
            conn.commit()

        # 1. Register incoming Wasfaty e-prescription
        create_rx_resp = client.post(
            "/wasfaty/prescriptions",
            json={
                "wasfaty_rx_id": wasfaty_rx_id,
                "patient_national_id": national_id,
                "patient_name": "Tariq Wasfaty Patient",
                "patient_phone": "+966551234567",
                "doctor_name": "Dr. Wasfaty Consultant",
                "doctor_license": "DOC-MOH-8899",
                "items": [{
                    "medicine_id": med_id,
                    "quantity": 2,
                    "dosage": "1 tablet BID",
                }],
            },
            headers=headers,
        )
        assert create_rx_resp.status_code == 201

        # 2. Look up prescription
        lookup_resp = client.post(
            "/wasfaty/lookup",
            json={"wasfaty_rx_id": wasfaty_rx_id, "patient_national_id": national_id},
            headers=headers,
        )
        assert lookup_resp.status_code == 200
        assert lookup_resp.json()["patient_name"] == "Tariq Wasfaty Patient"
        assert lookup_resp.json()["otp_verified"] is False

        # 3. Trigger OTP
        otp_resp = client.post(f"/wasfaty/send-otp?wasfaty_rx_id={wasfaty_rx_id}", headers=headers)
        assert otp_resp.status_code == 200
        otp_code = otp_resp.json()["otp_code"]

        # 4. Attempt dispense before OTP verification -> Rejected (400)
        premature_disp = client.post("/wasfaty/dispense", json={"wasfaty_rx_id": wasfaty_rx_id}, headers=headers)
        assert premature_disp.status_code == 400
        assert "Patient OTP has not been verified" in premature_disp.json()["detail"]

        # 5. Verify OTP with incorrect code -> Rejected (400)
        bad_otp_resp = client.post("/wasfaty/verify-otp", json={"wasfaty_rx_id": wasfaty_rx_id, "otp_code": "0000"}, headers=headers)
        assert bad_otp_resp.status_code == 400

        # 6. Verify OTP with correct code -> Success
        good_otp_resp = client.post("/wasfaty/verify-otp", json={"wasfaty_rx_id": wasfaty_rx_id, "otp_code": otp_code}, headers=headers)
        assert good_otp_resp.status_code == 200
        assert good_otp_resp.json()["status"] == "OTP_VERIFIED"

        # 7. Dispense Wasfaty e-prescription
        disp_resp = client.post("/wasfaty/dispense", json={"wasfaty_rx_id": wasfaty_rx_id, "branch_id": "br-001"}, headers=headers)
        assert disp_resp.status_code == 200
        assert disp_resp.json()["status"] == "DISPENSED"

        # 8. Check remaining batch stock (10 - 2 = 8)
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT qty_remaining FROM batches WHERE id = %s", (batch_id,))
                assert cur.fetchone()["qty_remaining"] == 8

        # 9. Attempt second dispense -> Blocked (400)
        dup_disp = client.post("/wasfaty/dispense", json={"wasfaty_rx_id": wasfaty_rx_id}, headers=headers)
        assert dup_disp.status_code == 400
        assert "already been dispensed" in dup_disp.json()["detail"]

    finally:
        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM wasfaty_prescriptions WHERE wasfaty_rx_id = %s", (wasfaty_rx_id,))
                    cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                    cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
                conn.commit()
        except Exception:
            pass


# ==============================================================================
# 5. Mada POS Payment Terminal Protocol & Logging
# ==============================================================================
def test_mada_terminal_integration():
    pharm_token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {pharm_token}"}

    # 1. Check Terminal Status
    status_resp = client.get("/mada/terminals/status", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "ONLINE"

    # 2. Initiate Terminal Transaction
    init_resp = client.post("/mada/transactions/initiate", json={"amount": 75.50}, headers=headers)
    assert init_resp.status_code == 200
    txn_ref = init_resp.json()["transaction_reference"]

    # 3. Process Approved Card Payment
    proc_resp = client.post(
        "/mada/transactions/process",
        json={
            "transaction_reference": txn_ref,
            "amount": 75.50,
            "simulate_action": "APPROVE",
            "card_scheme": "MADA",
        },
        headers=headers,
    )
    assert proc_resp.status_code == 200
    res_data = proc_resp.json()
    assert res_data["status"] == "APPROVED"
    assert res_data["auth_code"].startswith("AUTH")
    assert res_data["card_scheme"] == "MADA"
    assert "5888" in res_data["masked_pan"]

    # 4. Verify Log Entry in Database
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM mada_terminal_logs WHERE stan = %s", (res_data["stan"],))
            log_row = cur.fetchone()
            assert log_row is not None
            assert log_row["status"] == "APPROVED"
            assert float(log_row["amount"]) == 75.50

    # 5. Test Declined Transaction Handling
    init_decl = client.post("/mada/transactions/initiate", json={"amount": 50.00}, headers=headers)
    ref_decl = init_decl.json()["transaction_reference"]
    decl_resp = client.post(
        "/mada/transactions/process",
        json={
            "transaction_reference": ref_decl,
            "amount": 50.00,
            "simulate_action": "DECLINE",
            "card_scheme": "VISA",
        },
        headers=headers,
    )
    assert decl_resp.status_code == 400
    assert "declined" in decl_resp.json()["detail"].lower()


# ==============================================================================
# 6. ZATCA Phase 2 UBL 2.1 XML, Digest Hash, & 9-Tag TLV Validation
# ==============================================================================
def test_zatca_phase2_xml_and_hash_integrity():
    pharm_token = _pharmacist_token()
    headers = {"Authorization": f"Bearer {pharm_token}"}
    now = datetime.now(timezone.utc)

    med_id = f"med-zatca-{uuid.uuid4().hex[:8]}"
    batch_id = f"bat-zatca-{uuid.uuid4().hex[:8]}"
    sale_id = None

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO medicines
                       (id, name_en, name_ar, barcode, category, selling_price, vat_category, is_active, stock_quantity)
                       VALUES (%s, %s, %s, %s, 'tablets', 100.00, 'standard', 1, 10)""",
                    (med_id, f"ZATCA Med {med_id}", "دواء زكاة", f"BAR-{med_id[:8]}"),
                )
                cur.execute(
                    """INSERT INTO batches
                       (id, medicine_id, branch_id, batch_number, expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                       VALUES (%s, %s, 'br-001', %s, %s, 10, 10, 50.00, 'active', %s)""",
                    (batch_id, med_id, f"BAT-{batch_id[:8]}", (now + timedelta(days=365)).date(), now),
                )
            conn.commit()

        # 1. Create Sale (Standard 15% VAT: Subtotal 100, VAT 15, Total 115)
        sale_resp = client.post(
            "/sales",
            json={
                "branch_id": "br-001",
                "payment_method": "mada",
                "items": [{
                    "medicine_id": med_id,
                    "quantity": 1,
                    "unit_price": 100.00,
                }],
            },
            headers=headers,
        )
        assert sale_resp.status_code == 201
        sale_data = sale_resp.json()
        sale_id = sale_data["id"]

        # 2. Check ZATCA Phase 2 fields on response
        assert sale_data["zatca_status"] == "REPORTED"
        assert sale_data["zatca_hash"] is not None
        assert len(sale_data["zatca_hash"]) == 64  # Valid SHA-256 hex string
        assert sale_data["zatca_tlv"] is not None

        # 3. Retrieve UBL 2.1 XML Document via GET /sales/{id}/zatca-xml
        xml_resp = client.get(f"/sales/{sale_id}/zatca-xml", headers=headers)
        assert xml_resp.status_code == 200
        xml_data = xml_resp.json()
        xml_content = xml_data["zatca_xml"]
        assert "<Invoice" in xml_content
        assert "<cbc:InvoiceTypeCode" in xml_content
        assert "<cac:LegalMonetaryTotal" in xml_content

        # 4. Verify Canonical SHA-256 Digest Integrity
        recomputed_hash = hashlib.sha256(xml_content.encode("utf-8")).hexdigest()
        assert recomputed_hash == sale_data["zatca_hash"]

        # 5. Decode and verify TLV Base64 QR Code
        tlv_raw = base64.b64decode(sale_data["zatca_tlv"])
        assert len(tlv_raw) > 20
        # Tag 1 (Seller Name)
        assert tlv_raw[0] == 1
        tag1_len = tlv_raw[1]
        seller_name = tlv_raw[2:2+tag1_len].decode("utf-8")
        assert "PharmaFlow" in seller_name

    finally:
        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    if sale_id:
                        cur.execute("DELETE FROM sale_items WHERE sale_id = %s", (sale_id,))
                        cur.execute("DELETE FROM sales WHERE id = %s", (sale_id,))
                    cur.execute("DELETE FROM batches WHERE medicine_id = %s", (med_id,))
                    cur.execute("DELETE FROM medicines WHERE id = %s", (med_id,))
                conn.commit()
        except Exception:
            pass
