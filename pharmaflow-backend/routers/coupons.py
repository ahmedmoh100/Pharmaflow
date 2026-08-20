"""Coupon management endpoints."""
import uuid
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from db.connection import get_db
from utils.auth import get_current_user, require_admin, require_roles

router = APIRouter()

class CouponValidationResponse(BaseModel):
    id: str
    code: str
    type: str  # 'employee' | 'promotional'
    discount_type: str  # 'percentage' | 'fixed'
    discount_value: float
    description_en: str
    description_ar: str
    is_valid: bool  # Can be used right now
    reason_invalid: str | None  # Why it's not valid (expired, max uses reached, etc.)


@router.get("/validate/{code}", response_model=CouponValidationResponse)
def validate_coupon(code: str, session = Depends(get_db)):
    """Validate a coupon code and return discount details.
    
    Returns:
        - is_valid=True if coupon can be used now
        - is_valid=False + reason_invalid if it cannot be used
    """
    with session.cursor() as cur:
        cur.execute("""
            SELECT id, code, type, discount_type, discount_value, 
                   description_en, description_ar, valid_from, valid_until, 
                   max_uses, usage_count, is_active
            FROM coupons
            WHERE code = %s
        """, (code.upper(),))
        row = cur.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Coupon not found")
    
    coupon = {
        'id': row['id'], 'code': row['code'], 'type': row['type'], 'discount_type': row['discount_type'],
        'discount_value': float(row['discount_value']), 'description_en': row['description_en'], 
        'description_ar': row['description_ar'],
        'valid_from': row['valid_from'], 'valid_until': row['valid_until'], 'max_uses': row['max_uses'], 
        'usage_count': row['usage_count'], 'is_active': row['is_active']
    }
    
    if not coupon['is_active']:
        return CouponValidationResponse(
            id=coupon['id'], code=coupon['code'], type=coupon['type'],
            discount_type=coupon['discount_type'], discount_value=coupon['discount_value'],
            description_en=coupon['description_en'], description_ar=coupon['description_ar'],
            is_valid=False, reason_invalid="Coupon has been deactivated"
        )
    
    today = date.today()
    
    # Check date range
    if coupon['valid_from'] and today < coupon['valid_from']:
        return CouponValidationResponse(
            id=coupon['id'], code=coupon['code'], type=coupon['type'],
            discount_type=coupon['discount_type'], discount_value=coupon['discount_value'],
            description_en=coupon['description_en'], description_ar=coupon['description_ar'],
            is_valid=False, reason_invalid=f"Not valid until {coupon['valid_from'].isoformat()}"
        )
    
    if coupon['valid_until'] and today > coupon['valid_until']:
        return CouponValidationResponse(
            id=coupon['id'], code=coupon['code'], type=coupon['type'],
            discount_type=coupon['discount_type'], discount_value=coupon['discount_value'],
            description_en=coupon['description_en'], description_ar=coupon['description_ar'],
            is_valid=False, reason_invalid=f"Expired on {coupon['valid_until'].isoformat()}"
        )
    
    # Check usage limit
    if coupon['max_uses'] and coupon['usage_count'] >= coupon['max_uses']:
        return CouponValidationResponse(
            id=coupon['id'], code=coupon['code'], type=coupon['type'],
            discount_type=coupon['discount_type'], discount_value=coupon['discount_value'],
            description_en=coupon['description_en'], description_ar=coupon['description_ar'],
            is_valid=False, reason_invalid="Coupon has reached maximum uses"
        )
    
    # Valid!
    return CouponValidationResponse(
        id=coupon['id'], code=coupon['code'], type=coupon['type'],
        discount_type=coupon['discount_type'], discount_value=coupon['discount_value'],
        description_en=coupon['description_en'], description_ar=coupon['description_ar'],
        is_valid=True, reason_invalid=None
    )


class CouponListItem(BaseModel):
    id: str
    code: str
    type: str
    discount_type: str
    discount_value: float
    description_en: str
    description_ar: str
    valid_from: date | None
    valid_until: date | None
    max_uses: int | None
    usage_count: int
    is_active: bool


@router.get("/", response_model=list[CouponListItem])
def list_coupons(
    session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """List all coupons (admin only)."""
    if current_user['role'] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can view coupons")
    
    with session.cursor() as cur:
        cur.execute("""
            SELECT id, code, type, discount_type, discount_value, description_en,
                   description_ar, valid_from, valid_until, max_uses, usage_count, is_active
            FROM coupons
            ORDER BY code
        """)
        rows = cur.fetchall()
    
    return [
        CouponListItem(
            id=row['id'], code=row['code'], type=row['type'], discount_type=row['discount_type'],
            discount_value=float(row['discount_value']), description_en=row['description_en'], 
            description_ar=row['description_ar'],
            valid_from=row['valid_from'], valid_until=row['valid_until'], max_uses=row['max_uses'], 
            usage_count=row['usage_count'], is_active=row['is_active']
        )
        for row in rows
    ]


# ── Create coupon ─────────────────────────────────────────────────────────────

class CouponCreateRequest(BaseModel):
    code: str
    type: str = "promotional"          # employee | promotional
    discount_type: str                 # percentage | fixed
    discount_value: float
    description_en: str = ""
    description_ar: str = ""
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    max_uses: Optional[int] = None


@router.post("/", status_code=201)
def create_coupon(
    body: CouponCreateRequest,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "branch_manager")),
):
    """Create a new coupon (admin only)."""
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    if body.discount_type not in ("percentage", "fixed"):
        raise HTTPException(status_code=400, detail="discount_type must be 'percentage' or 'fixed'")
    if body.discount_value <= 0:
        raise HTTPException(status_code=400, detail="discount_value must be > 0")
    if body.discount_type == "percentage" and body.discount_value > 100:
        raise HTTPException(status_code=400, detail="Percentage discount cannot exceed 100")

    # Check duplicate code
    with db.cursor() as cur:
        cur.execute("SELECT id FROM coupons WHERE code = %s", (code,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail=f"Coupon code '{code}' already exists")

    coupon_id = str(uuid.uuid4())
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO coupons
               (id, code, type, discount_type, discount_value,
                description_en, description_ar, applies_to,
                valid_from, valid_until, max_uses, usage_count,
                is_active, created_by, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'all_items',%s,%s,%s,0,1,%s,NOW())""",
            (
                coupon_id, code, body.type, body.discount_type,
                round(body.discount_value, 3),
                body.description_en, body.description_ar,
                body.valid_from, body.valid_until, body.max_uses,
                current_user["sub"],
            ),
        )
    db.commit()

    return {
        "id": coupon_id,
        "code": code,
        "type": body.type,
        "discount_type": body.discount_type,
        "discount_value": body.discount_value,
        "is_active": True,
        "usage_count": 0,
    }


# ── Update coupon ─────────────────────────────────────────────────────────────

class CouponUpdateRequest(BaseModel):
    is_active: Optional[bool] = None
    valid_until: Optional[date] = None
    max_uses: Optional[int] = None
    description_en: Optional[str] = None
    description_ar: Optional[str] = None


@router.put("/{coupon_id}")
def update_coupon(
    coupon_id: str,
    body: CouponUpdateRequest,
    db=Depends(get_db),
    current_user=Depends(require_roles("admin", "branch_manager")),
):
    """Update coupon — toggle active, change expiry / limits (admin only)."""
    with db.cursor() as cur:
        cur.execute("SELECT id FROM coupons WHERE id = %s", (coupon_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Coupon not found")

    fields, params = [], []
    if body.is_active is not None:
        fields.append("is_active = %s"); params.append(1 if body.is_active else 0)
    if body.valid_until is not None:
        fields.append("valid_until = %s"); params.append(body.valid_until)
    if body.max_uses is not None:
        fields.append("max_uses = %s"); params.append(body.max_uses)
    if body.description_en is not None:
        fields.append("description_en = %s"); params.append(body.description_en)
    if body.description_ar is not None:
        fields.append("description_ar = %s"); params.append(body.description_ar)

    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")

    params.append(coupon_id)
    with db.cursor() as cur:
        cur.execute(f"UPDATE coupons SET {', '.join(fields)} WHERE id = %s", params)
    db.commit()

    return {"id": coupon_id, "updated": True}
