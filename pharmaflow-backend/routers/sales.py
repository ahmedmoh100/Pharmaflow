"""
Sales routes:
  GET  /sales        — paginated list (admin sees all, pharmacist sees own)
  GET  /sales/{id}   — sale detail with items
  POST /sales        — create sale (POS) — FIFO batch deduction + idempotency
"""

import uuid
import json
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from typing import Optional, List, Dict, Any
from db.connection import get_db
from utils.auth import get_current_user, require_roles
from utils.zatca_phase2 import generate_ubl_invoice_xml, compute_zatca_invoice_hash, generate_zatca_tlv_qr

router = APIRouter()

VAT_RATES = {"zero_rated": 0.00, "standard": 0.15, "exempt": 0.00}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_sale(row: dict) -> dict:
    return {
        **row,
        "subtotal_amount": str(row["subtotal_amount"]),
        "vat_amount":      str(row["vat_amount"]),
        "total_amount":    str(row["total_amount"]),
        "vat_breakdown":   json.loads(row["vat_breakdown"]) if isinstance(row["vat_breakdown"], str) else (row["vat_breakdown"] or []),
        "payment_lines":   json.loads(row["payment_lines"]) if isinstance(row.get("payment_lines"), str) else (row.get("payment_lines") or None),
        "sold_at":         row["sold_at"].isoformat() if hasattr(row["sold_at"], "isoformat") else str(row["sold_at"]),
        "has_return":      bool(row.get("has_return", 0)),
    }


def _next_icv(cur, branch_id: str) -> int:
    """Atomically increment and return the next ICV for this branch/year."""
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
    return cur.fetchone()["last_icv"]


def _invoice_number(branch_id: str, icv: int) -> str:
    branch_map = {"br-001": "BR001", "br-002": "BR002", "br-003": "BR003", "br-004": "BR004"}
    code = branch_map.get(branch_id, branch_id[:5].upper())
    year = date.today().year
    return f"{code}-{year}-{str(icv).zfill(6)}"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_sales(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    branch_id: str = Query(""),
    user_id: str = Query(""),
    from_date: str = Query(""),
    to_date: str = Query(""),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions: list[str] = []
    params: list = []

    # Pharmacists see only their own sales
    if current_user["role"] == "pharmacist":
        conditions.append("s.user_id = %s")
        params.append(current_user["sub"])
    elif user_id:
        conditions.append("s.user_id = %s")
        params.append(user_id)

    if branch_id:
        conditions.append("s.branch_id = %s")
        params.append(branch_id)

    if from_date:
        # Saudi timezone = UTC+3: local midnight = UTC 21:00 previous day
        conditions.append("s.sold_at >= DATE_SUB(%s, INTERVAL 3 HOUR)")
        params.append(from_date)

    if to_date:
        conditions.append("s.sold_at < DATE_ADD(%s, INTERVAL 21 HOUR)")
        params.append(to_date)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM sales s {where}", params)
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT s.*, u.full_name AS pharmacist_name,
                    EXISTS(SELECT 1 FROM sale_returns sr WHERE sr.sale_id = s.id) AS has_return
                FROM sales s
                LEFT JOIN users u ON u.id = s.user_id
                {where}
                ORDER BY s.sold_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {"items": [_fmt_sale(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{sale_id}")
def get_sale(sale_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute(
            """SELECT s.*, u.full_name AS pharmacist_name
               FROM sales s LEFT JOIN users u ON u.id = s.user_id
               WHERE s.id = %s""",
            (sale_id,),
        )
        sale = cur.fetchone()
        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        cur.execute(
            """SELECT si.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar
               FROM sale_items si
               LEFT JOIN medicines m ON m.id = si.medicine_id
               WHERE si.sale_id = %s""",
            (sale_id,),
        )
        items = cur.fetchall()

    def _fmt_item(i: dict) -> dict:
        return {
            **i,
            "unit_price":   str(i["unit_price"]),
            "vat_rate":     str(i["vat_rate"]),
            "vat_amount":   str(i["vat_amount"]),
            "cost_at_sale": str(i["cost_at_sale"]),
        }

    result = _fmt_sale(sale)
    result["items"] = [_fmt_item(i) for i in items]
    return result


@router.post("", status_code=201)
def create_sale(
    body: dict,
    x_idempotency_key: Optional[str] = Header(None),
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist", "cashier")),
):
    """
    Create a sale with FIFO batch deduction.
    Body: { branch_id, items: [{medicine_id, quantity, unit_price}], payment_method, notes }
    Header: X-Idempotency-Key (UUID) — prevents duplicate sales on double-submit.
    """
    # ── Idempotency check ─────────────────────────────────────────────────────
    if x_idempotency_key:
        with db.cursor() as cur:
            cur.execute("SELECT response_json FROM idempotency_keys WHERE key_value = %s", (x_idempotency_key,))
            existing = cur.fetchone()
        if existing:
            return json.loads(existing["response_json"])

    # ── Validate body ─────────────────────────────────────────────────────────
    items_in = body.get("items", [])
    if not items_in:
        raise HTTPException(status_code=400, detail="Cart is empty")

    branch_id      = body.get("branch_id") or current_user["branch_id"]
    payment_method = body.get("payment_method", "cash")
    payment_lines  = body.get("payment_lines") or None   # [{method, amount}] for split
    notes          = body.get("notes", "")
    customer_id    = body.get("customer_id") or None
    customer_name  = body.get("customer_name") or ""
    coupon_code    = body.get("coupon_code") or None  # NEW: coupon code for discount
    # Derive dominant payment_method from payment_lines if provided
    if payment_lines and isinstance(payment_lines, list) and len(payment_lines) > 0:
        dominant = max(payment_lines, key=lambda x: float(x.get("amount", 0)))
        payment_method = dominant.get("method", payment_method)
    now            = datetime.now(timezone.utc)
    sale_id        = str(uuid.uuid4())
    sale_uuid      = str(uuid.uuid4())

    subtotal = 0.0
    vat_total = 0.0
    vat_map: dict[float, dict] = {}
    sale_items_data = []

    try:
        with db.cursor() as cur:
            # ── 1. Validate coupon if provided (discount calculated after subtotal) ──
            coupon_id = None
            coupon_discount = 0.0
            coupon_row = None
            
            if coupon_code:
                cur.execute(
                    """SELECT id, type, discount_type, discount_value, max_uses, usage_count, valid_from, valid_until
                       FROM coupons WHERE code = %s AND is_active = 1""",
                    (coupon_code.upper(),)
                )
                coupon_row = cur.fetchone()
                if not coupon_row:
                    raise HTTPException(status_code=404, detail=f"Coupon '{coupon_code}' not found or inactive")
                
                coupon_id = coupon_row["id"]
                from datetime import date
                today = date.today()
                
                # Check validity dates
                if coupon_row["valid_from"] and today < coupon_row["valid_from"]:
                    raise HTTPException(status_code=400, detail=f"Coupon not valid until {coupon_row['valid_from']}")
                if coupon_row["valid_until"] and today > coupon_row["valid_until"]:
                    raise HTTPException(status_code=400, detail=f"Coupon expired on {coupon_row['valid_until']}")
                
                # Check usage limit
                if coupon_row["max_uses"] and coupon_row["usage_count"] >= coupon_row["max_uses"]:
                    raise HTTPException(status_code=400, detail="Coupon has reached maximum uses")
            
            # ── 2. Process cart items with FEFO batch deduction & row-level locking ──
            controlled_dispenses = []

            for item in items_in:
                med_id   = item["medicine_id"]
                qty_need = int(item["quantity"])
                unit_price = float(item["unit_price"])

                # Get medicine vat_category and lock row
                cur.execute(
                    "SELECT vat_category, is_controlled FROM medicines WHERE id = %s AND is_active = 1 FOR UPDATE",
                    (med_id,)
                )
                med_row = cur.fetchone()
                if not med_row:
                    raise HTTPException(status_code=404, detail=f"Medicine {med_id} not found")

                # Controlled substances verification
                if med_row.get("is_controlled", 0):
                    patient_id = body.get("patient_national_id") or ""
                    doc_lic = body.get("doctor_license") or ""
                    if not patient_id and customer_id:
                        cur.execute("SELECT national_id FROM customers WHERE id = %s", (customer_id,))
                        c_row = cur.fetchone()
                        if c_row and c_row.get("national_id"):
                            patient_id = c_row["national_id"]
                    if not patient_id:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Medicine '{med_id}' is a restricted/controlled drug requiring patient National ID/Iqama."
                        )

                vat_rate = VAT_RATES.get(med_row["vat_category"], 0.0)

                # FEFO with row-level locking: oldest non-expired batch with qty_remaining > 0 and SFDA active
                cur.execute(
                    """SELECT id, qty_remaining, unit_cost, sfda_status FROM batches
                       WHERE medicine_id = %s AND branch_id = %s
                       AND qty_remaining > 0 AND status = 'active'
                       AND (sfda_status IS NULL OR sfda_status = 'active')
                       AND expiry_date >= CURDATE()
                       ORDER BY expiry_date ASC
                       FOR UPDATE""",
                    (med_id, branch_id),
                )
                batches = cur.fetchall()

                total_available = sum(b["qty_remaining"] for b in batches)
                if total_available < qty_need:
                    # Check if failure is due to SFDA recall/quarantine
                    cur.execute(
                        """SELECT sfda_status, batch_number FROM batches
                           WHERE medicine_id = %s AND branch_id = %s AND sfda_status IN ('recalled', 'quarantined')""",
                        (med_id, branch_id),
                    )
                    sfda_blocked = cur.fetchall()
                    if sfda_blocked:
                        b_stat = sfda_blocked[0]["sfda_status"].upper()
                        raise HTTPException(
                            status_code=400,
                            detail=f"Medicine '{med_id}' (Batch {sfda_blocked[0]['batch_number']}) is {b_stat} by SFDA directive. Sale is blocked."
                        )
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient stock for medicine {med_id}. Available: {total_available}, requested: {qty_need}",
                    )

                # Deduct FEFO across batches
                qty_left = qty_need
                batch_deductions = []
                for batch in batches:
                    if qty_left == 0:
                        break
                    deduct = min(qty_left, batch["qty_remaining"])
                    batch_deductions.append((batch["id"], deduct, float(batch["unit_cost"])))
                    qty_left -= deduct

                line_subtotal = round(unit_price * qty_need, 3)
                line_vat      = round(line_subtotal * vat_rate, 3)
                subtotal      += line_subtotal
                vat_total     += line_vat

                # Accumulate VAT breakdown
                rate_key = round(vat_rate * 100, 2)
                if rate_key not in vat_map:
                    vat_map[rate_key] = {"taxable_amount": 0.0, "vat_amount": 0.0}
                vat_map[rate_key]["taxable_amount"] = round(vat_map[rate_key]["taxable_amount"] + line_subtotal, 3)
                vat_map[rate_key]["vat_amount"]     = round(vat_map[rate_key]["vat_amount"] + line_vat, 3)

                # Record each batch slice so multi-batch sales maintain lot traceability
                for b_id, b_qty, b_cost in batch_deductions:
                    slice_subtotal = round(unit_price * b_qty, 3)
                    slice_vat      = round(slice_subtotal * vat_rate, 3)
                    sale_items_data.append({
                        "id":           str(uuid.uuid4()),
                        "medicine_id":  med_id,
                        "batch_id":     b_id,
                        "quantity":     b_qty,
                        "unit_price":   unit_price,
                        "vat_rate":     round(vat_rate * 100, 2),
                        "vat_amount":   slice_vat,
                        "cost_at_sale": b_cost,
                        "deduct_batch_id": b_id,
                        "deduct_qty":   b_qty,
                    })
                    if med_row.get("is_controlled", 0):
                        controlled_dispenses.append({
                            "medicine_id": med_id,
                            "batch_id": b_id,
                            "quantity": b_qty,
                            "patient_national_id": patient_id,
                            "doctor_license": doc_lic or "HOSP-RX-VERIFIED",
                        })

            subtotal   = round(subtotal, 3)
            vat_total  = round(vat_total, 3)

            # ── 3. Calculate coupon discount against computed subtotal ──────────────
            if coupon_row:
                discount_value = float(coupon_row["discount_value"])
                if coupon_row["discount_type"] == "percentage":
                    coupon_discount = round(subtotal * (discount_value / 100.0), 3)
                else:  # fixed
                    coupon_discount = round(discount_value, 3)

                coupon_discount = min(coupon_discount, subtotal)

            total = max(0.0, round(subtotal + vat_total - coupon_discount, 3))
            vat_breakdown = [{"rate": k, "taxable_amount": v["taxable_amount"], "vat_amount": v["vat_amount"]} for k, v in vat_map.items()]

            # ── 4. Customer House Credit Validation & Processing ────────────────────
            if payment_method == "credit":
                if not customer_id:
                    raise HTTPException(status_code=400, detail="Customer must be selected for credit sales")
                cur.execute(
                    "SELECT credit_limit, current_balance, is_credit_allowed FROM customers WHERE id = %s FOR UPDATE",
                    (customer_id,)
                )
                cust_row = cur.fetchone()
                if not cust_row:
                    raise HTTPException(status_code=404, detail="Customer not found for credit sale")
                if not cust_row.get("is_credit_allowed", 0):
                    raise HTTPException(status_code=400, detail="Customer is not approved for credit purchases")
                
                c_limit = float(cust_row.get("credit_limit") or 0.0)
                c_bal = float(cust_row.get("current_balance") or 0.0)
                if round(c_bal + total, 2) > c_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Credit limit exceeded. Current Balance: {c_bal:.2f}, Limit: {c_limit:.2f}, Sale Total: {total:.2f}"
                    )
                new_bal = round(c_bal + total, 2)
                cur.execute(
                    "UPDATE customers SET current_balance = %s, updated_at = %s WHERE id = %s",
                    (new_bal, now, customer_id)
                )
                cur.execute(
                    """INSERT INTO customer_ledger
                       (id, customer_id, transaction_type, amount, balance_after, reference_id, notes, created_by, created_at)
                       VALUES (%s, %s, 'CHARGE', %s, %s, %s, 'POS Credit Sale', %s, %s)""",
                    (str(uuid.uuid4()), customer_id, round(total, 2), new_bal, sale_id, current_user["sub"], now)
                )

            # Get gapless ICV
            icv            = _next_icv(cur, branch_id)
            invoice_number = _invoice_number(branch_id, icv)

            # Get current open session for this user+branch (nullable)
            cur.execute(
                """SELECT id FROM cash_sessions
                   WHERE user_id = %s AND branch_id = %s AND status != 'CLOSED'
                   ORDER BY opened_at DESC LIMIT 1""",
                (current_user["sub"], branch_id),
            )
            session_row = cur.fetchone()
            session_id_fk = session_row["id"] if session_row else None

            # Insert sale
            cur.execute(
                """INSERT INTO sales
                   (id, branch_id, user_id, invoice_number, uuid, icv,
                    subtotal_amount, vat_amount, total_amount, vat_breakdown,
                    payment_method, payment_lines, notes, sold_at, session_id, customer_id, customer_name, coupon_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    sale_id, branch_id, current_user["sub"],
                    invoice_number, sale_uuid, icv,
                    subtotal, vat_total, total,
                    json.dumps(vat_breakdown),
                    payment_method,
                    json.dumps(payment_lines) if payment_lines else None,
                    notes, now, session_id_fk,
                    customer_id, customer_name, coupon_id,
                ),
            )
            
            # Insert coupon usage record if coupon was applied
            if coupon_id:
                cur.execute(
                    """INSERT INTO coupon_usage
                       (id, coupon_id, sale_id, discount_amount, used_at)
                       VALUES (%s,%s,%s,%s,%s)""",
                    (str(uuid.uuid4()), coupon_id, sale_id, coupon_discount, now),
                )
                
                # Increment coupon usage count
                cur.execute(
                    "UPDATE coupons SET usage_count = usage_count + 1 WHERE id = %s",
                    (coupon_id,),
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

            # Insert sale items + batch deductions + stock movements
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

                # Batch deduction (FEFO)
                cur.execute(
                    "UPDATE batches SET qty_remaining = qty_remaining - %s WHERE id = %s",
                    (si["deduct_qty"], si["deduct_batch_id"]),
                )
                cur.execute(
                    """INSERT INTO stock_movements
                       (id, medicine_id, branch_id, batch_id, qty_delta,
                        movement_type, reference_id, reference_type, reason, created_by, created_at)
                       VALUES (%s,%s,%s,%s,%s,'OUT',%s,'sale','',%s,%s)""",
                    (str(uuid.uuid4()), si["medicine_id"], branch_id,
                     si["deduct_batch_id"], -si["deduct_qty"], sale_id, current_user["sub"], now),
                )
                # Update medicine stock cache
                cur.execute(
                    "UPDATE medicines SET stock_quantity = stock_quantity - %s, updated_at = %s WHERE id = %s",
                    (si["deduct_qty"], now, si["medicine_id"]),
                )

            # ── 4b. Insurance Co-Pay & Claim Generation ─────────────────────────────
            insurance_claim_data = None
            if payment_method == "insurance":
                if not customer_id:
                    raise HTTPException(status_code=400, detail="Customer must be selected for insurance billing")
                cur.execute(
                    """SELECT pip.*, ip.name_en AS provider_name
                       FROM patient_insurance_policies pip
                       JOIN insurance_providers ip ON ip.id = pip.provider_id
                       WHERE pip.customer_id = %s AND pip.is_active = 1 AND ip.is_active = 1
                       ORDER BY pip.created_at DESC LIMIT 1""",
                    (customer_id,)
                )
                pol = cur.fetchone()
                if not pol:
                    raise HTTPException(status_code=400, detail="No active insurance policy found for customer")

                c_pct = float(pol["copay_percent"]) / 100.0
                m_copay = float(pol["max_copay_amount"])
                pat_share = round(min(total * c_pct, m_copay), 2)
                ins_share = round(max(0.0, total - pat_share), 2)
                preauth = body.get("pre_auth_code") or f"NPHIES-AUTO-{uuid.uuid4().hex[:8].upper()}"

                claim_id = str(uuid.uuid4())
                cur.execute(
                    """INSERT INTO insurance_claims
                       (id, sale_id, policy_id, total_claim_amount, patient_share_amount, insurance_share_amount, status, pre_auth_code, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, 'APPROVED', %s, %s)""",
                    (claim_id, sale_id, pol["id"], total, pat_share, ins_share, preauth, now)
                )
                insurance_claim_data = {
                    "claim_id": claim_id,
                    "policy_id": pol["id"],
                    "provider_name": pol["provider_name"],
                    "patient_share": pat_share,
                    "insurance_share": ins_share,
                    "pre_auth_code": preauth,
                }

            # ── 4c. ZATCA Phase 2 UBL 2.1 XML & Hash Generation ─────────────────────
            seller_info = {"name": "PharmaFlow Demo", "vat_number": "311111111111113"}
            buyer_info = {"name": customer_name or "Walk-in Patient"} if customer_id else None
            xml_items = [
                {"name_en": si["medicine_id"], "quantity": si["quantity"], "unit_price": si["unit_price"]}
                for si in sale_items_data
            ]
            zatca_xml_str = generate_ubl_invoice_xml(
                invoice_number=invoice_number,
                uuid_str=sale_uuid,
                issue_date=now.strftime("%Y-%m-%d"),
                issue_time=now.strftime("%H:%M:%S"),
                seller=seller_info,
                buyer=buyer_info,
                items=xml_items,
                subtotal=subtotal,
                vat_total=vat_total,
                total=total,
            )
            zatca_hash = compute_zatca_invoice_hash(zatca_xml_str)
            zatca_tlv = generate_zatca_tlv_qr(
                seller_name=seller_info["name"],
                vat_number=seller_info["vat_number"],
                timestamp=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                total_amount=f"{total:.2f}",
                vat_amount=f"{vat_total:.2f}",
                xml_hash=zatca_hash,
            )

            # Update sales with ZATCA Phase 2 metadata
            cur.execute(
                "UPDATE sales SET zatca_status = 'REPORTED', zatca_hash = %s, zatca_xml = %s WHERE id = %s",
                (zatca_hash, zatca_xml_str, sale_id),
            )

        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    # Build response
    response = {
        "id":             sale_id,
        "invoice_number": invoice_number,
        "uuid":           sale_uuid,
        "icv":            icv,
        "branch_id":      branch_id,
        "user_id":        current_user["sub"],
        "subtotal_amount": str(subtotal),
        "vat_amount":     str(vat_total),
        "coupon_discount": str(coupon_discount),  # NEW: discount amount applied
        "total_amount":   str(total),
        "coupon_id":      coupon_id,  # NEW: coupon_id if applied
        "vat_breakdown":  vat_breakdown,
        "payment_method": payment_method,
        "payment_lines":  payment_lines,
        "notes":          notes,
        "sold_at":        now.isoformat(),
        "zatca_status":   "REPORTED",
        "zatca_hash":     zatca_hash,
        "zatca_tlv":      zatca_tlv,
        "insurance_claim": insurance_claim_data,
        "items": [
            {
                "id":             si["id"],
                "medicine_id":    si["medicine_id"],
                "batch_id":       si["batch_id"],
                "quantity":       si["quantity"],
                "unit_price":     str(si["unit_price"]),
                "vat_rate":       str(si["vat_rate"]),
                "vat_amount":     str(si["vat_amount"]),
                "cost_at_sale":   str(si["cost_at_sale"]),
            }
            for si in sale_items_data
        ],
    }

    # Store idempotency key
    if x_idempotency_key:
        with db.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO idempotency_keys (key_value, response_json, created_at) VALUES (%s,%s,%s)",
                (x_idempotency_key, json.dumps(response), now),
            )
        db.commit()

    return response


@router.get("/{sale_id}/zatca-xml")
def get_zatca_xml(
    sale_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "auditor", "pharmacist")),
):
    """Retrieves ZATCA Phase 2 standard UBL 2.1 XML and hash for an invoice."""
    with db.cursor() as cur:
        cur.execute("SELECT id, invoice_number, zatca_status, zatca_hash, zatca_xml, sold_at FROM sales WHERE id = %s", (sale_id,))
        sale = cur.fetchone()
        if not sale:
            raise HTTPException(status_code=404, detail="Sale invoice not found")

    return {
        "sale_id": sale["id"],
        "invoice_number": sale["invoice_number"],
        "zatca_status": sale["zatca_status"] or "PENDING",
        "zatca_hash": sale["zatca_hash"],
        "zatca_xml": sale["zatca_xml"],
    }

