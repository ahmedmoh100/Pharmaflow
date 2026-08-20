"""
Alerts Router - Provides alert endpoints for inventory management

Endpoints:
- GET /alerts/low-stock - Returns medicines below low stock threshold
- GET /alerts/expiry - Returns batches expiring within N days
- GET /alerts/expired - Returns expired batches with remaining stock
"""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from db.connection import get_db
from utils.auth import get_current_user, require_admin

router = APIRouter()


class LowStockAlert(BaseModel):
    medicine_id: str
    name_en: str
    name_ar: str
    stock_quantity: int
    low_stock_threshold: int
    deficit: int  # How many units below threshold


class ExpiryAlert(BaseModel):
    batch_id: str
    medicine_id: str
    medicine_name_en: str
    medicine_name_ar: str
    branch_id: str
    branch_name_en: str
    batch_number: str
    expiry_date: str
    days_to_expiry: int
    qty_remaining: int
    unit_cost: str


@router.get("/low-stock")
def get_low_stock_alerts(
    branch_id: str = Query(None, description="Filter by branch ID"),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Return medicines below low stock threshold
    
    Args:
        branch_id: Optional branch filter (if not provided, returns all branches)
    
    Returns:
        List of medicines that are at or below their low stock threshold
    """
    with db.cursor() as cur:
        if branch_id:
            query = """
                SELECT m.id, m.name_en, m.name_ar,
                       COALESCE(SUM(CASE WHEN b.status = 'active' AND b.qty_remaining > 0 
                                          AND b.expiry_date >= CURDATE() THEN b.qty_remaining ELSE 0 END), 0) AS stock_quantity,
                       m.low_stock_threshold
                FROM medicines m
                LEFT JOIN batches b ON b.medicine_id = m.id AND b.branch_id = %s
                WHERE m.is_active = 1
                GROUP BY m.id, m.name_en, m.name_ar, m.low_stock_threshold
                HAVING stock_quantity <= m.low_stock_threshold
                ORDER BY stock_quantity ASC
            """
            cur.execute(query, (branch_id,))
        else:
            query = """
                SELECT id, name_en, name_ar, stock_quantity, low_stock_threshold
                FROM medicines
                WHERE is_active = 1 AND stock_quantity <= low_stock_threshold
                ORDER BY stock_quantity ASC
            """
            cur.execute(query)
        
        results = cur.fetchall()
        
        alerts = []
        for row in results:
            stk = int(row["stock_quantity"])
            thresh = int(row["low_stock_threshold"])
            alerts.append({
                "medicine_id": row["id"],
                "name_en": row["name_en"],
                "name_ar": row["name_ar"],
                "stock_quantity": stk,
                "low_stock_threshold": thresh,
                "deficit": thresh - stk
            })
        
        return {"alerts": alerts, "count": len(alerts)}


@router.get("/expiry")
def get_expiry_alerts(
    days: int = Query(90, description="Alert period in days (default: 90)"),
    branch_id: str = Query(None, description="Filter by branch ID"),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Return batches expiring within N days
    
    Args:
        days: Alert period in days (default: 90)
        branch_id: Optional branch filter
    
    Returns:
        List of batches expiring within the specified period
    """
    with db.cursor() as cur:
        if branch_id:
            query = """
                SELECT b.id, b.medicine_id, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                       b.branch_id, br.name_en AS branch_name_en,
                       b.batch_number, b.expiry_date,
                       DATEDIFF(b.expiry_date, CURDATE()) AS days_to_expiry,
                       b.qty_remaining, b.unit_cost
                FROM batches b
                JOIN medicines m ON m.id = b.medicine_id
                JOIN branches br ON br.id = b.branch_id
                WHERE b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
                AND b.qty_remaining > 0 
                AND b.status = 'active'
                AND b.sfda_status NOT IN ('recalled', 'quarantined')
                AND b.branch_id = %s
                ORDER BY b.expiry_date ASC
            """
            cur.execute(query, (days, branch_id))
        else:
            query = """
                SELECT b.id, b.medicine_id, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                       b.branch_id, br.name_en AS branch_name_en,
                       b.batch_number, b.expiry_date,
                       DATEDIFF(b.expiry_date, CURDATE()) AS days_to_expiry,
                       b.qty_remaining, b.unit_cost
                FROM batches b
                JOIN medicines m ON m.id = b.medicine_id
                JOIN branches br ON br.id = b.branch_id
                WHERE b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
                AND b.qty_remaining > 0 
                AND b.status = 'active'
                AND b.sfda_status NOT IN ('recalled', 'quarantined')
                ORDER BY b.expiry_date ASC
            """
            cur.execute(query, (days,))
        
        results = cur.fetchall()
        
        alerts = []
        for row in results:
            exp_date = row["expiry_date"]
            alerts.append({
                "batch_id": row["id"],
                "medicine_id": row["medicine_id"],
                "medicine_name_en": row["medicine_name_en"],
                "medicine_name_ar": row["medicine_name_ar"],
                "branch_id": row["branch_id"],
                "branch_name_en": row["branch_name_en"],
                "batch_number": row["batch_number"],
                "expiry_date": exp_date.isoformat() if hasattr(exp_date, 'isoformat') else str(exp_date),
                "days_to_expiry": int(row["days_to_expiry"]),
                "qty_remaining": int(row["qty_remaining"]),
                "unit_cost": str(row["unit_cost"])
            })
        
        return {"alerts": alerts, "count": len(alerts)}


@router.get("/expired")
def get_expired_alerts(
    branch_id: str = Query(None, description="Filter by branch ID"),
    db=Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    """
    Return expired batches with remaining stock (requires write-off)
    
    Args:
        branch_id: Optional branch filter
    
    Returns:
        List of expired batches that still have stock (need write-off)
    """
    with db.cursor() as cur:
        if branch_id:
            query = """
                SELECT b.id, b.medicine_id, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                       b.branch_id, br.name_en AS branch_name_en,
                       b.batch_number, b.expiry_date,
                       DATEDIFF(CURDATE(), b.expiry_date) AS days_expired,
                       b.qty_remaining, b.unit_cost
                FROM batches b
                JOIN medicines m ON m.id = b.medicine_id
                JOIN branches br ON br.id = b.branch_id
                WHERE b.expiry_date < CURDATE()
                AND b.qty_remaining > 0 
                AND b.status = 'active'
                AND b.branch_id = %s
                ORDER BY b.expiry_date ASC
            """
            cur.execute(query, (branch_id,))
        else:
            query = """
                SELECT b.id, b.medicine_id, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                       b.branch_id, br.name_en AS branch_name_en,
                       b.batch_number, b.expiry_date,
                       DATEDIFF(CURDATE(), b.expiry_date) AS days_expired,
                       b.qty_remaining, b.unit_cost
                FROM batches b
                JOIN medicines m ON m.id = b.medicine_id
                JOIN branches br ON br.id = b.branch_id
                WHERE b.expiry_date < CURDATE()
                AND b.qty_remaining > 0 
                AND b.status = 'active'
                ORDER BY b.expiry_date ASC
            """
            cur.execute(query)
        
        results = cur.fetchall()
        
        alerts = []
        for row in results:
            exp_date = row["expiry_date"]
            alerts.append({
                "batch_id": row["id"],
                "medicine_id": row["medicine_id"],
                "medicine_name_en": row["medicine_name_en"],
                "medicine_name_ar": row["medicine_name_ar"],
                "branch_id": row["branch_id"],
                "branch_name_en": row["branch_name_en"],
                "batch_number": row["batch_number"],
                "expiry_date": exp_date.isoformat() if hasattr(exp_date, 'isoformat') else str(exp_date),
                "days_expired": int(row["days_expired"]),
                "qty_remaining": int(row["qty_remaining"]),
                "unit_cost": str(row["unit_cost"])
            })
        
        return {"alerts": alerts, "count": len(alerts)}