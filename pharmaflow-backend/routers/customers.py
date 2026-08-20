"""
Customers routes:
  GET    /customers        — search by name or phone
  GET    /customers/{id}   — single customer
  POST   /customers        — create customer
  PUT    /customers/{id}   — update customer
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from db.connection import get_db
from utils.auth import get_current_user, require_roles

router = APIRouter()


class CustomerCreate(BaseModel):
    name_ar: str
    name_en: str = ""
    phone: str = ""
    national_id: str = ""
    notes: str = ""
    credit_limit: float = 0.0
    is_credit_allowed: bool = False


class CustomerUpdate(BaseModel):
    name_ar: str | None = None
    name_en: str | None = None
    phone: str | None = None
    national_id: str | None = None
    notes: str | None = None
    credit_limit: float | None = None
    is_credit_allowed: bool | None = None


class CustomerPayment(BaseModel):
    amount: float
    notes: str = ""


def _fmt(r: dict) -> dict:
    return {
        **r,
        "credit_limit": str(r.get("credit_limit", "0.00")),
        "current_balance": str(r.get("current_balance", "0.00")),
        "is_credit_allowed": bool(r.get("is_credit_allowed", 0)),
        "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        "updated_at": r["updated_at"].isoformat() if hasattr(r["updated_at"], "isoformat") else str(r["updated_at"]),
    }


@router.get("")
def list_customers(
    search: str = Query("", description="Search by name_ar, name_en, or phone"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions = []
    params: list = []

    if search:
        conditions.append("(name_ar LIKE %s OR name_en LIKE %s OR phone LIKE %s OR national_id = %s)")
        like = f"%{search}%"
        params += [like, like, like, search]

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM customers {where}", params)
        total = cur.fetchone()["total"]
        cur.execute(
            f"SELECT * FROM customers {where} ORDER BY name_ar ASC LIMIT %s OFFSET %s",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {"items": [_fmt(r) for r in rows], "total": total}


@router.get("/{customer_id}")
def get_customer(customer_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM customers WHERE id = %s", (customer_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _fmt(row)


@router.get("/{customer_id}/ledger")
def get_customer_ledger(
    customer_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    """Retrieve credit account ledger history for this customer."""
    offset = (page - 1) * page_size
    with db.cursor() as cur:
        cur.execute("SELECT id FROM customers WHERE id = %s", (customer_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Customer not found")

        cur.execute("SELECT COUNT(*) AS total FROM customer_ledger WHERE customer_id = %s", (customer_id,))
        total = cur.fetchone()["total"]

        cur.execute(
            """SELECT cl.*, u.full_name AS created_by_name
               FROM customer_ledger cl
               LEFT JOIN users u ON u.id = cl.created_by
               WHERE cl.customer_id = %s
               ORDER BY cl.created_at DESC LIMIT %s OFFSET %s""",
            (customer_id, page_size, offset),
        )
        rows = cur.fetchall()

    items = [
        {
            **r,
            "amount": str(r["amount"]),
            "balance_after": str(r["balance_after"]),
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }
        for r in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("", status_code=201)
def create_customer(body: CustomerCreate, db=Depends(get_db), _=Depends(get_current_user)):
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO customers
               (id, name_ar, name_en, phone, national_id, notes, credit_limit, is_credit_allowed, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (new_id, body.name_ar, body.name_en, body.phone, body.national_id, body.notes,
             body.credit_limit, int(body.is_credit_allowed), now, now),
        )
    db.commit()
    with db.cursor() as cur:
        cur.execute("SELECT * FROM customers WHERE id = %s", (new_id,))
        row = cur.fetchone()
    return _fmt(row)


@router.post("/{customer_id}/payments", status_code=201)
def record_customer_payment(
    customer_id: str,
    body: CustomerPayment,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist", "cashier")),
):
    """Record a credit payment / settlement for a customer."""
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")

    now = datetime.now(timezone.utc)
    ledger_id = str(uuid.uuid4())

    with db.cursor() as cur:
        cur.execute("SELECT * FROM customers WHERE id = %s FOR UPDATE", (customer_id,))
        cust = cur.fetchone()
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        current_bal = float(cust.get("current_balance") or 0.0)
        if round(body.amount, 2) > round(current_bal, 2):
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount ({body.amount}) cannot exceed current outstanding balance ({current_bal})"
            )

        new_balance = round(current_bal - body.amount, 2)

        cur.execute(
            "UPDATE customers SET current_balance = %s, updated_at = %s WHERE id = %s",
            (new_balance, now, customer_id),
        )
        cur.execute(
            """INSERT INTO customer_ledger
               (id, customer_id, transaction_type, amount, balance_after, notes, created_by, created_at)
               VALUES (%s, %s, 'PAYMENT', %s, %s, %s, %s, %s)""",
            (ledger_id, customer_id, round(body.amount, 2), new_balance, body.notes, current_user["sub"], now),
        )

    db.commit()
    return {
        "ledger_id": ledger_id,
        "customer_id": customer_id,
        "amount_paid": str(round(body.amount, 2)),
        "previous_balance": str(current_bal),
        "new_balance": str(new_balance),
        "paid_at": now.isoformat(),
    }


@router.put("/{customer_id}")
def update_customer(customer_id: str, body: CustomerUpdate, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM customers WHERE id = %s", (customer_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Customer not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc)
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    with db.cursor() as cur:
        cur.execute(f"UPDATE customers SET {set_clause} WHERE id = %s", list(updates.values()) + [customer_id])
    db.commit()
    with db.cursor() as cur:
        cur.execute("SELECT * FROM customers WHERE id = %s", (customer_id,))
        row = cur.fetchone()
    return _fmt(row)
