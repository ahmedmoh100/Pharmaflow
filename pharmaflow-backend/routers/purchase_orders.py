"""
Purchase Order routes.

  POST /purchase-orders/              — create PO (admin only, no stock change)
  GET  /purchase-orders/              — list POs with filters
  GET  /purchase-orders/{id}          — PO detail with items
  PUT  /purchase-orders/{id}/status   — update status (SENT / CANCELLED)
  POST /purchase-orders/{id}/receive  — receive goods: creates batches, hits stock
  GET  /purchase-orders/suggested     — suggested orders based on low stock

Status flow: DRAFT → SENT → RECEIVED  (or CANCELLED from DRAFT/SENT)
Stock only changes on RECEIVE.
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from db.connection import get_db
from utils.auth import require_admin, get_current_user, require_roles
from utils.audit import log_action

router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class POItem(BaseModel):
    medicine_id: str
    ordered_qty: int
    agreed_unit_cost: float


class CreatePORequest(BaseModel):
    supplier_id: str
    branch_id: str
    expected_date: Optional[str] = None
    notes: str = ""
    items: list[POItem]


class UpdateStatusRequest(BaseModel):
    status: str   # SENT | CANCELLED


class ReceiveItem(BaseModel):
    medicine_id: str
    batch_number: str
    qty_received: int
    unit_cost: float
    expiry_date: str
    manufacturing_date: Optional[str] = None


class ReceivePORequest(BaseModel):
    items: list[ReceiveItem]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_po(r: dict) -> dict:
    return {
        **r,
        "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        "updated_at": r["updated_at"].isoformat() if hasattr(r["updated_at"], "isoformat") else str(r["updated_at"]),
        "expected_date": r["expected_date"].isoformat() if r.get("expected_date") and hasattr(r["expected_date"], "isoformat") else (str(r["expected_date"]) if r.get("expected_date") else None),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/", status_code=201)
def create_po(
    body: CreatePORequest,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    """Create a Purchase Order — no stock change, status=DRAFT."""
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one item required")

    user_id = current_user["sub"]

    with db.cursor() as cur:
        # Validate supplier
        cur.execute("SELECT id FROM suppliers WHERE id = %s AND is_active = 1", (body.supplier_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Supplier not found")

        # Validate branch
        cur.execute("SELECT id FROM branches WHERE id = %s AND is_active = 1", (body.branch_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Branch not found")

        po_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        cur.execute(
            """INSERT INTO purchase_orders
               (id, supplier_id, branch_id, status, expected_date, notes, created_by, created_at, updated_at)
               VALUES (%s, %s, %s, 'DRAFT', %s, %s, %s, %s, %s)""",
            (po_id, body.supplier_id, body.branch_id,
             body.expected_date or None, body.notes, user_id, now, now),
        )

        for item in body.items:
            cur.execute(
                """INSERT INTO purchase_order_items (id, po_id, medicine_id, ordered_qty, agreed_unit_cost)
                   VALUES (%s, %s, %s, %s, %s)""",
                (str(uuid.uuid4()), po_id, item.medicine_id,
                 item.ordered_qty, round(item.agreed_unit_cost, 3)),
            )

    db.commit()
    log_action(db, user_id, body.branch_id, "purchase_order", "CREATE",
               entity_id=po_id, before=None, after={"supplier_id": body.supplier_id, "items": len(body.items)})

    return {"id": po_id, "status": "DRAFT", "created_at": now.isoformat()}


@router.get("/")
def list_pos(
    branch_id: str = "",
    supplier_id: str = "",
    status: str = "",
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "inventory_manager", "branch_manager", "auditor")),
):
    clauses, params = [], []
    if branch_id:
        clauses.append("po.branch_id = %s"); params.append(branch_id)
    if supplier_id:
        clauses.append("po.supplier_id = %s"); params.append(supplier_id)
    if status:
        clauses.append("po.status = %s"); params.append(status)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    with db.cursor() as cur:
        cur.execute(f"""
            SELECT po.id, po.status, po.expected_date, po.notes, po.created_at, po.updated_at,
                   s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar,
                   b.name_en AS branch_name_en,   b.name_ar AS branch_name_ar,
                   u.full_name AS created_by_name,
                   (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS item_count
            FROM purchase_orders po
            JOIN suppliers s ON s.id = po.supplier_id
            JOIN branches  b ON b.id = po.branch_id
            JOIN users     u ON u.id = po.created_by
            {where}
            ORDER BY po.created_at DESC LIMIT 100
        """, params)
        rows = cur.fetchall()

    return {"items": [_fmt_po(r) for r in rows], "total": len(rows)}


@router.get("/suggested")
def get_suggested_orders(
    branch_id: str = Query(None, description="Filter by branch ID"),
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    """
    Generate suggested purchase orders based on low stock thresholds
    
    Args:
        branch_id: Optional branch filter
    
    Returns:
        List of medicines that need reordering with suggested quantities
    """
    with db.cursor() as cur:
        if branch_id:
            query = """
                SELECT m.id, m.name_en, m.name_ar,
                       COALESCE(SUM(CASE WHEN b.status = 'active' AND b.qty_remaining > 0 
                                          AND b.expiry_date >= CURDATE() THEN b.qty_remaining ELSE 0 END), 0) AS stock_quantity,
                       m.low_stock_threshold, m.selling_price
                FROM medicines m
                LEFT JOIN batches b ON b.medicine_id = m.id AND b.branch_id = %s
                WHERE m.is_active = 1
                GROUP BY m.id, m.name_en, m.name_ar, m.low_stock_threshold, m.selling_price
                HAVING stock_quantity <= m.low_stock_threshold
                ORDER BY stock_quantity ASC
            """
            cur.execute(query, (branch_id,))
        else:
            query = """
                SELECT m.id, m.name_en, m.name_ar, m.stock_quantity, m.low_stock_threshold,
                       m.selling_price
                FROM medicines m
                WHERE m.is_active = 1 
                AND m.stock_quantity <= m.low_stock_threshold
                ORDER BY m.stock_quantity ASC
            """
            cur.execute(query)
        
        results = cur.fetchall()
        
        # Get best supplier (highest reliability)
        cur.execute("""
            SELECT id, name_en, name_ar, lead_time_days, reliability_score
            FROM suppliers
            WHERE is_active = 1
            ORDER BY reliability_score DESC, lead_time_days ASC
            LIMIT 1
        """)
        supplier = cur.fetchone()
        
        suggestions = []
        for row in results:
            current_stk = int(row["stock_quantity"])
            threshold = int(row["low_stock_threshold"])
            deficit = threshold - current_stk
            suggested_qty = max(deficit * 2, 10)
            
            suggestion = {
                "medicine_id": row["id"],
                "medicine_name_en": row["name_en"],
                "medicine_name_ar": row["name_ar"],
                "current_stock": current_stk,
                "low_stock_threshold": threshold,
                "suggested_quantity": suggested_qty,
                "unit_price": str(row["selling_price"])
            }
            
            if supplier:
                suggestion["suggested_supplier_id"] = supplier["id"]
                suggestion["suggested_supplier_name"] = supplier["name_en"]
                suggestion["supplier_lead_time_days"] = int(supplier.get("lead_time_days") or 7)
                suggestion["supplier_reliability_score"] = float(supplier.get("reliability_score") or 100.0)
            
            suggestions.append(suggestion)
        
        return {"suggestions": suggestions, "count": len(suggestions)}


@router.get("/{po_id}")
def get_po(
    po_id: str,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "inventory_manager", "branch_manager", "auditor")),
):
    with db.cursor() as cur:
        cur.execute("""
            SELECT po.*, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar,
                   b.name_en AS branch_name_en, b.name_ar AS branch_name_ar,
                   u.full_name AS created_by_name
            FROM purchase_orders po
            JOIN suppliers s ON s.id = po.supplier_id
            JOIN branches  b ON b.id = po.branch_id
            JOIN users     u ON u.id = po.created_by
            WHERE po.id = %s
        """, (po_id,))
        po = cur.fetchone()
        if not po:
            raise HTTPException(status_code=404, detail="PO not found")

        cur.execute("""
            SELECT poi.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar
            FROM purchase_order_items poi
            JOIN medicines m ON m.id = poi.medicine_id
            WHERE poi.po_id = %s
        """, (po_id,))
        items = cur.fetchall()

    result = _fmt_po(po)
    result["items"] = [
        {**i, "agreed_unit_cost": str(i["agreed_unit_cost"])}
        for i in items
    ]
    return result


@router.put("/{po_id}/status")
def update_po_status(
    po_id: str,
    body: UpdateStatusRequest,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    if body.status not in ("SENT", "CANCELLED"):
        raise HTTPException(status_code=400, detail="status must be SENT or CANCELLED")

    with db.cursor() as cur:
        cur.execute("SELECT status, branch_id FROM purchase_orders WHERE id = %s", (po_id,))
        po = cur.fetchone()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po["status"] == "RECEIVED":
        raise HTTPException(status_code=400, detail="Cannot change status of a received PO")
    if po["status"] == "CANCELLED":
        raise HTTPException(status_code=400, detail="PO is already cancelled")

    with db.cursor() as cur:
        cur.execute("UPDATE purchase_orders SET status = %s WHERE id = %s", (body.status, po_id))
    db.commit()

    log_action(db, current_user["sub"], po["branch_id"], "purchase_order", po_id, "UPDATE",
               {"status": po["status"]}, {"status": body.status})

    return {"id": po_id, "status": body.status}


@router.post("/{po_id}/receive")
def receive_po(
    po_id: str,
    body: ReceivePORequest,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    """
    Receive goods against a PO.
    Creates batches, writes stock_movements IN, updates stock cache.
    Status → RECEIVED.
    """
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one item required")

    user_id = current_user["sub"]

    with db.cursor() as cur:
        cur.execute("SELECT * FROM purchase_orders WHERE id = %s", (po_id,))
        po = cur.fetchone()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po["status"] == "RECEIVED":
        raise HTTPException(status_code=400, detail="PO already received")
    if po["status"] == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot receive a cancelled PO")

    now = datetime.now(timezone.utc)
    branch_id = po["branch_id"]
    supplier_id = po["supplier_id"]

    with db.cursor() as cur:
        for item in body.items:
            batch_id = str(uuid.uuid4())

            # Insert batch
            cur.execute(
                """INSERT INTO batches
                   (id, medicine_id, branch_id, supplier_id, batch_number,
                    expiry_date, manufacturing_date, qty_received, qty_remaining,
                    unit_cost, status, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s)""",
                (
                    batch_id, item.medicine_id, branch_id, supplier_id,
                    item.batch_number, item.expiry_date,
                    item.manufacturing_date or None,
                    item.qty_received, item.qty_received,
                    str(round(item.unit_cost, 3)), now,
                ),
            )

            # Stock movement IN
            cur.execute(
                """INSERT INTO stock_movements
                   (id, medicine_id, branch_id, batch_id, qty_delta, movement_type,
                    reference_id, reference_type, reason, created_by, created_at)
                   VALUES (%s,%s,%s,%s,%s,'IN',%s,'purchase_order','Received against PO',%s,%s)""",
                (str(uuid.uuid4()), item.medicine_id, branch_id, batch_id,
                 item.qty_received, po_id, user_id, now),
            )

            # Update stock cache
            cur.execute(
                "UPDATE medicines SET stock_quantity = stock_quantity + %s WHERE id = %s",
                (item.qty_received, item.medicine_id),
            )

        # Mark PO as received
        cur.execute(
            "UPDATE purchase_orders SET status = 'RECEIVED', updated_at = %s WHERE id = %s",
            (now, po_id),
        )

    db.commit()
    log_action(db, user_id, branch_id, "purchase_order", "UPDATE",
               entity_id=po_id, before={"status": po["status"]},
               after={"status": "RECEIVED", "batches_created": len(body.items)})

    return {"id": po_id, "status": "RECEIVED", "batches_created": len(body.items)}
