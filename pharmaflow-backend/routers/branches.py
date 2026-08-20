"""
Branches routes:
  GET  /branches       — list all branches
  GET  /branches/{id}  — single branch
  POST /branches       — create (admin only)
  PUT  /branches/{id}  — update / reposition (admin only)
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from db.connection import get_db
from utils.auth import get_current_user, require_admin

router = APIRouter()


def _fmt(row: dict) -> dict:
    return {
        **row,
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
    }


@router.get("")
def list_branches(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    is_active: str = Query("true", description="true | false | all"),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    conditions: list[str] = []
    params: list = []

    if is_active == "false":
        conditions.append("is_active = 0")
    elif is_active != "all":
        conditions.append("is_active = 1")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM branches {where}", params)
        total = cur.fetchone()["total"]
        cur.execute(
            f"SELECT * FROM branches {where} ORDER BY name_en ASC LIMIT %s OFFSET %s",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{branch_id}")
def get_branch(branch_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM branches WHERE id = %s", (branch_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Branch not found")
    return _fmt(row)


@router.post("", status_code=201)
def create_branch(body: dict, db=Depends(get_db), _=Depends(require_admin)):
    required = ["name_en", "name_ar", "code", "city_en", "city_ar"]
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"Missing required field: {f}")

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        # Check unique code
        cur.execute("SELECT id FROM branches WHERE code = %s", (body["code"],))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Branch code already exists")

        cur.execute(
            """INSERT INTO branches
               (id, code, name_en, name_ar, city_en, city_ar, vat_number, address, is_active, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1, %s)""",
            (
                new_id, body["code"], body["name_en"], body["name_ar"],
                body["city_en"], body["city_ar"],
                body.get("vat_number", ""), body.get("address", ""), now,
            ),
        )
    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT * FROM branches WHERE id = %s", (new_id,))
        row = cur.fetchone()
    return _fmt(row)


@router.put("/{branch_id}")
def update_branch(branch_id: str, body: dict, db=Depends(get_db), _=Depends(require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM branches WHERE id = %s", (branch_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Branch not found")

    allowed = {"name_en", "name_ar", "city_en", "city_ar", "vat_number", "address", "is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    with db.cursor() as cur:
        cur.execute(
            f"UPDATE branches SET {set_clause} WHERE id = %s",
            list(updates.values()) + [branch_id],
        )
    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT * FROM branches WHERE id = %s", (branch_id,))
        row = cur.fetchone()
    return _fmt(row)
