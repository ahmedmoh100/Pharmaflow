"""
Dashboard routes:
  GET /dashboard/summary  — KPI cards: today's revenue, transactions, low stock, expiring
  GET /dashboard/branch-comparison — per-branch sales totals
"""

from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from db.connection import get_db
from utils.auth import get_current_user

router = APIRouter()


@router.get("/summary")
def dashboard_summary(
    branch_id: str = Query(""),
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    ninety_days = (date.today() + timedelta(days=90)).isoformat()
    thirty_days = (date.today() + timedelta(days=30)).isoformat()

    b_clause = "AND branch_id = %s" if branch_id else ""

    with db.cursor() as cur:

        # ── Today's sales ─────────────────────────────────────────────────────
        params = (today, branch_id) if branch_id else (today,)
        cur.execute(
            f"SELECT COUNT(*) AS sales_count, COALESCE(SUM(total_amount),0) AS revenue, COALESCE(SUM(vat_amount),0) AS vat FROM sales WHERE DATE(sold_at) = %s {b_clause}",
            params,
        )
        today_row = cur.fetchone()

        # ── Yesterday's revenue (for trend %) ────────────────────────────────
        params_y = (yesterday, branch_id) if branch_id else (yesterday,)
        cur.execute(
            f"SELECT COALESCE(SUM(total_amount),0) AS revenue FROM sales WHERE DATE(sold_at) = %s {b_clause}",
            params_y,
        )
        yesterday_row = cur.fetchone()

        # ── Low stock: per-branch batch stock vs threshold ────────────────────
        low_b_clause = "AND b.branch_id = %s" if branch_id else ""
        low_params = (branch_id,) if branch_id else ()
        cur.execute(
            f"""
            SELECT COUNT(*) AS cnt FROM (
                SELECT b.medicine_id, b.branch_id,
                       SUM(b.qty_remaining) AS branch_stock,
                       m.low_stock_threshold
                FROM batches b
                JOIN medicines m ON m.id = b.medicine_id
                WHERE b.status = 'active' AND m.is_active = 1 {low_b_clause}
                GROUP BY b.medicine_id, b.branch_id, m.low_stock_threshold
                HAVING branch_stock <= m.low_stock_threshold
            ) AS low_branches
            """,
            low_params,
        )
        low_stock_row = cur.fetchone()

        # ── Out of stock ──────────────────────────────────────────────────────
        cur.execute(
            f"""
            SELECT COUNT(*) AS cnt FROM (
                SELECT b.medicine_id, b.branch_id,
                       SUM(b.qty_remaining) AS branch_stock
                FROM batches b
                JOIN medicines m ON m.id = b.medicine_id
                WHERE b.status = 'active' AND m.is_active = 1 {low_b_clause}
                GROUP BY b.medicine_id, b.branch_id
                HAVING branch_stock = 0
            ) AS oos
            """,
            low_params,
        )
        out_of_stock_row = cur.fetchone()

        # ── Expiring within 90 days ───────────────────────────────────────────
        exp_b_clause = "AND branch_id = %s" if branch_id else ""
        exp_params_90 = (ninety_days, branch_id) if branch_id else (ninety_days,)
        exp_params_30 = (thirty_days, branch_id) if branch_id else (thirty_days,)
        cur.execute(
            f"SELECT COUNT(*) AS cnt FROM batches WHERE expiry_date <= %s AND expiry_date >= CURDATE() AND qty_remaining > 0 AND status = 'active' AND sfda_status NOT IN ('recalled','quarantined') {exp_b_clause}",
            exp_params_90,
        )
        expiring_90_row = cur.fetchone()

        # ── Expiring within 30 days ───────────────────────────────────────────
        cur.execute(
            f"SELECT COUNT(*) AS cnt FROM batches WHERE expiry_date <= %s AND expiry_date >= CURDATE() AND qty_remaining > 0 AND status = 'active' AND sfda_status NOT IN ('recalled','quarantined') {exp_b_clause}",
            exp_params_30,
        )
        expiring_30_row = cur.fetchone()

        # ── Expired but still has stock ───────────────────────────────────────
        exp_expired_params = (branch_id,) if branch_id else ()
        cur.execute(
            f"SELECT COUNT(*) AS cnt FROM batches WHERE expiry_date < CURDATE() AND qty_remaining > 0 {exp_b_clause}",
            exp_expired_params,
        )
        expired_row = cur.fetchone()

        # ── Total active medicines ────────────────────────────────────────────
        cur.execute("SELECT COUNT(*) AS cnt FROM medicines WHERE is_active = 1")
        total_med_row = cur.fetchone()

        # ── Sales last 30 days sparkline ──────────────────────────────────────
        spark_params = (branch_id,) if branch_id else ()
        cur.execute(
            f"""
            SELECT DATE(sold_at) AS day, COALESCE(SUM(total_amount), 0) AS total
            FROM sales
            WHERE sold_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) {b_clause}
            GROUP BY DATE(sold_at)
            ORDER BY day ASC
            """,
            spark_params,
        )
        sparkline_rows = cur.fetchall()

    today_revenue = float(today_row["revenue"])
    yesterday_revenue = float(yesterday_row["revenue"])
    trend = 0.0
    if yesterday_revenue > 0:
        trend = round(((today_revenue - yesterday_revenue) / yesterday_revenue) * 100, 1)

    sparkline = [float(r["total"]) for r in sparkline_rows]

    return {
        "today_sales_count":  today_row["sales_count"],
        "today_revenue":      str(round(today_revenue, 3)),
        "today_vat":          str(round(float(today_row["vat"]), 3)),
        "revenue_trend":      trend,
        "sparkline_30d":      sparkline,
        "low_stock_count":    low_stock_row["cnt"],
        "out_of_stock_count": out_of_stock_row["cnt"],
        "expiring_90_count":  expiring_90_row["cnt"],
        "expiring_30_count":  expiring_30_row["cnt"],
        "expired_count":      expired_row["cnt"],
        "total_medicines":    total_med_row["cnt"],
    }


@router.get("/branch-comparison")
def branch_comparison(db=Depends(get_db), _=Depends(get_current_user)):
    """Sales count and revenue per branch — always chain-wide."""
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT
                b.id, b.code, b.name_en, b.name_ar, b.city_en, b.city_ar,
                COUNT(s.id) AS sales_count,
                COALESCE(SUM(s.total_amount), 0) AS revenue
            FROM branches b
            LEFT JOIN sales s ON s.branch_id = b.id
            WHERE b.is_active = 1
            GROUP BY b.id, b.code, b.name_en, b.name_ar, b.city_en, b.city_ar
            ORDER BY revenue DESC
            """
        )
        rows = cur.fetchall()

    total_revenue = sum(float(r["revenue"]) for r in rows)

    return {
        "branches": [
            {
                "id":          r["id"],
                "code":        r["code"],
                "name_en":     r["name_en"],
                "name_ar":     r["name_ar"],
                "city_en":     r["city_en"],
                "city_ar":     r["city_ar"],
                "sales_count": r["sales_count"],
                "revenue":     str(round(float(r["revenue"]), 3)),
                "share_pct":   round((float(r["revenue"]) / total_revenue * 100) if total_revenue > 0 else 0, 1),
            }
            for r in rows
        ]
    }
