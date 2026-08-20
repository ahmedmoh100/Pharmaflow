"""
Stock transfer routes.

  POST /transfers      — transfer stock from one branch to another (admin only)
  GET  /transfers      — list transfers (filterable by branch, medicine, date)

Flow on POST:
  1. Validate source branch has enough stock (FIFO batches with qty_remaining > 0)
  2. Deduct from source batches FIFO (same logic as sales)
  3. Create a new batch at destination with unit_cost from first source batch
  4. Write TRANSFER_OUT movement on source branch
  5. Write TRANSFER_IN  movement on destination branch
  6. Update medicines.stock_quantity cache (net effect = 0 chain-wide, but per-branch correct)
  7. Insert row into transfers table
  8. Audit log
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from db.connection import get_db
from utils.auth import require_roles, require_admin, get_current_user
from utils.audit import log_action

router = APIRouter()


class TransferRequest(BaseModel):
    from_branch_id: str
    to_branch_id: str
    medicine_id: str
    qty: int
    notes: str = ""


@router.post("/", status_code=201)
def create_transfer(
    body: TransferRequest,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "branch_manager", "inventory_manager")),
):
    """Transfer stock between branches."""
    if body.qty <= 0:
        raise HTTPException(status_code=400, detail="qty must be > 0")
    if body.from_branch_id == body.to_branch_id:
        raise HTTPException(status_code=400, detail="Source and destination branches must differ")

    user_id = current_user["sub"]

    try:
        with db.cursor() as cur:
            # Verify medicine exists and lock row
            cur.execute("SELECT id, name_en, name_ar FROM medicines WHERE id = %s AND is_active = 1 FOR UPDATE", (body.medicine_id,))
            medicine = cur.fetchone()
            if not medicine:
                raise HTTPException(status_code=404, detail="Medicine not found")

            # Verify branches exist
            for bid, label in [(body.from_branch_id, "Source"), (body.to_branch_id, "Destination")]:
                cur.execute("SELECT id FROM branches WHERE id = %s AND is_active = 1", (bid,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail=f"{label} branch not found")

            # Get available stock at source (FIFO: earliest expiry first with row-level locking)
            cur.execute(
                """SELECT id, qty_remaining, unit_cost, expiry_date, batch_number
                   FROM batches
                   WHERE medicine_id = %s AND branch_id = %s
                     AND status = 'active' AND qty_remaining > 0
                     AND (expiry_date IS NULL OR expiry_date >= CURDATE())
                   ORDER BY expiry_date ASC
                   FOR UPDATE""",
                (body.medicine_id, body.from_branch_id),
            )
            source_batches = cur.fetchall()

            total_available = sum(b["qty_remaining"] for b in source_batches)
            if total_available < body.qty:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient stock at source branch. Available: {total_available}, requested: {body.qty}",
                )

            # FIFO deduction from source batches
            now = datetime.now(timezone.utc)
            remaining_to_deduct = body.qty
            first_unit_cost = float(source_batches[0]["unit_cost"])
            first_expiry = source_batches[0]["expiry_date"]
            first_batch_number = source_batches[0]["batch_number"]

            for batch in source_batches:
                if remaining_to_deduct <= 0:
                    break
                deduct = min(batch["qty_remaining"], remaining_to_deduct)
                cur.execute(
                    "UPDATE batches SET qty_remaining = qty_remaining - %s WHERE id = %s",
                    (deduct, batch["id"]),
                )
                remaining_to_deduct -= deduct

            # Create new batch at destination
            dest_batch_id = str(uuid.uuid4())
            dest_batch_number = f"TRF-{body.from_branch_id[:4].upper()}-{now.strftime('%Y%m%d%H%M')}"
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, supplier_id, batch_number,
                    expiry_date, qty_received, qty_remaining, unit_cost, status, created_at)
                   VALUES (%s, %s, %s, NULL, %s, %s, %s, %s, %s, 'active', %s)""",
                (
                    dest_batch_id, body.medicine_id, body.to_branch_id,
                    dest_batch_number, first_expiry,
                    body.qty, body.qty, str(first_unit_cost), now,
                ),
            )

            transfer_id = str(uuid.uuid4())

            # Write TRANSFER_OUT movement (source)
            cur.execute(
                """INSERT INTO stock_movements
                   (id, medicine_id, branch_id, qty_delta, movement_type,
                    reference_id, reference_type, reason, created_by, created_at)
                   VALUES (%s, %s, %s, %s, 'TRANSFER_OUT', %s, 'transfer', %s, %s, %s)""",
                (
                    str(uuid.uuid4()), body.medicine_id, body.from_branch_id,
                    -body.qty, transfer_id,
                    f"Transfer to {body.to_branch_id}: {body.notes}",
                    user_id, now,
                ),
            )

            # Write TRANSFER_IN movement (destination)
            cur.execute(
                """INSERT INTO stock_movements
                   (id, medicine_id, branch_id, qty_delta, movement_type,
                    reference_id, reference_type, reason, created_by, created_at)
                   VALUES (%s, %s, %s, %s, 'TRANSFER_IN', %s, 'transfer', %s, %s, %s)""",
                (
                    str(uuid.uuid4()), body.medicine_id, body.to_branch_id,
                    body.qty, transfer_id,
                    f"Transfer from {body.from_branch_id}: {body.notes}",
                    user_id, now,
                ),
            )

            # Insert transfers record
            cur.execute(
                """INSERT INTO transfers
                   (id, from_branch_id, to_branch_id, medicine_id, qty, status, notes, created_by, created_at)
                   VALUES (%s, %s, %s, %s, %s, 'COMPLETED', %s, %s, %s)""",
                (
                    transfer_id, body.from_branch_id, body.to_branch_id,
                    body.medicine_id, body.qty, body.notes, user_id, now,
                ),
            )

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    log_action(db, user_id, body.from_branch_id, "transfer", "CREATE",
               entity_id=transfer_id,
               after={"from": body.from_branch_id, "to": body.to_branch_id,
                      "medicine_id": body.medicine_id, "qty": body.qty})

    return {
        "id": transfer_id,
        "from_branch_id": body.from_branch_id,
        "to_branch_id": body.to_branch_id,
        "medicine_id": body.medicine_id,
        "medicine_name_en": medicine["name_en"],
        "medicine_name_ar": medicine["name_ar"],
        "qty": body.qty,
        "status": "COMPLETED",
        "created_at": now.isoformat(),
    }


@router.get("/")
def list_transfers(
    branch_id: str = "",
    medicine_id: str = "",
    from_date: str = "",
    to_date: str = "",
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "branch_manager", "inventory_manager", "auditor")),
):
    """List transfers with optional filters."""
    clauses: list[str] = []
    params = []

    if branch_id:
        clauses.append("(t.from_branch_id = %s OR t.to_branch_id = %s)")
        params += [branch_id, branch_id]
    if medicine_id:
        clauses.append("t.medicine_id = %s")
        params.append(medicine_id)
    if from_date:
        clauses.append("DATE(t.created_at) >= %s")
        params.append(from_date)
    if to_date:
        clauses.append("DATE(t.created_at) <= %s")
        params.append(to_date)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    with db.cursor() as cur:
        cur.execute(f"""
            SELECT
                t.id, t.qty, t.status, t.notes, t.created_at,
                m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                bf.name_en AS from_branch_en, bf.name_ar AS from_branch_ar,
                bt.name_en AS to_branch_en,   bt.name_ar AS to_branch_ar,
                u.full_name AS created_by_name
            FROM transfers t
            JOIN medicines m  ON m.id  = t.medicine_id
            JOIN branches  bf ON bf.id = t.from_branch_id
            JOIN branches  bt ON bt.id = t.to_branch_id
            JOIN users     u  ON u.id  = t.created_by
            {where}
            ORDER BY t.created_at DESC
            LIMIT 100
        """, params)
        rows = cur.fetchall()

    def _fmt(r):
        return {
            **r,
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }

    return {"items": [_fmt(r) for r in rows], "total": len(rows)}
