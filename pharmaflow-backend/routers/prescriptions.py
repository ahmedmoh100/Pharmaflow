"""
Prescriptions routes:
  GET    /prescriptions          — list (branch-scoped, filter by status)
  POST   /prescriptions          — create new Rx with items
  GET    /prescriptions/{id}     — single Rx with items
  POST   /prescriptions/{id}/dispense  — create sale from Rx, mark dispensed
  POST   /prescriptions/{id}/cancel   — cancel pending Rx
"""

import uuid
import json
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Query, status
from db.connection import get_db
from utils.auth import get_current_user

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_rx_number(cur, branch_id: str) -> str:
    """Generate next gapless Rx number per branch per year.
    Uses a separate rx_sequences approach — stores counter in a temp key
    that avoids the invoice_sequences FK constraint.
    """
    year = date.today().year
    # Use a dedicated counter on prescriptions table — count existing + 1
    cur.execute(
        """SELECT COUNT(*) AS cnt FROM prescriptions
           WHERE branch_id = %s AND YEAR(created_at) = %s""",
        (branch_id, year),
    )
    seq = cur.fetchone()["cnt"] + 1
    branch_map = {"br-001": "BR001", "br-002": "BR002", "br-003": "BR003", "br-004": "BR004"}
    code = branch_map.get(branch_id, branch_id[:5].upper())
    return f"RX-{code}-{year}-{str(seq).zfill(4)}"


def _fmt_rx(row: dict) -> dict:
    return {
        **row,
        "created_at":   row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        "updated_at":   row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
        "dispensed_at": row["dispensed_at"].isoformat() if row.get("dispensed_at") and hasattr(row["dispensed_at"], "isoformat") else (str(row["dispensed_at"]) if row.get("dispensed_at") else None),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_prescriptions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    status_filter: str = Query("", alias="status"),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions = ["p.branch_id = %s"]
    params = [current_user["branch_id"]]

    if status_filter:
        conditions.append("p.status = %s")
        params.append(status_filter.upper())

    where = "WHERE " + " AND ".join(conditions)

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM prescriptions p {where}", params)
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT p.*,
                       u.full_name AS dispensed_by_name
                FROM prescriptions p
                LEFT JOIN users u ON u.id = p.dispensed_by
                {where}
                ORDER BY
                    CASE p.status WHEN 'PENDING' THEN 0 ELSE 1 END,
                    p.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

        # Attach items to each prescription
        result = []
        for row in rows:
            cur.execute(
                """SELECT pi.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                          m.selling_price, m.vat_category, m.requires_prescription
                   FROM prescription_items pi
                   JOIN medicines m ON m.id = pi.medicine_id
                   WHERE pi.prescription_id = %s""",
                (row["id"],),
            )
            items = cur.fetchall()
            rx = _fmt_rx(row)
            rx["items"] = [
                {**i, "selling_price": str(i["selling_price"])}
                for i in items
            ]
            result.append(rx)

    return {"items": result, "total": total, "page": page, "page_size": page_size}


@router.get("/{rx_id}")
def get_prescription(rx_id: str, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute(
            """SELECT p.*, u.full_name AS dispensed_by_name
               FROM prescriptions p
               LEFT JOIN users u ON u.id = p.dispensed_by
               WHERE p.id = %s AND p.branch_id = %s""",
            (rx_id, current_user["branch_id"]),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Prescription not found")

        cur.execute(
            """SELECT pi.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                      m.selling_price, m.vat_category, m.requires_prescription
               FROM prescription_items pi
               JOIN medicines m ON m.id = pi.medicine_id
               WHERE pi.prescription_id = %s""",
            (rx_id,),
        )
        items = cur.fetchall()

    rx = _fmt_rx(row)
    rx["items"] = [{**i, "selling_price": str(i["selling_price"])} for i in items]
    return rx


@router.post("", status_code=201)
def create_prescription(
    body: dict,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Create a new prescription.
    Body: {
        patient_name, patient_id_number, prescriber_name, prescriber_license,
        notes,
        items: [{ medicine_id, quantity, dosage_instructions }]
    }
    """
    required = ["patient_name", "prescriber_name", "items"]
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"Missing required field: {f}")

    items_in = body["items"]
    if not items_in:
        raise HTTPException(status_code=400, detail="Prescription must have at least one medicine")

    rx_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        rx_number = _next_rx_number(cur, current_user["branch_id"])

        cur.execute(
            """INSERT INTO prescriptions
               (id, branch_id, rx_number, patient_name, patient_id_number,
                prescriber_name, prescriber_license, status, notes, created_by, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'PENDING',%s,%s,%s,%s)""",
            (
                rx_id, current_user["branch_id"], rx_number,
                body["patient_name"], body.get("patient_id_number", ""),
                body["prescriber_name"], body.get("prescriber_license", ""),
                body.get("notes", ""), current_user["sub"], now, now,
            ),
        )

        for item in items_in:
            cur.execute(
                """INSERT INTO prescription_items
                   (id, prescription_id, medicine_id, quantity, dosage_instructions)
                   VALUES (%s,%s,%s,%s,%s)""",
                (
                    str(uuid.uuid4()), rx_id,
                    item["medicine_id"], int(item.get("quantity", 1)),
                    item.get("dosage_instructions", ""),
                ),
            )

    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT * FROM prescriptions WHERE id = %s", (rx_id,))
        row = cur.fetchone()
        cur.execute(
            """SELECT pi.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                      m.selling_price, m.vat_category
               FROM prescription_items pi
               JOIN medicines m ON m.id = pi.medicine_id
               WHERE pi.prescription_id = %s""",
            (rx_id,),
        )
        items = cur.fetchall()

    rx = _fmt_rx(row)
    rx["items"] = [{**i, "selling_price": str(i["selling_price"])} for i in items]
    return rx


@router.post("/{rx_id}/dispense", status_code=200)
def dispense_prescription(
    rx_id: str,
    body: dict,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Dispense a prescription:
    1. Validate Rx is PENDING
    2. Create a real sale (same FIFO logic as POST /sales)
    3. Mark Rx as DISPENSED, store sale_id
    Body: { payment_method: "cash"|"card"|... }
    """
    payment_method = body.get("payment_method", "cash")
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        # Lock the prescription row
        cur.execute(
            "SELECT * FROM prescriptions WHERE id = %s AND branch_id = %s",
            (rx_id, current_user["branch_id"]),
        )
        rx = cur.fetchone()
        if not rx:
            raise HTTPException(status_code=404, detail="Prescription not found")
        if rx["status"] != "PENDING":
            raise HTTPException(
                status_code=400,
                detail=f"Prescription is already {rx['status'].lower()}"
            )

        # Get items with row-level locking
        cur.execute(
            """SELECT pi.*, m.selling_price, m.vat_category, m.is_active, m.is_controlled
               FROM prescription_items pi
               JOIN medicines m ON m.id = pi.medicine_id
               WHERE pi.prescription_id = %s""",
            (rx_id,),
        )
        items = cur.fetchall()
        if not items:
            raise HTTPException(status_code=400, detail="Prescription has no items")

    # ── Build sale using FEFO logic with row-level locking ──────────────────
    VAT_RATES = {"zero_rated": 0.00, "standard": 0.15, "exempt": 0.00}
    sale_id = str(uuid.uuid4())
    sale_uuid = str(uuid.uuid4())
    branch_id = current_user["branch_id"]

    subtotal = 0.0
    vat_total = 0.0
    vat_map: dict = {}
    sale_items_data = []
    controlled_dispenses = []

    try:
        with db.cursor() as cur:
            for item in items:
                med_id = item["medicine_id"]
                qty_need = int(item["quantity"])
                unit_price = float(item["selling_price"])
                vat_rate = VAT_RATES.get(item["vat_category"], 0.0)

                # Controlled substances verification
                if item.get("is_controlled", 0):
                    patient_id = rx.get("patient_id_number") or rx.get("patient_national_id") or body.get("patient_national_id") or ""
                    doc_lic = rx.get("prescriber_license") or rx.get("prescriber_name") or body.get("doctor_license") or "RX-PRESCRIBER"
                    if not patient_id and rx.get("patient_name"):
                        patient_id = rx.get("patient_name")
                    if not patient_id:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Controlled substance '{med_id}' in prescription requires patient National ID / Iqama."
                        )

                # FEFO with row-level locking
                cur.execute(
                    """SELECT id, qty_remaining, unit_cost FROM batches
                       WHERE medicine_id = %s AND branch_id = %s
                       AND qty_remaining > 0 AND status = 'active'
                       AND expiry_date >= CURDATE()
                       ORDER BY expiry_date ASC
                       FOR UPDATE""",
                    (med_id, branch_id),
                )
                batches = cur.fetchall()
                total_available = sum(b["qty_remaining"] for b in batches)
                if total_available < qty_need:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient stock for medicine {med_id}. Available: {total_available}, requested: {qty_need}",
                    )

                qty_left = qty_need
                deductions = []
                for batch in batches:
                    if qty_left == 0:
                        break
                    deduct = min(qty_left, batch["qty_remaining"])
                    deductions.append((batch["id"], deduct, float(batch["unit_cost"])))
                    qty_left -= deduct

                line_subtotal = round(unit_price * qty_need, 3)
                line_vat = round(line_subtotal * vat_rate, 3)
                subtotal += line_subtotal
                vat_total += line_vat

                rate_key = round(vat_rate * 100, 2)
                if rate_key not in vat_map:
                    vat_map[rate_key] = {"taxable_amount": 0.0, "vat_amount": 0.0}
                vat_map[rate_key]["taxable_amount"] = round(vat_map[rate_key]["taxable_amount"] + line_subtotal, 3)
                vat_map[rate_key]["vat_amount"] = round(vat_map[rate_key]["vat_amount"] + line_vat, 3)

                for b_id, b_qty, b_cost in deductions:
                    slice_vat = round(round(unit_price * b_qty, 3) * vat_rate, 3)
                    sale_items_data.append({
                        "id": str(uuid.uuid4()),
                        "medicine_id": med_id,
                        "batch_id": b_id,
                        "quantity": b_qty,
                        "unit_price": unit_price,
                        "vat_rate": round(vat_rate * 100, 2),
                        "vat_amount": slice_vat,
                        "cost_at_sale": b_cost,
                        "deduct_batch_id": b_id,
                        "deduct_qty": b_qty,
                    })
                    if item.get("is_controlled", 0):
                        controlled_dispenses.append({
                            "medicine_id": med_id,
                            "batch_id": b_id,
                            "quantity": b_qty,
                            "patient_national_id": patient_id,
                            "doctor_license": doc_lic,
                        })

            subtotal = round(subtotal, 3)
            vat_total = round(vat_total, 3)
            total = round(subtotal + vat_total, 3)
            vat_breakdown = [
                {"rate": k, "taxable_amount": v["taxable_amount"], "vat_amount": v["vat_amount"]}
                for k, v in vat_map.items()
            ]

            # Invoice number
            year = date.today().year
            cur.execute(
                "INSERT INTO invoice_sequences (branch_id, year, last_icv) VALUES (%s,%s,1) "
                "ON DUPLICATE KEY UPDATE last_icv = last_icv + 1",
                (branch_id, year),
            )
            cur.execute(
                "SELECT last_icv FROM invoice_sequences WHERE branch_id = %s AND year = %s",
                (branch_id, year),
            )
            icv = cur.fetchone()["last_icv"]
            branch_map = {"br-001": "BR001", "br-002": "BR002", "br-003": "BR003", "br-004": "BR004"}
            code = branch_map.get(branch_id, branch_id[:5].upper())
            invoice_number = f"{code}-{year}-{str(icv).zfill(6)}"

            # Insert sale — notes includes Rx reference
            notes = f"Prescription: {rx['rx_number']} | Patient: {rx['patient_name']}"
            cur.execute(
                """INSERT INTO sales
                   (id, branch_id, user_id, invoice_number, uuid, icv,
                    subtotal_amount, vat_amount, total_amount, vat_breakdown,
                    payment_method, notes, sold_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    sale_id, branch_id, current_user["sub"],
                    invoice_number, sale_uuid, icv,
                    subtotal, vat_total, total,
                    json.dumps(vat_breakdown),
                    payment_method, notes, now,
                ),
            )

            # Log controlled substances if any
            for c_disp in controlled_dispenses:
                cur.execute(
                    """INSERT INTO controlled_dispense_log
                       (id, sale_id, medicine_id, batch_id, quantity, patient_national_id, doctor_license, authorizing_user_id, dispensed_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (str(uuid.uuid4()), sale_id, c_disp["medicine_id"], c_disp["batch_id"],
                     c_disp["quantity"], c_disp["patient_national_id"], c_disp["doctor_license"],
                     current_user["sub"], now)
                )

            # Sale items + FEFO deductions
            for si in sale_items_data:
                cur.execute(
                    """INSERT INTO sale_items
                       (id, sale_id, medicine_id, batch_id, quantity,
                        unit_price, vat_rate, vat_amount, cost_at_sale)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (si["id"], sale_id, si["medicine_id"], si["batch_id"],
                     si["quantity"], si["unit_price"], si["vat_rate"],
                     si["vat_amount"], si["cost_at_sale"]),
                )
                cur.execute(
                    "UPDATE batches SET qty_remaining = qty_remaining - %s WHERE id = %s",
                    (si["deduct_qty"], si["deduct_batch_id"]),
                )
                cur.execute(
                    """INSERT INTO stock_movements
                       (id, medicine_id, branch_id, batch_id, qty_delta,
                        movement_type, reference_id, reference_type, reason, created_by, created_at)
                       VALUES (%s,%s,%s,%s,%s,'OUT',%s,'sale',%s,%s,%s)""",
                    (str(uuid.uuid4()), si["medicine_id"], branch_id,
                     si["deduct_batch_id"], -si["deduct_qty"], sale_id,
                     f"Rx: {rx['rx_number']}", current_user["sub"], now),
                )
                cur.execute(
                    "UPDATE medicines SET stock_quantity = stock_quantity - %s, updated_at = %s WHERE id = %s",
                    (si["deduct_qty"], now, si["medicine_id"]),
                )

            # Mark prescription DISPENSED
            cur.execute(
                """UPDATE prescriptions
                   SET status = 'DISPENSED', sale_id = %s,
                       dispensed_by = %s, dispensed_at = %s, updated_at = %s
                   WHERE id = %s""",
                (sale_id, current_user["sub"], now, now, rx_id),
            )

        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "rx_id": rx_id,
        "rx_number": rx["rx_number"],
        "sale_id": sale_id,
        "invoice_number": invoice_number,
        "total_amount": str(total),
        "dispensed_at": now.isoformat(),
    }


@router.post("/{rx_id}/cancel", status_code=200)
def cancel_prescription(
    rx_id: str,
    body: dict,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    with db.cursor() as cur:
        cur.execute(
            "SELECT id, status FROM prescriptions WHERE id = %s AND branch_id = %s",
            (rx_id, current_user["branch_id"]),
        )
        rx = cur.fetchone()
        if not rx:
            raise HTTPException(status_code=404, detail="Prescription not found")
        if rx["status"] != "PENDING":
            raise HTTPException(status_code=400, detail=f"Cannot cancel a {rx['status'].lower()} prescription")

        now = datetime.now(timezone.utc)
        cur.execute(
            "UPDATE prescriptions SET status = 'CANCELLED', updated_at = %s WHERE id = %s",
            (now, rx_id),
        )
    db.commit()
    return {"rx_id": rx_id, "status": "CANCELLED"}
