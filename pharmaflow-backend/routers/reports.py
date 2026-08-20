"""
Reports routes:
  GET /reports/inventory  — stock summary, category breakdown, low stock list
  GET /reports/purchases  — spend by supplier, spend by medicine, date range
  GET /reports/sales      — deferred until real sales exist (returns empty shape)
"""

from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from db.connection import get_db
from utils.auth import require_roles

router = APIRouter()


@router.get("/inventory")
def inventory_report(
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(require_roles("admin", "branch_manager", "auditor")),
):
    with db.cursor() as cur:
        # Build per-medicine stock — branch-specific or chain total
        if branch_id:
            cur.execute("""
                SELECT medicine_id, SUM(qty_remaining) AS branch_stock
                FROM batches
                WHERE branch_id = %s
                  AND status = 'active'
                  AND sfda_status NOT IN ('recalled','quarantined')
                  AND qty_remaining > 0
                  AND expiry_date >= CURDATE()
                GROUP BY medicine_id
            """, (branch_id,))
            stock_map = {r["medicine_id"]: int(r["branch_stock"]) for r in cur.fetchall()}
        else:
            stock_map = None  # use medicines.stock_quantity (chain cached total)

        # All active medicines
        cur.execute("SELECT id, name_en, name_ar, category, stock_quantity, low_stock_threshold, selling_price FROM medicines WHERE is_active = 1")
        all_meds = cur.fetchall()

    # Apply branch stock override if needed
    def stock_of(m):
        if stock_map is not None:
            return stock_map.get(m["id"], 0)
        return int(m["stock_quantity"])

    total_medicines = len(all_meds)
    low_stock_count = sum(1 for m in all_meds if stock_of(m) <= m["low_stock_threshold"])
    inventory_value = sum(stock_of(m) * float(m["selling_price"]) for m in all_meds)

    # By category
    from collections import defaultdict
    cat_data = defaultdict(lambda: {"medicine_count": 0, "total_units": 0, "total_value": 0.0})
    for m in all_meds:
        s = stock_of(m)
        cat_data[m["category"]]["medicine_count"] += 1
        cat_data[m["category"]]["total_units"] += s
        cat_data[m["category"]]["total_value"] += s * float(m["selling_price"])

    by_category = sorted(
        [{"category": cat, **vals} for cat, vals in cat_data.items()],
        key=lambda x: x["total_value"], reverse=True
    )

    # Low stock list
    low_stock_list = sorted(
        [m for m in all_meds if stock_of(m) <= m["low_stock_threshold"]],
        key=stock_of
    )[:20]

    return {
        "total_medicines": total_medicines,
        "low_stock_count": low_stock_count,
        "inventory_value": str(round(inventory_value, 3)),
        "by_category": [
            {
                "category": r["category"],
                "medicine_count": r["medicine_count"],
                "total_units": r["total_units"],
                "total_value": str(round(r["total_value"], 3)),
            }
            for r in by_category
        ],
        "low_stock_list": [
            {
                "id": m["id"],
                "name_en": m["name_en"],
                "name_ar": m["name_ar"],
                "category": m["category"],
                "stock_quantity": stock_of(m),
                "low_stock_threshold": int(m["low_stock_threshold"]),
                "selling_price": str(m["selling_price"]),
            }
            for m in low_stock_list
        ],
    }


@router.get("/purchases")
def purchases_report(
    from_date: str = Query(""),
    to_date: str = Query(""),
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(require_roles("admin", "branch_manager", "auditor")),
):
    if not from_date:
        from_date = (date.today() - timedelta(days=30)).isoformat()
    if not to_date:
        to_date = date.today().isoformat()

    b_clause = "AND b.branch_id = %s" if branch_id else ""
    def bp(base): return base + [branch_id] if branch_id else base

    with db.cursor() as cur:
        cur.execute(f"""
            SELECT s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar,
                   COUNT(b.id) AS batch_count,
                   SUM(b.qty_received * b.unit_cost) AS total_spend
            FROM batches b LEFT JOIN suppliers s ON s.id = b.supplier_id
            WHERE DATE(b.created_at) BETWEEN %s AND %s {b_clause}
            GROUP BY b.supplier_id, s.name_en, s.name_ar ORDER BY total_spend DESC
        """, bp([from_date, to_date]))
        by_supplier = cur.fetchall()

        cur.execute(f"""
            SELECT m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                   COUNT(b.id) AS batch_count,
                   SUM(b.qty_received) AS total_units,
                   SUM(b.qty_received * b.unit_cost) AS total_spend
            FROM batches b LEFT JOIN medicines m ON m.id = b.medicine_id
            WHERE DATE(b.created_at) BETWEEN %s AND %s {b_clause}
            GROUP BY b.medicine_id, m.name_en, m.name_ar ORDER BY total_spend DESC LIMIT 20
        """, bp([from_date, to_date]))
        by_medicine = cur.fetchall()

        cur.execute(f"""
            SELECT COALESCE(SUM(qty_received * unit_cost), 0) AS total
            FROM batches WHERE DATE(created_at) BETWEEN %s AND %s {b_clause}
        """, bp([from_date, to_date]))
        total_spend = float(cur.fetchone()["total"])

    def _fmt_row(r: dict) -> dict:
        return {**r, "total_spend": str(round(float(r.get("total_spend") or 0), 3))}

    return {
        "from_date": from_date,
        "to_date": to_date,
        "total_spend": str(round(total_spend, 3)),
        "by_supplier": [_fmt_row(r) for r in by_supplier],
        "by_medicine": [_fmt_row(r) for r in by_medicine],
    }


@router.get("/sales/by-pharmacist")
def sales_by_pharmacist(
    from_date: str = Query(""),
    to_date: str = Query(""),
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(require_roles("admin", "branch_manager", "auditor")),
):
    """Sales aggregated by pharmacist — transaction count, revenue, VAT, avg transaction."""
    if not from_date:
        from_date = (date.today() - timedelta(days=30)).isoformat()
    if not to_date:
        to_date = date.today().isoformat()

    b_clause = "AND s.branch_id = %s" if branch_id else ""

    def bp(base_params):
        return base_params + [branch_id] if branch_id else base_params

    with db.cursor() as cur:
        cur.execute(f"""
            SELECT
                u.id AS user_id,
                u.full_name,
                b.name_en AS branch_name_en,
                b.name_ar AS branch_name_ar,
                COUNT(s.id)                         AS tx_count,
                COALESCE(SUM(s.total_amount), 0)    AS revenue,
                COALESCE(SUM(s.vat_amount), 0)      AS vat,
                COALESCE(AVG(s.total_amount), 0)    AS avg_tx
            FROM sales s
            JOIN users u  ON u.id  = s.user_id
            JOIN branches b ON b.id = s.branch_id
            WHERE DATE(s.sold_at) BETWEEN %s AND %s {b_clause}
            GROUP BY u.id, u.full_name, b.name_en, b.name_ar
            ORDER BY revenue DESC
        """, bp([from_date, to_date]))
        rows = cur.fetchall()

    return {
        "from_date": from_date,
        "to_date": to_date,
        "rows": [
            {
                "user_id":         r["user_id"],
                "full_name":       r["full_name"],
                "branch_name_en":  r["branch_name_en"],
                "branch_name_ar":  r["branch_name_ar"],
                "tx_count":        r["tx_count"],
                "revenue":         str(round(float(r["revenue"]), 3)),
                "vat":             str(round(float(r["vat"]), 3)),
                "avg_tx":          str(round(float(r["avg_tx"]), 3)),
            }
            for r in rows
        ],
    }


@router.get("/sales")
def sales_report(
    from_date: str = Query(""),
    to_date: str = Query(""),
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(require_roles("admin", "branch_manager", "auditor")),
):
    """Sales report — returns real data if sales exist, empty shape otherwise."""
    if not from_date:
        from_date = (date.today() - timedelta(days=30)).isoformat()
    if not to_date:
        to_date = date.today().isoformat()

    b_clause = "AND s.branch_id = %s" if branch_id else ""

    def bp(base_params):
        return base_params + [branch_id] if branch_id else base_params

    with db.cursor() as cur:
        cur.execute(f"""
            SELECT COALESCE(SUM(total_amount),0) AS revenue,
                   COALESCE(SUM(vat_amount),0) AS vat,
                   COUNT(*) AS count
            FROM sales s WHERE DATE(sold_at) BETWEEN %s AND %s {b_clause}
        """, bp([from_date, to_date]))
        totals = cur.fetchone()

        cur.execute(f"""
            SELECT DATE(sold_at) AS day, SUM(total_amount) AS total, COUNT(*) AS count
            FROM sales s WHERE DATE(sold_at) BETWEEN %s AND %s {b_clause}
            GROUP BY DATE(sold_at) ORDER BY day ASC
        """, bp([from_date, to_date]))
        by_day = cur.fetchall()

        cur.execute(f"""
            SELECT payment_method, COUNT(*) AS count, SUM(total_amount) AS total
            FROM sales s WHERE DATE(sold_at) BETWEEN %s AND %s {b_clause}
            GROUP BY payment_method ORDER BY total DESC
        """, bp([from_date, to_date]))
        by_payment = cur.fetchall()

        cur.execute(f"""
            SELECT si.medicine_id, m.name_en AS medicine_name_en, m.name_ar AS medicine_name_ar,
                   SUM(si.quantity) AS units_sold,
                   SUM(si.quantity * si.unit_price) AS revenue,
                   SUM(si.quantity * si.cost_at_sale) AS total_cost
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            JOIN medicines m ON m.id = si.medicine_id
            WHERE DATE(s.sold_at) BETWEEN %s AND %s {b_clause}
            GROUP BY si.medicine_id, m.name_en, m.name_ar
            ORDER BY revenue DESC LIMIT 10
        """, bp([from_date, to_date]))
        top_selling = cur.fetchall()

        cur.execute(f"""
            SELECT s.id, s.invoice_number, s.total_amount, s.vat_amount,
                   s.payment_method, s.sold_at, u.full_name AS pharmacist_name
            FROM sales s
            LEFT JOIN users u ON u.id = s.user_id
            WHERE DATE(s.sold_at) BETWEEN %s AND %s {b_clause}
            ORDER BY s.sold_at DESC LIMIT 8
        """, bp([from_date, to_date]))
        recent = cur.fetchall()

    return {
        "from_date": from_date,
        "to_date": to_date,
        "total_revenue": str(round(float(totals["revenue"]), 3)),
        "total_vat": str(round(float(totals["vat"]), 3)),
        "total_count": totals["count"],
        "by_day": [{"day": str(r["day"]), "total": str(round(float(r["total"]), 3)), "count": r["count"]} for r in by_day],
        "by_payment": [{"method": r["payment_method"], "count": r["count"], "total": str(round(float(r["total"]), 3))} for r in by_payment],
        "top_selling": [
            {
                "medicine_id": r["medicine_id"],
                "medicine_name_en": r["medicine_name_en"],
                "medicine_name_ar": r["medicine_name_ar"],
                "units_sold": r["units_sold"],
                "revenue": str(round(float(r["revenue"]), 3)),
                "total_cost": str(round(float(r["total_cost"] or 0), 3)),
                "gross_profit": str(round(float(r["revenue"]) - float(r["total_cost"] or 0), 3)),
                "margin_pct": round(
                    ((float(r["revenue"]) - float(r["total_cost"] or 0)) / float(r["revenue"]) * 100)
                    if float(r["revenue"]) > 0 else 0, 1
                ),
            }
            for r in top_selling
        ],
        "recent": [{"id": r["id"], "invoice_number": r["invoice_number"], "total_amount": str(round(float(r["total_amount"]), 3)), "vat_amount": str(round(float(r["vat_amount"]), 3)), "payment_method": r["payment_method"], "sold_at": r["sold_at"].isoformat() if hasattr(r["sold_at"], "isoformat") else str(r["sold_at"]), "pharmacist_name": r["pharmacist_name"] or "-"} for r in recent],
    }


@router.get("/vat")
def vat_report(
    from_date: str = Query(""),
    to_date: str = Query(""),
    branch_id: str = Query(""),
    db=Depends(get_db),
    _=Depends(require_roles("admin", "branch_manager", "auditor")),
):
    """VAT breakdown by month — zero-rated (medicines) vs standard (15%)."""
    if not from_date:
        from_date = (date.today() - timedelta(days=30)).isoformat()
    if not to_date:
        to_date = date.today().isoformat()

    b_clause = "AND s.branch_id = %s" if branch_id else ""
    def bp(base): return base + [branch_id] if branch_id else base

    with db.cursor() as cur:
        cur.execute(f"""
            SELECT
                DATE_FORMAT(s.sold_at, '%%Y-%%m') AS month,
                SUM(CASE WHEN si.vat_rate = 0 THEN si.quantity * si.unit_price ELSE 0 END) AS taxable_0,
                SUM(CASE WHEN si.vat_rate > 0 THEN si.quantity * si.unit_price ELSE 0 END) AS taxable_15,
                SUM(si.vat_amount) AS vat_collected,
                SUM(s.total_amount) AS grand_total
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
            WHERE DATE(s.sold_at) BETWEEN %s AND %s {b_clause}
            GROUP BY DATE_FORMAT(s.sold_at, '%%Y-%%m')
            ORDER BY month DESC
        """, bp([from_date, to_date]))
        rows = cur.fetchall()

    def _fmt(r: dict) -> dict:
        return {
            "month": r["month"],
            "taxable_0":    str(round(float(r["taxable_0"] or 0), 3)),
            "taxable_15":   str(round(float(r["taxable_15"] or 0), 3)),
            "vat_collected": str(round(float(r["vat_collected"] or 0), 3)),
            "grand_total":  str(round(float(r["grand_total"] or 0), 3)),
        }

    return {
        "from_date": from_date,
        "to_date": to_date,
        "rows": [_fmt(r) for r in rows],
    }
