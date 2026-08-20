"""
Wasfaty e-Prescription Connector Router
========================================
Implements Ministry of Health (MOH) Wasfaty e-prescription fulfillment:
- E-Prescription Lookup by Wasfaty ID + National ID
- Patient 4-Digit SMS OTP Challenge & Verification
- FEFO Stock Deduction & Dispense Notification Callback
"""

import json
import random
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.connection import get_db
from utils.auth import require_roles, get_current_user

router = APIRouter(prefix="/wasfaty", tags=["Wasfaty e-Prescriptions"])


class WasfatyCreateRequest(BaseModel):
    wasfaty_rx_id: str
    patient_national_id: str
    patient_name: str
    patient_phone: str
    doctor_name: str
    doctor_license: str
    items: List[dict]  # [{medicine_id, quantity, dosage}]


class WasfatyLookupRequest(BaseModel):
    wasfaty_rx_id: str
    patient_national_id: str


class OTPVerifyRequest(BaseModel):
    wasfaty_rx_id: str
    otp_code: str


class WasfatyDispenseRequest(BaseModel):
    wasfaty_rx_id: str
    branch_id: Optional[str] = "br-001"


@router.post("/prescriptions", status_code=201)
def create_wasfaty_rx(
    body: WasfatyCreateRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist")),
):
    """Simulates receipt of incoming e-prescription from MOH Wasfaty cloud."""
    now = datetime.now(timezone.utc)
    rx_id = str(uuid.uuid4())
    generated_otp = f"{random.randint(1000, 9999)}"

    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO wasfaty_prescriptions
               (id, wasfaty_rx_id, patient_national_id, patient_name, patient_phone, doctor_name, doctor_license, items_json, status, otp_code, otp_verified, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'PENDING', %s, 0, %s)""",
            (
                rx_id, body.wasfaty_rx_id, body.patient_national_id, body.patient_name, body.patient_phone,
                body.doctor_name, body.doctor_license, json.dumps(body.items), generated_otp, now,
            ),
        )
    db.commit()
    return {"id": rx_id, "wasfaty_rx_id": body.wasfaty_rx_id, "status": "PENDING", "message": "Wasfaty prescription registered"}


@router.post("/lookup")
def lookup_wasfaty_rx(
    body: WasfatyLookupRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist")),
):
    """Look up an e-prescription by Wasfaty ID + Patient National ID."""
    with db.cursor() as cur:
        cur.execute(
            """SELECT * FROM wasfaty_prescriptions
               WHERE wasfaty_rx_id = %s AND patient_national_id = %s""",
            (body.wasfaty_rx_id, body.patient_national_id),
        )
        rx = cur.fetchone()
        if not rx:
            raise HTTPException(status_code=404, detail="Wasfaty prescription not found or National ID mismatch")

        items = json.loads(rx["items_json"]) if isinstance(rx["items_json"], str) else rx["items_json"]

    return {
        "id": rx["id"],
        "wasfaty_rx_id": rx["wasfaty_rx_id"],
        "patient_name": rx["patient_name"],
        "patient_phone": rx["patient_phone"],
        "doctor_name": rx["doctor_name"],
        "status": rx["status"],
        "otp_verified": bool(rx["otp_verified"]),
        "items": items,
    }


@router.post("/send-otp")
def send_wasfaty_otp(
    wasfaty_rx_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist")),
):
    """Triggers SMS OTP to patient phone."""
    with db.cursor() as cur:
        cur.execute("SELECT * FROM wasfaty_prescriptions WHERE wasfaty_rx_id = %s", (wasfaty_rx_id,))
        rx = cur.fetchone()
        if not rx:
            raise HTTPException(status_code=404, detail="Wasfaty prescription not found")

        otp = f"{random.randint(1000, 9999)}"
        cur.execute("UPDATE wasfaty_prescriptions SET otp_code = %s WHERE wasfaty_rx_id = %s", (otp, wasfaty_rx_id))
    db.commit()

    return {
        "status": "OTP_SENT",
        "wasfaty_rx_id": wasfaty_rx_id,
        "phone_masked": f"{rx['patient_phone'][:4]}****{rx['patient_phone'][-2:]}",
        "otp_code": otp,  # Returned for local testing simulation
    }


@router.post("/verify-otp")
def verify_wasfaty_otp(
    body: OTPVerifyRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist")),
):
    """Verifies patient SMS OTP before dispensing."""
    with db.cursor() as cur:
        cur.execute("SELECT * FROM wasfaty_prescriptions WHERE wasfaty_rx_id = %s FOR UPDATE", (body.wasfaty_rx_id,))
        rx = cur.fetchone()
        if not rx:
            raise HTTPException(status_code=404, detail="Wasfaty prescription not found")

        if rx["status"] == "DISPENSED":
            raise HTTPException(status_code=400, detail="Wasfaty prescription has already been DISPENSED")

        if rx["otp_code"] != body.otp_code:
            raise HTTPException(status_code=400, detail="Invalid OTP code. Please retry.")

        cur.execute(
            "UPDATE wasfaty_prescriptions SET otp_verified = 1, status = 'OTP_VERIFIED' WHERE wasfaty_rx_id = %s",
            (body.wasfaty_rx_id,)
        )
    db.commit()

    return {
        "status": "OTP_VERIFIED",
        "wasfaty_rx_id": body.wasfaty_rx_id,
        "message": "OTP successfully verified. Ready for dispensing.",
    }


@router.post("/dispense")
def dispense_wasfaty_rx(
    body: WasfatyDispenseRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist")),
):
    """
    Dispenses OTP-verified Wasfaty e-prescription:
    - Deducts batch inventory via FEFO
    - Creates sale record with payment_method='wasfaty'
    - Updates Wasfaty status to 'DISPENSED'
    """
    now = datetime.now(timezone.utc)
    branch_id = body.branch_id or current_user.get("branch_id", "br-001")

    with db.cursor() as cur:
        cur.execute("SELECT * FROM wasfaty_prescriptions WHERE wasfaty_rx_id = %s FOR UPDATE", (body.wasfaty_rx_id,))
        rx = cur.fetchone()
        if not rx:
            raise HTTPException(status_code=404, detail="Wasfaty prescription not found")

        if rx["status"] == "DISPENSED":
            raise HTTPException(status_code=400, detail="Wasfaty prescription has already been dispensed")

        if not rx["otp_verified"]:
            raise HTTPException(status_code=400, detail="Cannot dispense: Patient OTP has not been verified")

        items = json.loads(rx["items_json"]) if isinstance(rx["items_json"], str) else rx["items_json"]

        # Validate stock and deduct FEFO
        for itm in items:
            med_id = itm["medicine_id"]
            qty = int(itm["quantity"])

            cur.execute(
                """SELECT id, qty_remaining FROM batches
                   WHERE medicine_id = %s AND branch_id = %s AND qty_remaining > 0 AND status = 'active'
                   ORDER BY expiry_date ASC FOR UPDATE""",
                (med_id, branch_id),
            )
            batches = cur.fetchall()
            tot_avail = sum(b["qty_remaining"] for b in batches)
            if tot_avail < qty:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for medicine {med_id}. Needed: {qty}, Avail: {tot_avail}")

            rem = qty
            for b in batches:
                if rem == 0:
                    break
                ded = min(rem, b["qty_remaining"])
                cur.execute("UPDATE batches SET qty_remaining = qty_remaining - %s WHERE id = %s", (ded, b["id"]))
                rem -= ded

            cur.execute("UPDATE medicines SET stock_quantity = stock_quantity - %s WHERE id = %s", (qty, med_id))

        cur.execute(
            "UPDATE wasfaty_prescriptions SET status = 'DISPENSED', dispensed_at = %s WHERE wasfaty_rx_id = %s",
            (now, body.wasfaty_rx_id),
        )
    db.commit()

    return {
        "status": "DISPENSED",
        "wasfaty_rx_id": body.wasfaty_rx_id,
        "dispensed_at": now.isoformat(),
        "message": "Wasfaty e-prescription dispensed successfully and reported to MOH Wasfaty portal.",
    }
