"""
Suppliers routes:
  GET    /suppliers          — paginated list
  GET    /suppliers/{id}     — single supplier
  POST   /suppliers          — create (admin)
  PUT    /suppliers/{id}     — update (admin)
  DELETE /suppliers/{id}     — soft delete (admin)
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from db.connection import get_db
from utils.auth import get_current_user, require_roles
from utils.audit import log_action

router = APIRouter()


def _fmt(row: dict) -> dict:
    return {
        **row,
        "is_active":   bool(row["is_active"]),
        "lead_time_days": int(row.get("lead_time_days", 7)),
        "reliability_score": float(row.get("reliability_score", 100.00)),
        "created_at":  row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        "updated_at":  row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
    }


@router.get("")
def list_suppliers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    is_active: str = Query("true", description="true | false | all"),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions: list[str] = []
    params: list = []

    if is_active == "all":
        pass
    elif is_active == "false":
        conditions.append("is_active = 0")
    else:
        conditions.append("is_active = 1")

    if search:
        conditions.append("(name_en LIKE %s OR name_ar LIKE %s OR tax_number LIKE %s)")
        like = f"%{search}%"
        params += [like, like, like]

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM suppliers {where}", params)
        total = cur.fetchone()["total"]
        cur.execute(f"SELECT * FROM suppliers {where} ORDER BY name_en ASC LIMIT %s OFFSET %s", params + [page_size, offset])
        rows = cur.fetchall()

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{supplier_id}")
def get_supplier(supplier_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM suppliers WHERE id = %s", (supplier_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return _fmt(row)


@router.post("", status_code=201)
def create_supplier(body: dict, db=Depends(get_db), current_user: dict = Depends(require_roles("admin", "inventory_manager", "branch_manager"))):
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO suppliers (id, name_en, name_ar, tax_number, contact_person, phone, email, address, supplier_type, lead_time_days, reliability_score, is_active, created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s)",
            (new_id, body.get("name_en",""), body.get("name_ar",""), body.get("tax_number",""),
             body.get("contact_person",""), body.get("phone",""), body.get("email",""),
             body.get("address",""), body.get("supplier_type","distributor"),
             body.get("lead_time_days", 7), body.get("reliability_score", 100.00), now, now),
        )
    db.commit()
    with db.cursor() as cur:
        cur.execute("SELECT * FROM suppliers WHERE id = %s", (new_id,))
        row = cur.fetchone()
    log_action(db, current_user["sub"], current_user["branch_id"],
               "supplier", "CREATE", entity_id=new_id,
               after={"name_en": body.get("name_en"), "name_ar": body.get("name_ar")})
    return _fmt(row)


@router.put("/{supplier_id}")
def update_supplier(supplier_id: str, body: dict, db=Depends(get_db), current_user: dict = Depends(require_roles("admin", "inventory_manager", "branch_manager"))):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM suppliers WHERE id = %s", (supplier_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Supplier not found")
    allowed = {"name_en","name_ar","tax_number","contact_person","phone","email","address","supplier_type","lead_time_days","reliability_score","is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")
    updates["updated_at"] = datetime.now(timezone.utc)
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    with db.cursor() as cur:
        cur.execute(f"UPDATE suppliers SET {set_clause} WHERE id = %s", list(updates.values()) + [supplier_id])
    db.commit()
    with db.cursor() as cur:
        cur.execute("SELECT * FROM suppliers WHERE id = %s", (supplier_id,))
        row = cur.fetchone()
    log_action(db, current_user["sub"], current_user["branch_id"],
               "supplier", "UPDATE", entity_id=supplier_id, after=updates)
    return _fmt(row)


@router.delete("/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: str, db=Depends(get_db), current_user: dict = Depends(require_roles("admin", "inventory_manager", "branch_manager"))):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM suppliers WHERE id = %s", (supplier_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Supplier not found")
        cur.execute("UPDATE suppliers SET is_active = 0, updated_at = NOW() WHERE id = %s", (supplier_id,))
    db.commit()
