"""
Users routes (admin only):
  GET  /users       — paginated list
  GET  /users/{id}  — single user
  POST /users       — create
  PUT  /users/{id}  — update
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from db.connection import get_db
from utils.auth import require_admin, hash_password
from utils.audit import log_action

router = APIRouter()


def _fmt(row: dict) -> dict:
    return {
        **row,
        "is_active":      bool(row["is_active"]),
        "password_hash":  "***",   # never expose hash
        "created_at":     row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        "updated_at":     row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
        "last_login_at":  row["last_login_at"].isoformat() if row.get("last_login_at") and hasattr(row["last_login_at"], "isoformat") else None,
    }


@router.get("")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    role: str = Query(""),
    is_active: str = Query("true", description="true | false | all"),
    db=Depends(get_db),
    _=Depends(require_admin),
):
    offset = (page - 1) * page_size
    conditions = []
    params: list = []

    if is_active == "false":
        conditions.append("u.is_active = 0")
    elif is_active != "all":
        conditions.append("u.is_active = 1")

    if role:
        conditions.append("u.role = %s")
        params.append(role)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM users u {where}", params)
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT u.*, b.name_en AS branch_name_en, b.name_ar AS branch_name_ar
                FROM users u
                LEFT JOIN branches b ON b.id = u.branch_id
                {where}
                ORDER BY u.full_name ASC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{user_id}")
def get_user(user_id: str, db=Depends(get_db), _=Depends(require_admin)):
    with db.cursor() as cur:
        cur.execute(
            """SELECT u.*, b.name_en AS branch_name_en, b.name_ar AS branch_name_ar
               FROM users u LEFT JOIN branches b ON b.id = u.branch_id
               WHERE u.id = %s""",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return _fmt(row)


@router.post("", status_code=201)
def create_user(body: dict, db=Depends(get_db), current_user: dict = Depends(require_admin)):
    required = ["email", "password", "full_name", "role", "branch_id"]
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"Missing: {f}")

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE email = %s", (body["email"],))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Email already in use")

        cur.execute(
            "INSERT INTO users (id, branch_id, email, password_hash, full_name, phone, role, is_active, created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,1,%s,%s)",
            (new_id, body["branch_id"], body["email"], hash_password(body["password"]),
             body["full_name"], body.get("phone", ""), body["role"], now, now),
        )
    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT u.*, b.name_en AS branch_name_en, b.name_ar AS branch_name_ar FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = %s", (new_id,))
        row = cur.fetchone()
    log_action(db, current_user["sub"], current_user["branch_id"],
               "user", "CREATE", entity_id=new_id,
               after={"email": body.get("email"), "role": body.get("role"), "full_name": body.get("full_name")})
    return _fmt(row)


@router.put("/{user_id}")
def update_user(user_id: str, body: dict, db=Depends(get_db), current_user: dict = Depends(require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

    allowed = {"full_name", "phone", "role", "branch_id", "is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}

    # Allow password reset
    if body.get("password"):
        updates["password_hash"] = hash_password(body["password"])

    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")

    updates["updated_at"] = datetime.now(timezone.utc)
    set_clause = ", ".join(f"{k} = %s" for k in updates)

    with db.cursor() as cur:
        cur.execute(f"UPDATE users SET {set_clause} WHERE id = %s", list(updates.values()) + [user_id])
    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT u.*, b.name_en AS branch_name_en, b.name_ar AS branch_name_ar FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = %s", (user_id,))
        row = cur.fetchone()
    action = "RESET_PASSWORD" if body.get("password") else "UPDATE"
    log_action(db, current_user["sub"], current_user["branch_id"],
               "user", action, entity_id=user_id,
               after={k: v for k, v in updates.items() if k not in ("password_hash", "updated_at")})
    return _fmt(row)
