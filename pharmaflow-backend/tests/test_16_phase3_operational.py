"""
Tests for Phase 3 Operational MVP Features:
- Controlled substances register & dual authorization
- Customer credit limits, house credit checkout, and accounts receivable ledger
- Granular RBAC roles
- Connection pool resilience
"""

import uuid
import pytest
from fastapi.testclient import TestClient
from main import app
from db.connection import get_connection

client = TestClient(app)


def get_token(role="admin", email=None):
    with get_connection() as conn:
        with conn.cursor() as cur:
            if email:
                cur.execute("SELECT id, role, branch_id, email FROM users WHERE email = %s", (email,))
            else:
                cur.execute("SELECT id, role, branch_id, email FROM users WHERE role = %s LIMIT 1", (role,))
            user = cur.fetchone()

    from utils.auth import create_access_token
    token = create_access_token({
        "sub": user["id"],
        "role": user["role"],
        "branch_id": user["branch_id"] or "br-001",
        "email": user["email"],
    })
    return token, user


def test_connection_pool_health():
    """Verify pooled connections yield healthy responses and real DB pool connection."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["database_pool"] == "connected"


def test_controlled_substance_workflow():
    """Verify restricted/controlled drug requires patient ID and logs to registry on POS and Prescriptions."""
    admin_token, admin_user = get_token("admin")
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a controlled substance medicine
    barcode = f"NARC-{uuid.uuid4().hex[:8]}"
    create_med_resp = client.post(
        "/medicines",
        json={
            "name_en": "Morphine Sulfate 10mg",
            "name_ar": "مورفين سلفات 10 مجم",
            "generic_name": "Morphine",
            "barcode": barcode,
            "category": "Analgesics",
            "form": "Ampoule",
            "strength": "10mg/ml",
            "unit": "Ampoule",
            "selling_price": "45.000",
            "low_stock_threshold": 5,
            "requires_prescription": True,
            "is_controlled": True,
            "vat_category": "zero_rated",
        },
        headers=headers,
    )
    assert create_med_resp.status_code == 201
    med_data = create_med_resp.json()
    med_id = med_data["id"]
    assert med_data["is_controlled"] is True

    # 2. Add stock via purchase
    purchase_resp = client.post(
        "/purchases",
        json={
            "branch_id": "br-001",
            "supplier_id": "sup-001",
            "medicine_id": med_id,
            "batch_number": f"BATCH-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2028-12-31",
            "quantity": 20,
            "unit_cost": "25.000",
        },
        headers=headers,
    )
    assert purchase_resp.status_code == 201

    # 3. Attempt POS sale without patient national ID -> MUST FAIL (400)
    failed_sale_resp = client.post(
        "/sales",
        json={
            "branch_id": "br-001",
            "payment_method": "cash",
            "items": [{
                "medicine_id": med_id,
                "quantity": 2,
                "unit_price": 45.0,
            }],
        },
        headers=headers,
    )
    assert failed_sale_resp.status_code == 400
    assert "restricted/controlled" in failed_sale_resp.json()["detail"]

    # 4. POS Sale with patient National ID & doctor license -> MUST SUCCEED (200/201)
    patient_id = "1098765432"
    success_sale_resp = client.post(
        "/sales",
        json={
            "branch_id": "br-001",
            "payment_method": "cash",
            "patient_national_id": patient_id,
            "doctor_license": "SFDA-DOC-9988",
            "items": [{
                "medicine_id": med_id,
                "quantity": 2,
                "unit_price": 45.0,
            }],
        },
        headers=headers,
    )
    assert success_sale_resp.status_code == 200 or success_sale_resp.status_code == 201

    # 5. Check controlled dispense registry
    reg_resp = client.get(f"/medicines/controlled/registry?patient_id={patient_id}", headers=headers)
    assert reg_resp.status_code == 200
    reg_items = reg_resp.json()["items"]
    assert len(reg_items) >= 1
    assert any(i["medicine_id"] == med_id for i in reg_items)

    # 6. Test Prescription Dispensing with Controlled Medicine
    rx_resp = client.post(
        "/prescriptions",
        json={
            "branch_id": "br-001",
            "patient_name": "Ahmed Patient",
            "patient_id_number": patient_id,
            "patient_phone": "+966501112233",
            "prescriber_name": "Dr. Controlled Specialist",
            "prescriber_license": "DOC-NARC-001",
            "items": [{
                "medicine_id": med_id,
                "quantity": 1,
                "dosage_instructions": "1 ampoule IV PRN",
            }],
        },
        headers=headers,
    )
    assert rx_resp.status_code == 201
    rx_id = rx_resp.json()["id"]

    # Dispense the prescription
    disp_resp = client.post(
        f"/prescriptions/{rx_id}/dispense",
        json={"payment_method": "cash"},
        headers=headers,
    )
    assert disp_resp.status_code == 200

    # Verify prescription dispense is also logged into controlled_dispense_log
    reg_resp2 = client.get(f"/medicines/controlled/registry?patient_id={patient_id}", headers=headers)
    assert reg_resp2.status_code == 200
    assert len(reg_resp2.json()["items"]) >= 2


def test_customer_house_credit_and_ledger():
    """Verify customer credit limits, POS credit checkout, returns balance crediting, and payment settlement."""
    admin_token, _ = get_token("admin")
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a customer with credit line
    cust_resp = client.post(
        "/customers",
        json={
            "name_en": f"VIP Corporate Client {uuid.uuid4().hex[:4]}",
            "name_ar": "عميل آجل معتمد",
            "phone": f"+9665{uuid.uuid4().hex[:8]}",
            "national_id": "1122334455",
            "credit_limit": 200.00,
            "is_credit_allowed": True,
        },
        headers=headers,
    )
    assert cust_resp.status_code == 201
    cust_data = cust_resp.json()
    cust_id = cust_data["id"]
    assert float(cust_data["credit_limit"]) == 200.00
    assert float(cust_data["current_balance"]) == 0.00
    assert cust_data["is_credit_allowed"] is True

    # 2. Get a standard medicine
    meds_resp = client.get("/medicines?page_size=1", headers=headers)
    med = meds_resp.json()["items"][0]

    # 3. Perform a sale on credit for 2 units
    sale_resp = client.post(
        "/sales",
        json={
            "branch_id": "br-001",
            "customer_id": cust_id,
            "payment_method": "credit",
            "items": [{
                "medicine_id": med["id"],
                "quantity": 2,
                "unit_price": float(med["selling_price"]),
            }],
        },
        headers=headers,
    )
    assert sale_resp.status_code == 200 or sale_resp.status_code == 201
    sale_data = sale_resp.json()
    sale_id = sale_data["id"]
    sale_total = float(sale_data["total_amount"])

    # 4. Verify updated customer balance
    get_cust_resp = client.get(f"/customers/{cust_id}", headers=headers)
    assert get_cust_resp.status_code == 200
    assert abs(float(get_cust_resp.json()["current_balance"]) - sale_total) < 0.01

    # 5. Check ledger history has CHARGE
    ledger_resp = client.get(f"/customers/{cust_id}/ledger", headers=headers)
    assert ledger_resp.status_code == 200
    ledger_items = ledger_resp.json()["items"]
    assert len(ledger_items) == 1
    assert ledger_items[0]["transaction_type"] == "CHARGE"

    # 6. Return 1 unit of the credit sale
    sale_item_id = sale_data["items"][0]["id"]
    ret_resp = client.post(
        "/returns",
        json={
            "sale_id": sale_id,
            "reason": "Customer changed mind",
            "items": [{
                "sale_item_id": sale_item_id,
                "quantity": 1,
                "restockable": True,
                "reason": "Customer changed mind",
            }],
        },
        headers=headers,
    )
    assert ret_resp.status_code in (200, 201)
    refund_amount = float(ret_resp.json()["total_refund"])

    # Verify customer balance decremented by refund amount
    get_cust_resp2 = client.get(f"/customers/{cust_id}", headers=headers)
    expected_bal_after_ret = round(sale_total - refund_amount, 2)
    assert abs(float(get_cust_resp2.json()["current_balance"]) - expected_bal_after_ret) < 0.01

    # Verify ledger has REFUND entry
    ledger_resp_after_ret = client.get(f"/customers/{cust_id}/ledger", headers=headers)
    assert len(ledger_resp_after_ret.json()["items"]) == 2
    types = [i["transaction_type"] for i in ledger_resp_after_ret.json()["items"]]
    assert "CHARGE" in types and "REFUND" in types

    # 7. Test overpayment rejection (paying more than remaining balance)
    overpay_resp = client.post(
        f"/customers/{cust_id}/payments",
        json={"amount": expected_bal_after_ret + 100.0, "notes": "Overpaying"},
        headers=headers,
    )
    assert overpay_resp.status_code == 400
    assert "exceed" in overpay_resp.json()["detail"].lower()

    # 8. Settle exact remaining balance
    pay_resp = client.post(
        f"/customers/{cust_id}/payments",
        json={"amount": expected_bal_after_ret, "notes": "Exact settlement"},
        headers=headers,
    )
    assert pay_resp.status_code == 201
    assert float(pay_resp.json()["new_balance"]) == 0.00


def test_granular_rbac_endpoint_enforcement():
    """Verify granular RBAC permissions across sensitive domain routes."""
    admin_token, _ = get_token("admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create auditor user
    auditor_email = f"auditor_{uuid.uuid4().hex[:6]}@demo.pharmaflow"
    client.post(
        "/users",
        json={
            "email": auditor_email,
            "password": "Password123!",
            "full_name": "Test Auditor",
            "role": "auditor",
            "branch_id": "br-001",
        },
        headers=admin_headers,
    )
    auditor_token, _ = get_token("auditor", email=auditor_email)
    auditor_headers = {"Authorization": f"Bearer {auditor_token}"}

    # Auditor CAN access /audit and /reports/sales
    assert client.get("/audit", headers=auditor_headers).status_code == 200
    assert client.get("/reports/sales", headers=auditor_headers).status_code == 200

    # Auditor CANNOT create purchases or sales (403)
    assert client.post("/purchases", json={}, headers=auditor_headers).status_code == 403
    assert client.post("/sales", json={}, headers=auditor_headers).status_code == 403

    # 2. Create inventory_manager user
    inv_email = f"inv_{uuid.uuid4().hex[:6]}@demo.pharmaflow"
    client.post(
        "/users",
        json={
            "email": inv_email,
            "password": "Password123!",
            "full_name": "Test Inv Manager",
            "role": "inventory_manager",
            "branch_id": "br-001",
        },
        headers=admin_headers,
    )
    inv_token, _ = get_token("inventory_manager", email=inv_email)
    inv_headers = {"Authorization": f"Bearer {inv_token}"}

    # Inventory Manager CAN access /purchase-orders/
    assert client.get("/purchase-orders/", headers=inv_headers).status_code == 200

    # Inventory Manager CANNOT access /audit or /sales (403)
    assert client.get("/audit", headers=inv_headers).status_code == 403
    assert client.post("/sales", json={}, headers=inv_headers).status_code == 403
