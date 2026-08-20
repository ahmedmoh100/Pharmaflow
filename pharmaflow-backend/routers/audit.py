"""Audit log route — GET /audit (admin only)"""

from fastapi import APIRouter, Depends, Query
from db.connection import get_db
from utils.auth import require_auditor_or_admin

router = APIRouter()


@router.get("")
def list_audit(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    entity: str = Query(""),
    action: str = Query(""),
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(require_auditor_or_admin),
):
    offset = (page - 1) * page_size
    conditions: list[str] = []
    params: list = []

    if entity:
        conditions.append("a.entity = %s")
        params.append(entity)

    if action:
        conditions.append("a.action = %s")
        params.append(action)

    if branch_id:
        conditions.append("a.branch_id = %s")
        params.append(branch_id)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM audit_log a {where}", params)
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT a.*, u.full_name AS user_name
                FROM audit_log a
                LEFT JOIN users u ON u.id = a.user_id
                {where}
                ORDER BY a.created_at DESC
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
