"""
Purchases (GoodsReceipt) routes:
  GET  /purchases        — paginated list
  GET  /purchases/{id}   — single receipt with lines
  POST /purchases        — create GoodsReceipt → creates Batches → logs StockMovement IN
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from db.connection import get_db
from utils.auth import get_current_user, require_admin, require_roles
from utils.audit import log_action

router = APIRouter()


@router.get("")
def list_purchases(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    supplier_id: str = Query(""),
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions: list[str] = []
    params: list = []

    if supplier_id:
        conditions.append("b.supplier_id = %s")
        params.append(supplier_id)

    if branch_id:
        conditions.append("b.branch_id = %s")
        params.append(branch_id)

    conditions.append("b.status != 'written_off'")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(
            f"""SELECT COUNT(*) AS total
                FROM batches b
                {where}""",
            params,
        )
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT
                    b.id, b.medicine_id, b.branch_id, b.supplier_id,
                    b.batch_number, b.expiry_date, b.manufacturing_date,
                    b.qty_received, b.qty_remaining, b.unit_cost, b.status, b.sfda_status,
                    b.created_at,
                    m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                    m.selling_price AS medicine_selling_price,
                    s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
                FROM batches b
                LEFT JOIN medicines m ON m.id = b.medicine_id
                LEFT JOIN suppliers s ON s.id = b.supplier_id
                {where}
                ORDER BY b.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    def _fmt(r: dict) -> dict:
        return {
            **r,
            "unit_cost":         str(r["unit_cost"]),
            "expiry_date":       str(r["expiry_date"]),
            "manufacturing_date": str(r["manufacturing_date"]) if r["manufacturing_date"] else None,
            "created_at":        r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.put("/{batch_id}/write-off", status_code=200)
def write_off_batch(
    batch_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "inventory_manager", "pharmacist")),
):
    """Mark a batch as written_off — removes it from expiry alerts."""
    try:
        with db.cursor() as cur:
            cur.execute(
                "SELECT id, medicine_id, branch_id, qty_remaining FROM batches WHERE id = %s FOR UPDATE",
                (batch_id,)
            )
            batch = cur.fetchone()
            if not batch:
                raise HTTPException(status_code=404, detail="Batch not found")
            # Mark written off
            cur.execute("UPDATE batches SET status = 'written_off', qty_remaining = 0 WHERE id = %s", (batch_id,))
            # Update medicine stock cache
            cur.execute(
                "UPDATE medicines SET stock_quantity = stock_quantity - %s WHERE id = %s",
                (batch["qty_remaining"], batch["medicine_id"]),
            )
            # Log stock movement
            import uuid as _uuid
            from datetime import datetime, timezone as _tz
            cur.execute(
                """INSERT INTO stock_movements (id, medicine_id, branch_id, batch_id, qty_delta,
                   movement_type, reference_id, reference_type, reason, created_by, created_at)
                   VALUES (%s,%s,%s,%s,%s,'WRITE_OFF',%s,'write_off','Expiry write-off',%s,%s)""",
                (_uuid.uuid4(), batch["medicine_id"], batch["branch_id"], batch_id,
                 -batch["qty_remaining"], batch_id, current_user["sub"], datetime.now(_tz.utc)),
            )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "written_off", "batch_id": batch_id}


@router.get("/{batch_id}")
def get_purchase(batch_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute(
            """SELECT b.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                      s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
               FROM batches b
               LEFT JOIN medicines m ON m.id = b.medicine_id
               LEFT JOIN suppliers s ON s.id = b.supplier_id
               WHERE b.id = %s""",
            (batch_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return {
        **row,
        "unit_cost":          str(row["unit_cost"]),
        "expiry_date":        str(row["expiry_date"]),
        "manufacturing_date": str(row["manufacturing_date"]) if row["manufacturing_date"] else None,
        "created_at":         row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
    }


@router.post("", status_code=201)
def create_purchase(
    body: dict,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "pharmacist", "inventory_manager", "branch_manager")),
):
    """
    Create a batch receipt. One call = one batch for one medicine.
    Body: { supplier_id, medicine_id, branch_id, batch_number, expiry_date,
            manufacturing_date (optional), quantity, unit_cost, notes (optional) }

    Side effects (in one transaction):
    1. Insert into batches
    2. Increment medicines.stock_quantity
    3. Insert into stock_movements (type IN)
    """
    required = ["supplier_id", "medicine_id", "branch_id", "batch_number", "expiry_date", "quantity", "unit_cost"]
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"Missing required field: {f}")

    quantity = int(body["quantity"])
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")

    batch_id = str(uuid.uuid4())
    movement_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    try:
        with db.cursor() as cur:
            # 1. Create batch
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, supplier_id, batch_number,
                    expiry_date, manufacturing_date, qty_received, qty_remaining,
                    unit_cost, status, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s)""",
                (
                    batch_id,
                    body["medicine_id"], body["branch_id"], body["supplier_id"],
                    body["batch_number"], body["expiry_date"],
                    body.get("manufacturing_date") or None,
                    quantity, quantity, body["unit_cost"], now,
                ),
            )

            # 2. Increment stock cache on medicine
            cur.execute(
                "UPDATE medicines SET stock_quantity = stock_quantity + %s, updated_at = %s WHERE id = %s",
                (quantity, now, body["medicine_id"]),
            )

            # 3. Log stock movement IN
            cur.execute(
                """INSERT INTO stock_movements
                   (id, medicine_id, branch_id, batch_id, qty_delta, movement_type,
                    reference_id, reference_type, reason, created_by, created_at)
                   VALUES (%s,%s,%s,%s,%s,'IN',%s,'purchase',%s,%s,%s)""",
                (
                    movement_id,
                    body["medicine_id"], body["branch_id"], batch_id,
                    quantity, batch_id,
                    body.get("notes", ""),
                    current_user["sub"], now,
                ),
            )

        db.commit()

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    with db.cursor() as cur:
        cur.execute("SELECT * FROM batches WHERE id = %s", (batch_id,))
        row = cur.fetchone()

    log_action(db, current_user["sub"], body["branch_id"],
               "purchase", "CREATE", entity_id=batch_id,
               after={"medicine_id": body["medicine_id"], "batch_number": body["batch_number"],
                      "quantity": quantity, "expiry_date": body["expiry_date"]})

    return {
        **row,
        "unit_cost":          str(row["unit_cost"]),
        "expiry_date":        str(row["expiry_date"]),
        "manufacturing_date": str(row["manufacturing_date"]) if row["manufacturing_date"] else None,
        "created_at":         row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
    }


# ── Global stock movements ────────────────────────────────────────────────────

@router.get("/movements/all")
def list_all_movements(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    medicine_id: str = Query(""),
    branch_id: str = Query(""),
    movement_type: str = Query(""),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    """Global stock movement ledger — all IN/OUT/ADJUST/RETURN/WRITE_OFF entries."""
    offset = (page - 1) * page_size
    conditions: list[str] = []
    params: list = []

    if medicine_id:
        conditions.append("sm.medicine_id = %s")
        params.append(medicine_id)
    if branch_id:
        conditions.append("sm.branch_id = %s")
        params.append(branch_id)
    if movement_type:
        conditions.append("sm.movement_type = %s")
        params.append(movement_type)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(
            f"SELECT COUNT(*) AS total FROM stock_movements sm {where}", params
        )
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT
                    sm.id, sm.medicine_id, sm.branch_id, sm.batch_id,
                    sm.qty_delta, sm.movement_type, sm.reference_type,
                    sm.reason, sm.created_by, sm.created_at,
                    m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                    b.name_en AS branch_name_en, b.name_ar AS branch_name_ar,
                    u.full_name AS user_name
                FROM stock_movements sm
                LEFT JOIN medicines m ON m.id = sm.medicine_id
                LEFT JOIN branches b ON b.id = sm.branch_id
                LEFT JOIN users u ON u.id = sm.created_by
                {where}
                ORDER BY sm.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    def _fmt(r: dict) -> dict:
        return {
            **r,
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}
