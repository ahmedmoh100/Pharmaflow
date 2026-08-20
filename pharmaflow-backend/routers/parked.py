"""
Parked transactions — Hold / Suspend / Recall.

  POST /parked           — park current cart (Hold or Suspend)
  GET  /parked           — list PARKED transactions for current user+branch
  POST /parked/{id}/recall — mark RECALLED, return cart_json
  POST /parked/{id}/void   — mark VOIDED
"""

import uuid
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from db.connection import get_db
from utils.auth import get_current_user

router = APIRouter()


@router.post("", status_code=201)
def park_transaction(body: dict, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Save a cart as a parked transaction.
    Body: { cart: [...], session_id: str | null }
    """
    cart = body.get("cart", [])
    if not cart:
        raise HTTPException(status_code=400, detail="Cart is empty")

    parked_id = str(uuid.uuid4())
    session_id = body.get("session_id") or None
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO parked_transactions (id, session_id, user_id, branch_id, cart_json, parked_at, status)
               VALUES (%s, %s, %s, %s, %s, %s, 'PARKED')""",
            (parked_id, session_id, current_user["sub"], current_user["branch_id"],
             json.dumps(cart), now),
        )
    db.commit()

    return {"id": parked_id, "parked_at": now.isoformat(), "status": "PARKED"}


@router.get("")
def list_parked(db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """List all PARKED transactions for the current user+branch."""
    with db.cursor() as cur:
        cur.execute(
            """SELECT id, session_id, cart_json, parked_at, status
               FROM parked_transactions
               WHERE user_id = %s AND branch_id = %s AND status = 'PARKED'
               ORDER BY parked_at DESC""",
            (current_user["sub"], current_user["branch_id"]),
        )
        rows = cur.fetchall()

    def _fmt(r):
        cart = json.loads(r["cart_json"]) if isinstance(r["cart_json"], str) else r["cart_json"]
        return {
            "id": r["id"],
            "session_id": r["session_id"],
            "cart": cart,
            "parked_at": r["parked_at"].isoformat() if hasattr(r["parked_at"], "isoformat") else str(r["parked_at"]),
            "status": r["status"],
            "item_count": len(cart),
            "total": sum(
                float(item.get("unit_price", 0)) * int(item.get("quantity", 1))
                for item in cart
            ),
        }

    return {"items": [_fmt(r) for r in rows]}


@router.post("/{parked_id}/recall")
def recall_transaction(parked_id: str, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Mark a parked transaction as RECALLED and return its cart."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT * FROM parked_transactions WHERE id = %s AND user_id = %s AND status = 'PARKED'",
            (parked_id, current_user["sub"]),
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Parked transaction not found")

    with db.cursor() as cur:
        cur.execute(
            "UPDATE parked_transactions SET status = 'RECALLED' WHERE id = %s",
            (parked_id,),
        )
    db.commit()

    cart = json.loads(row["cart_json"]) if isinstance(row["cart_json"], str) else row["cart_json"]
    return {
        "id": parked_id,
        "cart": cart,
        "status": "RECALLED",
    }


@router.post("/{parked_id}/void")
def void_parked(parked_id: str, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Void a parked transaction."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT id FROM parked_transactions WHERE id = %s AND user_id = %s AND status = 'PARKED'",
            (parked_id, current_user["sub"]),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Parked transaction not found")

        cur.execute(
            "UPDATE parked_transactions SET status = 'VOIDED' WHERE id = %s",
            (parked_id,),
        )
    db.commit()
    return {"id": parked_id, "status": "VOIDED"}
