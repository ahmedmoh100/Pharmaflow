"""
Stock Count routes:
  GET  /stockcount          — current stock per medicine for this branch (for counting sheet)
  POST /stockcount/submit   — submit counted quantities → creates ADJUST movements, updates cache
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from db.connection import get_db
from utils.auth import get_current_user, require_roles
from utils.audit import log_action

router = APIRouter()


@router.get("")
def get_count_sheet(
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "inventory_manager", "pharmacist", "auditor")),
):
    """
    Returns all active medicines with their current DB stock and batch breakdown
    for this branch — this is what the pharmacist prints or reads off the screen
    while physically counting.
    """
    branch_id = current_user["branch_id"]

    with db.cursor() as cur:
        cur.execute(
            """
            SELECT
                m.id, m.id AS medicine_id, m.name_en, m.name_ar, m.barcode, m.category,
                m.stock_quantity AS db_quantity,
                m.low_stock_threshold,
                COALESCE(SUM(
                    CASE WHEN b.status = 'active' AND b.qty_remaining > 0
                         AND (b.expiry_date IS NULL OR b.expiry_date >= CURDATE())
                    THEN b.qty_remaining ELSE 0 END
                ), 0) AS branch_quantity,
                COALESCE(SUM(
                    CASE WHEN b.status = 'active' AND b.qty_remaining > 0
                         AND (b.expiry_date IS NULL OR b.expiry_date >= CURDATE())
                    THEN b.qty_remaining ELSE 0 END
                ), 0) AS system_quantity,
                COUNT(CASE WHEN b.status = 'active' AND b.qty_remaining > 0
                           AND (b.expiry_date IS NULL OR b.expiry_date >= CURDATE())
                      THEN 1 END) AS batch_count
            FROM medicines m
            LEFT JOIN batches b ON b.medicine_id = m.id AND b.branch_id = %s
            WHERE m.is_active = 1
            GROUP BY m.id, m.name_en, m.name_ar, m.barcode, m.category,
                     m.stock_quantity, m.low_stock_threshold
            ORDER BY m.name_en
            """,
            (branch_id,),
        )
        rows = cur.fetchall()

    return {
        "branch_id": branch_id,
        "items": [
            {
                **r,
                "counted_quantity": None,  # pharmacist fills this in
                "variance": None,
            }
            for r in rows
        ],
    }


@router.post("/submit")
def submit_stock_count(
    body: dict,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "inventory_manager", "pharmacist")),
):
    """
    Submit counted quantities.
    Body: {
        items: [{ medicine_id, counted_quantity, notes }]
    }

    For each item where counted != branch_quantity:
    - Creates an ADJUST stock_movement (signed delta)
    - Updates medicines.stock_quantity
    - Updates batch qty_remaining on the most recent active batch (best effort)
    """
    branch_id = current_user["branch_id"]
    items = body.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="No items submitted")

    now = datetime.now(timezone.utc)
    adjustments = []

    try:
        with db.cursor() as cur:
            for item in items:
                medicine_id = item["medicine_id"]
                counted = int(item["counted_quantity"])
                item_notes = item.get("notes", "Stock count adjustment")

                # Current branch stock from batches with row locking
                cur.execute(
                    """SELECT COALESCE(SUM(qty_remaining), 0) AS branch_qty
                       FROM batches
                       WHERE medicine_id = %s AND branch_id = %s
                       AND status = 'active' AND qty_remaining > 0
                       AND expiry_date >= CURDATE()
                       FOR UPDATE""",
                    (medicine_id, branch_id),
                )
                row = cur.fetchone()
                db_qty = int(row["branch_qty"])
                delta = counted - db_qty

                if delta == 0:
                    continue  # no adjustment needed

                # Log the adjustment movement
                movement_id = str(uuid.uuid4())
                cur.execute(
                    """INSERT INTO stock_movements
                       (id, medicine_id, branch_id, batch_id, qty_delta,
                        movement_type, reference_id, reference_type, reason,
                        created_by, created_at)
                       VALUES (%s,%s,%s,NULL,%s,'ADJUST',NULL,'stock_count',%s,%s,%s)""",
                    (movement_id, medicine_id, branch_id, delta,
                     item_notes, current_user["sub"], now),
                )

                # Update medicines.stock_quantity (materialized cache)
                cur.execute(
                    "UPDATE medicines SET stock_quantity = stock_quantity + %s, updated_at = %s WHERE id = %s",
                    (delta, now, medicine_id),
                )

                # Apply delta to the most recent active batch (best effort)
                # If delta > 0, add to most recent batch
                # If delta < 0, deduct from oldest batch first (FIFO)
                if delta > 0:
                    cur.execute(
                        """SELECT id FROM batches
                           WHERE medicine_id = %s AND branch_id = %s
                           AND status = 'active' AND expiry_date >= CURDATE()
                           ORDER BY created_at DESC LIMIT 1
                           FOR UPDATE""",
                        (medicine_id, branch_id),
                    )
                    batch = cur.fetchone()
                    if batch:
                        cur.execute(
                            "UPDATE batches SET qty_remaining = qty_remaining + %s WHERE id = %s",
                            (delta, batch["id"]),
                        )
                    else:
                        # No active batch — skip batch update, movement is still logged
                        pass
                else:
                    # Deduct from oldest batches (FIFO)
                    remaining_deduct = abs(delta)
                    cur.execute(
                        """SELECT id, qty_remaining FROM batches
                           WHERE medicine_id = %s AND branch_id = %s
                           AND status = 'active' AND qty_remaining > 0
                           ORDER BY expiry_date ASC
                           FOR UPDATE""",
                        (medicine_id, branch_id),
                    )
                    batches = cur.fetchall()
                    for b in batches:
                        if remaining_deduct == 0:
                            break
                        deduct = min(remaining_deduct, b["qty_remaining"])
                        cur.execute(
                            "UPDATE batches SET qty_remaining = qty_remaining - %s WHERE id = %s",
                            (deduct, b["id"]),
                        )
                        remaining_deduct -= deduct

                adjustments.append({
                    "medicine_id": medicine_id,
                    "db_quantity": db_qty,
                    "counted_quantity": counted,
                    "delta": delta,
                })

        db.commit()

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    log_action(
        db, current_user["sub"], branch_id,
        "stock_count", "ADJUST",
        after={"adjustments": len(adjustments), "branch_id": branch_id},
    )

    return {
        "status": "ok",
        "adjustments_made": len(adjustments),
        "items": adjustments,
    }
