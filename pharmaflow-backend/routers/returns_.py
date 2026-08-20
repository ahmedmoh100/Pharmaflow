"""
Returns / Credit Note routes:
  GET  /returns              — list returns for this branch
  GET  /returns/{id}         — single return with items and credit note
  POST /returns              — create return from a sale
    Body: {
        sale_id,
        reason,
        items: [{ sale_item_id, quantity, restockable, reason }]
    }
  GET  /returns/lookup/{invoice_number} — find a sale by invoice number (for return flow)
"""

import uuid
import json
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Query
from db.connection import get_db
from utils.auth import get_current_user
from utils.audit import log_action

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_cn_number(cur, branch_id: str) -> str:
    """Generate next gapless credit note number per branch per year."""
    year = date.today().year
    branch_map = {"br-001": "BR001", "br-002": "BR002", "br-003": "BR003", "br-004": "BR004"}
    code = branch_map.get(branch_id, branch_id[:5].upper())
    prefix = f"CN-{code}-{year}-"
    cur.execute(
        "SELECT COUNT(*) AS cnt FROM credit_notes WHERE credit_note_number LIKE %s",
        (prefix + "%",),
    )
    seq = cur.fetchone()["cnt"] + 1
    return f"{prefix}{str(seq).zfill(4)}"


def _fmt_return(r: dict) -> dict:
    return {
        **r,
        "total_refund": str(r["total_refund"]),
        "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/lookup/{invoice_number}")
def lookup_sale(
    invoice_number: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Find a sale by invoice number — used by the return flow so the pharmacist
    can type the invoice number and see what was sold.
    Only returns sales from this branch.
    """
    with db.cursor() as cur:
        cur.execute(
            """SELECT s.*, u.full_name AS pharmacist_name
               FROM sales s
               LEFT JOIN users u ON u.id = s.user_id
               WHERE s.invoice_number = %s AND s.branch_id = %s""",
            (invoice_number.upper(), current_user["branch_id"]),
        )
        sale = cur.fetchone()
        if not sale:
            raise HTTPException(status_code=404, detail="Invoice not found in this branch")

        cur.execute(
            """SELECT si.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar
               FROM sale_items si
               LEFT JOIN medicines m ON m.id = si.medicine_id
               WHERE si.sale_id = %s""",
            (sale["id"],),
        )
        items = cur.fetchall()

        # Check if any items have already been fully returned
        cur.execute(
            """SELECT sri.sale_item_id, SUM(sri.quantity) AS returned_qty
               FROM sale_return_items sri
               JOIN sale_returns sr ON sr.id = sri.return_id
               WHERE sr.sale_id = %s
               GROUP BY sri.sale_item_id""",
            (sale["id"],),
        )
        returned = {r["sale_item_id"]: r["returned_qty"] for r in cur.fetchall()}

    def _fmt_item(i: dict) -> dict:
        already_returned = returned.get(i["id"], 0)
        returnable_qty = i["quantity"] - already_returned
        return {
            **i,
            "unit_price":       str(i["unit_price"]),
            "vat_rate":         str(i["vat_rate"]),
            "vat_amount":       str(i["vat_amount"]),
            "cost_at_sale":     str(i["cost_at_sale"]),
            "already_returned": already_returned,
            "returnable_qty":   returnable_qty,
        }

    result = {
        **sale,
        "subtotal_amount": str(sale["subtotal_amount"]),
        "vat_amount":      str(sale["vat_amount"]),
        "total_amount":    str(sale["total_amount"]),
        "vat_breakdown":   json.loads(sale["vat_breakdown"]) if isinstance(sale["vat_breakdown"], str) else (sale["vat_breakdown"] or []),
        "sold_at":         sale["sold_at"].isoformat() if hasattr(sale["sold_at"], "isoformat") else str(sale["sold_at"]),
        "items":           [_fmt_item(i) for i in items],
    }
    return result


@router.get("")
def list_returns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sale_id: str = Query(""),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    branch_id = current_user["branch_id"]
    conditions = ["sr.branch_id = %s"]
    params = [branch_id]

    if sale_id:
        conditions.append("sr.sale_id = %s")
        params.append(sale_id)

    where = "WHERE " + " AND ".join(conditions)

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM sale_returns sr {where}", params)
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT sr.*, u.full_name AS processed_by_name,
                      s.invoice_number AS original_invoice,
                      cn.credit_note_number
               FROM sale_returns sr
               LEFT JOIN users u ON u.id = sr.processed_by
               LEFT JOIN sales s ON s.id = sr.sale_id
               LEFT JOIN credit_notes cn ON cn.return_id = sr.id
               {where}
               ORDER BY sr.created_at DESC
               LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {
        "items": [_fmt_return(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{return_id}")
def get_return(
    return_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    with db.cursor() as cur:
        cur.execute(
            """SELECT sr.*, u.full_name AS processed_by_name,
                      s.invoice_number AS original_invoice, s.uuid AS original_uuid,
                      cn.credit_note_number, cn.amount AS credit_amount
               FROM sale_returns sr
               LEFT JOIN users u ON u.id = sr.processed_by
               LEFT JOIN sales s ON s.id = sr.sale_id
               LEFT JOIN credit_notes cn ON cn.return_id = sr.id
               WHERE sr.id = %s AND sr.branch_id = %s""",
            (return_id, current_user["branch_id"]),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Return not found")

        cur.execute(
            """SELECT sri.*, si.medicine_id,
                      m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                      si.unit_price, si.vat_rate
               FROM sale_return_items sri
               JOIN sale_items si ON si.id = sri.sale_item_id
               JOIN medicines m ON m.id = si.medicine_id
               WHERE sri.return_id = %s""",
            (return_id,),
        )
        items = cur.fetchall()

    result = _fmt_return(row)
    result["items"] = [
        {**i, "unit_price": str(i["unit_price"]), "vat_rate": str(i["vat_rate"])}
        for i in items
    ]
    return result


@router.post("", status_code=201)
def create_return(
    body: dict,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Create a return (credit note).

    Flow:
    1. Validate original sale exists and belongs to this branch
    2. Validate quantities don't exceed what was sold (minus prior returns)
    3. For restockable items: increment batch qty_remaining + log RETURN movement
    4. Create sale_return + sale_return_items
    5. Create credit_note referencing original invoice UUID (ZATCA requirement)
    6. Update medicines.stock_quantity cache for restockable items
    """
    sale_id = body.get("sale_id")
    reason = body.get("reason", "")
    items_in = body.get("items", [])
    if not sale_id:
        raise HTTPException(status_code=400, detail="sale_id is required")
    if not items_in:
        raise HTTPException(status_code=400, detail="No items to return")

    now = datetime.now(timezone.utc)
    branch_id = current_user["branch_id"]

    with db.cursor() as cur:
        # Validate sale
        cur.execute(
            "SELECT id, branch_id, uuid, invoice_number, total_amount, payment_method, customer_id FROM sales WHERE id = %s",
            (sale_id,),
        )
        sale = cur.fetchone()
        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")
        if sale["branch_id"] != branch_id:
            raise HTTPException(status_code=403, detail="Sale belongs to a different branch")

        # Validate each return item
        validated_items = []
        total_refund = 0.0

        for item in items_in:
            sale_item_id = item["sale_item_id"]
            return_qty = int(item["quantity"])
            restockable = bool(item.get("restockable", True))
            item_reason = item.get("reason", reason)

            cur.execute(
                """SELECT si.*, m.vat_category
                   FROM sale_items si
                   JOIN medicines m ON m.id = si.medicine_id
                   WHERE si.id = %s AND si.sale_id = %s""",
                (sale_item_id, sale_id),
            )
            si = cur.fetchone()
            if not si:
                raise HTTPException(status_code=400, detail=f"Sale item {sale_item_id} not found on this sale")

            # How much has already been returned?
            cur.execute(
                """SELECT COALESCE(SUM(sri.quantity), 0) AS returned
                   FROM sale_return_items sri
                   JOIN sale_returns sr ON sr.id = sri.return_id
                   WHERE sri.sale_item_id = %s""",
                (sale_item_id,),
            )
            already_returned = cur.fetchone()["returned"]
            returnable = si["quantity"] - already_returned

            if return_qty <= 0:
                raise HTTPException(status_code=400, detail=f"Return quantity must be positive for item {sale_item_id}")
            if return_qty > returnable:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot return {return_qty} units — only {returnable} returnable for item {sale_item_id}",
                )

            line_refund = round(float(si["unit_price"]) * return_qty, 3)
            line_vat = round(line_refund * float(si["vat_rate"]) / 100, 3)
            total_refund += line_refund + line_vat

            validated_items.append({
                "sale_item_id":  sale_item_id,
                "medicine_id":   si["medicine_id"],
                "batch_id":      si["batch_id"],
                "quantity":      return_qty,
                "restockable":   restockable,
                "reason":        item_reason,
                "line_refund":   line_refund,
                "line_vat":      line_vat,
            })

    total_refund = round(total_refund, 3)

    try:
        return_id = str(uuid.uuid4())

        with db.cursor() as cur:
            # Create sale_return
            cur.execute(
                """INSERT INTO sale_returns
                   (id, sale_id, branch_id, processed_by, reason, total_refund, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (return_id, sale_id, branch_id, current_user["sub"], reason, total_refund, now),
            )

            # Create return items + restock
            for vi in validated_items:
                item_id = str(uuid.uuid4())
                cur.execute(
                    """INSERT INTO sale_return_items
                       (id, return_id, sale_item_id, quantity, restockable, reason)
                       VALUES (%s,%s,%s,%s,%s,%s)""",
                    (item_id, return_id, vi["sale_item_id"],
                     vi["quantity"], vi["restockable"], vi["reason"]),
                )

                if vi["restockable"]:
                    # Increment the original batch
                    cur.execute(
                        "UPDATE batches SET qty_remaining = qty_remaining + %s WHERE id = %s",
                        (vi["quantity"], vi["batch_id"]),
                    )
                    # Log RETURN movement
                    cur.execute(
                        """INSERT INTO stock_movements
                           (id, medicine_id, branch_id, batch_id, qty_delta,
                            movement_type, reference_id, reference_type, reason,
                            created_by, created_at)
                           VALUES (%s,%s,%s,%s,%s,'RETURN',%s,'return',%s,%s,%s)""",
                        (str(uuid.uuid4()), vi["medicine_id"], branch_id,
                         vi["batch_id"], vi["quantity"],
                         return_id, vi["reason"], current_user["sub"], now),
                    )
                    # Update stock cache
                    cur.execute(
                        "UPDATE medicines SET stock_quantity = stock_quantity + %s, updated_at = %s WHERE id = %s",
                        (vi["quantity"], now, vi["medicine_id"]),
                    )

            # Create credit note (ZATCA: must reference original invoice UUID)
            cur.execute("SELECT uuid FROM sales WHERE id = %s", (sale_id,))
            original_uuid = cur.fetchone()["uuid"]

            cn_number = _next_cn_number(cur, branch_id)
            cn_id = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO credit_notes
                   (id, return_id, original_invoice_uuid, credit_note_number, amount, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (cn_id, return_id, original_uuid, cn_number, total_refund, now),
            )

            # If original sale was on customer credit/house account, refund the balance and log to ledger
            if sale.get("payment_method") == "credit" and sale.get("customer_id"):
                cur.execute(
                    "SELECT current_balance FROM customers WHERE id = %s FOR UPDATE",
                    (sale["customer_id"],),
                )
                cust_row = cur.fetchone()
                if cust_row:
                    curr_bal = float(cust_row["current_balance"])
                    new_bal = round(max(0.0, curr_bal - total_refund), 2)
                    cur.execute(
                        "UPDATE customers SET current_balance = %s WHERE id = %s",
                        (new_bal, sale["customer_id"]),
                    )
                    cur.execute(
                        """INSERT INTO customer_ledger
                           (id, customer_id, transaction_type, amount, balance_after, reference_id, notes, created_by, created_at)
                           VALUES (%s, %s, 'REFUND', %s, %s, %s, %s, %s, %s)""",
                        (
                            str(uuid.uuid4()),
                            sale["customer_id"],
                            total_refund,
                            new_bal,
                            return_id,
                            f"Credit refund for Return on Invoice {sale['invoice_number']}",
                            current_user["sub"],
                            now,
                        ),
                    )

        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    log_action(
        db, current_user["sub"], branch_id,
        "sale_return", "CREATE", entity_id=return_id,
        after={"sale_id": sale_id, "total_refund": str(total_refund), "credit_note": cn_number},
    )

    return {
        "return_id":         return_id,
        "credit_note_number": cn_number,
        "total_refund":      str(total_refund),
        "items_returned":    len(validated_items),
        "created_at":        now.isoformat(),
    }
