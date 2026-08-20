"""
Medicines routes:
  GET    /medicines           — paginated list with search
  GET    /medicines/{id}      — single medicine
  POST   /medicines           — create (admin only)
  PUT    /medicines/{id}      — update (admin only)
  DELETE /medicines/{id}      — soft delete: set is_active = false (admin only)
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from db.connection import get_db
from models.schemas import MedicineResponse, MedicineCreate, MedicineUpdate
from utils.auth import get_current_user, require_admin, require_roles
from utils.audit import log_action

router = APIRouter()


def _format_medicine(row: dict) -> dict:
    """Convert DB row to API response — money fields as strings."""
    return {
        **row,
        "selling_price": str(row["selling_price"]),
        "max_public_price": str(row["max_public_price"]),
        "requires_prescription": bool(row["requires_prescription"]),
        "is_controlled": bool(row.get("is_controlled", 0)),
        "requires_cold_chain": bool(row["requires_cold_chain"]),
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
    }


@router.get("")
def list_medicines(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="Search by name or barcode"),
    category: str = Query(""),
    low_stock: bool = Query(False),
    is_active: str = Query("true", description="true | false | all"),
    branch_id: str = Query("", description="If set, stock_quantity reflects this branch only"),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions = []
    params: list = []

    if is_active == "all":
        pass  # no filter
    elif is_active == "false":
        conditions.append("is_active = 0")
    else:
        conditions.append("is_active = 1")

    if search:
        conditions.append("(name_en LIKE %s OR name_ar LIKE %s OR barcode = %s OR generic_name LIKE %s)")
        like = f"%{search}%"
        params += [like, like, search, like]

    if category:
        conditions.append("category = %s")
        params.append(category)

    if low_stock and not branch_id:
        conditions.append("stock_quantity <= low_stock_threshold")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM medicines {where}", params)
        total = cur.fetchone()["total"]

        if branch_id:
            # Return branch-specific stock_quantity from batches.
            # When low_stock is also requested, use HAVING to filter after the subquery resolves.
            having = "HAVING stock_quantity <= m.low_stock_threshold" if low_stock else ""
            cur.execute(
                f"""SELECT m.id, m.name_en, m.name_ar, m.generic_name, m.barcode,
                           m.category, m.form, m.strength, m.unit,
                           m.selling_price, m.max_public_price,
                           m.low_stock_threshold, m.requires_prescription,
                           m.is_controlled, m.vat_category, m.requires_cold_chain,
                           m.sfda_registration_no, m.is_active,
                           m.created_at, m.updated_at,
                           COALESCE((
                               SELECT SUM(b.qty_remaining)
                               FROM batches b
                               WHERE b.medicine_id = m.id
                                 AND b.branch_id = %s
                                 AND b.status = 'active'
                                 AND b.sfda_status NOT IN ('recalled', 'quarantined')
                                 AND b.qty_remaining > 0
                                 AND b.expiry_date >= CURDATE()
                           ), 0) AS stock_quantity
                    FROM medicines m {where} {having} ORDER BY m.name_en ASC LIMIT %s OFFSET %s""",
                [branch_id] + params + [page_size, offset],
            )
        else:
            cur.execute(
                f"SELECT * FROM medicines {where} ORDER BY name_en ASC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
        rows = cur.fetchall()

    return {
        "items": [_format_medicine(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{medicine_id}", response_model=MedicineResponse)
def get_medicine(medicine_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM medicines WHERE id = %s AND is_active = 1", (medicine_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medicine not found")

    return _format_medicine(row)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=MedicineResponse)
def create_medicine(
    body: MedicineCreate,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO medicines (
                id, name_en, name_ar, generic_name, barcode, category, form, strength, unit,
                selling_price, stock_quantity, low_stock_threshold, requires_prescription, is_controlled,
                vat_category, requires_cold_chain, sfda_registration_no, max_public_price,
                is_active, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, 0, %s, %s, %s,
                %s, %s, %s, %s,
                1, %s, %s
            )
            """,
            (
                new_id, body.name_en, body.name_ar, body.generic_name, body.barcode,
                body.category, body.form, body.strength, body.unit,
                body.selling_price, body.low_stock_threshold, body.requires_prescription, int(body.is_controlled),
                body.vat_category, body.requires_cold_chain, body.sfda_registration_no,
                body.max_public_price, now, now,
            ),
        )
    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT * FROM medicines WHERE id = %s", (new_id,))
        row = cur.fetchone()

    log_action(db, current_user["sub"], current_user["branch_id"],
               "medicine", "CREATE", entity_id=new_id,
               after={"name_en": body.name_en, "name_ar": body.name_ar})

    return _format_medicine(row)


@router.put("/{medicine_id}", response_model=MedicineResponse)
def update_medicine(
    medicine_id: str,
    body: MedicineUpdate,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM medicines WHERE id = %s", (medicine_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medicine not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc)
    set_clause = ", ".join(f"{k} = %s" for k in updates)

    with db.cursor() as cur:
        cur.execute(
            f"UPDATE medicines SET {set_clause} WHERE id = %s",
            list(updates.values()) + [medicine_id],
        )
    db.commit()

    with db.cursor() as cur:
        cur.execute("SELECT * FROM medicines WHERE id = %s", (medicine_id,))
        row = cur.fetchone()

    log_action(db, current_user["sub"], current_user["branch_id"],
               "medicine", "UPDATE", entity_id=medicine_id,
               after={k: v for k, v in updates.items() if k != "updated_at"})

    return _format_medicine(row)


@router.delete("/{medicine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_medicine(
    medicine_id: str,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "inventory_manager", "branch_manager")),
):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM medicines WHERE id = %s", (medicine_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medicine not found")

        cur.execute(
            "UPDATE medicines SET is_active = 0, updated_at = NOW() WHERE id = %s",
            (medicine_id,),
        )
    db.commit()


@router.get("/{medicine_id}/movements")
def get_medicine_movements(
    medicine_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
    _=Depends(get_current_user),
):
    """Stock movement history for a medicine."""
    offset = (page - 1) * page_size
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS total FROM stock_movements WHERE medicine_id = %s", (medicine_id,))
        total = cur.fetchone()["total"]
        cur.execute(
            """SELECT sm.*, u.full_name AS user_name
               FROM stock_movements sm
               LEFT JOIN users u ON u.id = sm.created_by
               WHERE sm.medicine_id = %s
               ORDER BY sm.created_at DESC
               LIMIT %s OFFSET %s""",
            (medicine_id, page_size, offset),
        )
        rows = cur.fetchall()

    def _fmt(r: dict) -> dict:
        return {
            **r,
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/controlled/registry")
def get_controlled_dispense_registry(
    medicine_id: str = Query("", description="Filter by medicine ID"),
    patient_id: str = Query("", description="Filter by patient National ID / Iqama"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "auditor", "branch_manager", "pharmacist")),
):
    """
    Official narcotics and controlled substance dispensing registry.
    Accessible to pharmacists, branch managers, and administrators for regulatory audits.
    """
    offset = (page - 1) * page_size
    conditions = []
    params: list = []

    if medicine_id:
        conditions.append("cdl.medicine_id = %s")
        params.append(medicine_id)
    if patient_id:
        conditions.append("cdl.patient_national_id = %s")
        params.append(patient_id)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM controlled_dispense_log cdl {where}", params)
        total = cur.fetchone()["total"]

        cur.execute(
            f"""SELECT cdl.*, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                       u.full_name AS authorizing_user_name, s.invoice_number
                FROM controlled_dispense_log cdl
                JOIN medicines m ON m.id = cdl.medicine_id
                JOIN users u ON u.id = cdl.authorizing_user_id
                JOIN sales s ON s.id = cdl.sale_id
                {where}
                ORDER BY cdl.dispensed_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        rows = cur.fetchall()

    def _fmt(r: dict) -> dict:
        return {
            **r,
            "dispensed_at": r["dispensed_at"].isoformat() if hasattr(r["dispensed_at"], "isoformat") else str(r["dispensed_at"]),
        }

    return {"items": [_fmt(r) for r in rows], "total": total, "page": page, "page_size": page_size}
