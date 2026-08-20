"""
Cash session routes — real shift lifecycle.

  POST /sessions/open          — open a shift (requires opening_float)
  GET  /sessions/current       — get active session for current user (null-safe)
  POST /sessions/break/start   — pause shift (ON_BREAK)
  POST /sessions/break/end     — resume shift (OPEN)
  POST /sessions/close         — close shift + compute Z-report totals
  GET  /sessions/{id}/sales    — all sales in a session (Show Journal)
  GET  /sessions/{id}/z-report — Z-report data for a session

Status flow: OPEN → ON_BREAK → OPEN → CLOSED
Selling is blocked by the frontend when status != OPEN.
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from db.connection import get_db
from utils.auth import get_current_user

router = APIRouter()


# ── Request models ──────────────────────────────────────────────────────────

class OpenSessionRequest(BaseModel):
    opening_float: float = 0.0


class StartBreakRequest(BaseModel):
    reason: str = ""


class TenderDeclarationRequest(BaseModel):
    declared_cash: float
    notes: str = ""


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fmt_session(r: dict) -> dict:
    return {
        **r,
        "opened_at": r["opened_at"].isoformat() if hasattr(r["opened_at"], "isoformat") else str(r["opened_at"]),
        "closed_at": r["closed_at"].isoformat() if r["closed_at"] and hasattr(r["closed_at"], "isoformat") else (str(r["closed_at"]) if r["closed_at"] else None),
        "total_revenue": str(r["total_revenue"]),
        "total_vat": str(r["total_vat"]),
        "opening_float": str(r.get("opening_float", "0.000")),
        "status": r.get("status", "OPEN"),
        "break_minutes": r.get("break_minutes", 0),
    }


import json as _json


def _payment_breakdown_from_sales(rows: list) -> dict:
    """
    Build payment breakdown from a list of sale rows.
    Handles both single-method (payment_method) and split (payment_lines) sales.
    Returns {method: {count, total}} dict.
    """
    breakdown: dict = {}
    for row in rows:
        lines = row.get("payment_lines")
        if lines:
            if isinstance(lines, str):
                lines = _json.loads(lines)
            for line in lines:
                method = line.get("method", "cash")
                amount = float(line.get("amount", 0))
                if method not in breakdown:
                    breakdown[method] = {"count": 0, "total": 0.0}
                breakdown[method]["count"] += 1
                breakdown[method]["total"] = round(breakdown[method]["total"] + amount, 3)
        else:
            method = row.get("payment_method", "cash")
            amount = float(row.get("total_amount", 0))
            if method not in breakdown:
                breakdown[method] = {"count": 0, "total": 0.0}
            breakdown[method]["count"] += 1
            breakdown[method]["total"] = round(breakdown[method]["total"] + amount, 3)
    return breakdown


def _cash_collected_on_sale(sale_row: dict) -> float:
    """Cash portion collected on a sale (single-method or split payment lines)."""
    lines = sale_row.get("payment_lines")
    if lines:
        if isinstance(lines, str):
            lines = _json.loads(lines)
        return round(
            sum(float(line.get("amount", 0)) for line in lines if line.get("method") == "cash"),
            3,
        )
    if sale_row.get("payment_method") == "cash":
        return round(float(sale_row.get("total_amount", 0)), 3)
    return 0.0


def _cash_refunds_from_returns(return_rows: list) -> float:
    """Cash refunded from drawer for returns, proportional to original cash collected."""
    total = 0.0
    for row in return_rows:
        refund = float(row.get("total_refund", 0))
        sale_total = float(row.get("total_amount", 0))
        if refund <= 0 or sale_total <= 0:
            continue
        cash_collected = _cash_collected_on_sale(row)
        if cash_collected <= 0:
            continue
        total += round(refund * (cash_collected / sale_total), 3)
    return round(total, 3)


def _get_open_session(db, user_id: str, branch_id: str) -> dict | None:
    """Return the current non-CLOSED session for this user+branch, or None."""
    with db.cursor() as cur:
        cur.execute(
            """SELECT * FROM cash_sessions
               WHERE user_id = %s AND branch_id = %s AND status != 'CLOSED'
               ORDER BY opened_at DESC LIMIT 1""",
            (user_id, branch_id),
        )
        return cur.fetchone()


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/open")
def open_session(body: OpenSessionRequest, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Open a shift for the current user+branch.
    If an OPEN or ON_BREAK session already exists, return it (idempotent).
    Requires opening_float — the cash the pharmacist counts in the drawer.
    """
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    existing = _get_open_session(db, user_id, branch_id)
    if existing:
        return _fmt_session(existing)

    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO cash_sessions (id, user_id, branch_id, opening_float, status, opened_at)
               VALUES (%s, %s, %s, %s, 'OPEN', %s)""",
            (session_id, user_id, branch_id, round(body.opening_float, 3), now),
        )
    db.commit()

    return {
        "id": session_id,
        "user_id": user_id,
        "branch_id": branch_id,
        "opening_float": str(round(body.opening_float, 3)),
        "status": "OPEN",
        "break_minutes": 0,
        "opened_at": now.isoformat(),
        "closed_at": None,
        "total_sales": 0,
        "total_revenue": "0.000",
        "total_vat": "0.000",
        "payment_breakdown": None,
    }


@router.get("/history")
def session_history(
    limit: int = 30,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Last N closed sessions for the current user — for Reprint Z picker."""
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    with db.cursor() as cur:
        cur.execute(
            """SELECT cs.id, cs.opened_at, cs.closed_at, cs.status,
                      cs.total_sales, cs.total_revenue, cs.total_vat,
                      cs.opening_float, cs.break_minutes
               FROM cash_sessions cs
               WHERE cs.user_id = %s AND cs.branch_id = %s AND cs.status = 'CLOSED'
               ORDER BY cs.opened_at DESC
               LIMIT %s""",
            (user_id, branch_id, limit),
        )
        rows = cur.fetchall()

    def _fmt(r):
        return {
            "id": r["id"],
            "opened_at": r["opened_at"].isoformat() if hasattr(r["opened_at"], "isoformat") else str(r["opened_at"]),
            "closed_at": r["closed_at"].isoformat() if r["closed_at"] and hasattr(r["closed_at"], "isoformat") else None,
            "status": r["status"],
            "total_sales": r["total_sales"],
            "total_revenue": str(r["total_revenue"]),
            "total_vat": str(r["total_vat"]),
            "opening_float": str(r.get("opening_float", "0.000")),
            "break_minutes": r.get("break_minutes", 0),
        }

    return {"items": [_fmt(r) for r in rows]}


@router.get("/current")
def get_current_session(db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Get the active session for the current user.
    Returns 404 if no open/on-break session — frontend uses this to show 'no shift' state.
    """
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    row = _get_open_session(db, user_id, branch_id)
    if not row:
        raise HTTPException(status_code=404, detail="No active session")

    return _fmt_session(row)


@router.post("/break/start")
def start_break(body: StartBreakRequest, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Pause an OPEN shift — status → ON_BREAK. Creates a session_breaks row."""
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    session = _get_open_session(db, user_id, branch_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    if session["status"] == "ON_BREAK":
        raise HTTPException(status_code=400, detail="Already on break")
    if session["status"] == "CLOSED":
        raise HTTPException(status_code=400, detail="Session is closed")

    now = datetime.now(timezone.utc)
    break_id = str(uuid.uuid4())

    with db.cursor() as cur:
        cur.execute(
            "UPDATE cash_sessions SET status = 'ON_BREAK' WHERE id = %s",
            (session["id"],),
        )
        cur.execute(
            "INSERT INTO session_breaks (id, session_id, started_at, reason) VALUES (%s, %s, %s, %s)",
            (break_id, session["id"], now, body.reason),
        )
    db.commit()

    return {"status": "ON_BREAK", "break_id": break_id, "started_at": now.isoformat()}


@router.post("/break/end")
def end_break(db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Resume from break — status → OPEN. Updates break_minutes on the session."""
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    session = _get_open_session(db, user_id, branch_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    if session["status"] != "ON_BREAK":
        raise HTTPException(status_code=400, detail="Not currently on break")

    now = datetime.now(timezone.utc)

    # Find the open break row
    with db.cursor() as cur:
        cur.execute(
            "SELECT * FROM session_breaks WHERE session_id = %s AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
            (session["id"],),
        )
        break_row = cur.fetchone()

    minutes_elapsed = 0
    if break_row:
        started = break_row["started_at"]
        if hasattr(started, "replace"):
            started = started.replace(tzinfo=timezone.utc)
        delta = now - started
        minutes_elapsed = int(delta.total_seconds() / 60)

    with db.cursor() as cur:
        if break_row:
            cur.execute(
                "UPDATE session_breaks SET ended_at = %s WHERE id = %s",
                (now, break_row["id"]),
            )
        cur.execute(
            "UPDATE cash_sessions SET status = 'OPEN', break_minutes = break_minutes + %s WHERE id = %s",
            (minutes_elapsed, session["id"]),
        )
    db.commit()

    return {"status": "OPEN", "break_minutes_added": minutes_elapsed}


@router.post("/close")
def close_session(db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Close the current session.
    Works from OPEN or ON_BREAK status (emergency close).
    Computes Z-report totals from sales ledger.
    """
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    session = _get_open_session(db, user_id, branch_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active session to close")

    now = datetime.now(timezone.utc)
    today = session["opened_at"].date().isoformat() if hasattr(session["opened_at"], "date") else str(session["opened_at"])[:10]

    # If closing from break, end the open break row first
    if session["status"] == "ON_BREAK":
        with db.cursor() as cur:
            cur.execute(
                "SELECT * FROM session_breaks WHERE session_id = %s AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
                (session["id"],),
            )
            break_row = cur.fetchone()
        if break_row:
            started = break_row["started_at"]
            if hasattr(started, "replace"):
                started = started.replace(tzinfo=timezone.utc)
            minutes_elapsed = int((now - started).total_seconds() / 60)
            with db.cursor() as cur:
                cur.execute("UPDATE session_breaks SET ended_at = %s WHERE id = %s", (now, break_row["id"]))
                cur.execute(
                    "UPDATE cash_sessions SET break_minutes = break_minutes + %s WHERE id = %s",
                    (minutes_elapsed, session["id"]),
                )
            db.commit()

    # Compute totals — sales linked to this session by session_id
    with db.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) AS cnt,
                      COALESCE(SUM(total_amount), 0) AS revenue,
                      COALESCE(SUM(vat_amount), 0) AS vat
               FROM sales
               WHERE session_id = %s""",
            (session["id"],),
        )
        totals = cur.fetchone()

        # Payment breakdown — handles split payments via payment_lines
        cur.execute(
            "SELECT payment_method, payment_lines, total_amount FROM sales WHERE session_id = %s",
            (session["id"],),
        )
        sale_rows = cur.fetchall()

    breakdown_dict = _payment_breakdown_from_sales(sale_rows)
    breakdown = {m: {"count": v["count"], "total": str(round(v["total"], 3))} for m, v in breakdown_dict.items()}

    with db.cursor() as cur:
        cur.execute(
            """UPDATE cash_sessions
               SET closed_at = %s, status = 'CLOSED',
                   total_sales = %s, total_revenue = %s, total_vat = %s, payment_breakdown = %s
               WHERE id = %s""",
            (now, totals["cnt"], totals["revenue"], totals["vat"],
             str(breakdown).replace("'", '"'), session["id"]),
        )
    db.commit()

    return {
        "id": session["id"],
        "user_id": user_id,
        "branch_id": branch_id,
        "opening_float": str(session.get("opening_float", "0.000")),
        "status": "CLOSED",
        "opened_at": session["opened_at"].isoformat() if hasattr(session["opened_at"], "isoformat") else str(session["opened_at"]),
        "closed_at": now.isoformat(),
        "total_sales": totals["cnt"],
        "total_revenue": str(round(float(totals["revenue"]), 3)),
        "total_vat": str(round(float(totals["vat"]), 3)),
        "payment_breakdown": breakdown,
    }


@router.get("/{session_id}/sales")
def session_sales(session_id: str, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """All sales in a session — for Show Journal."""
    with db.cursor() as cur:
        cur.execute("SELECT * FROM cash_sessions WHERE id = %s", (session_id,))
        session = cur.fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_date = session["opened_at"].date().isoformat() if hasattr(session["opened_at"], "date") else str(session["opened_at"])[:10]

    with db.cursor() as cur:
        cur.execute(
            """SELECT s.id, s.invoice_number, s.total_amount, s.vat_amount,
                      s.payment_method, s.sold_at, u.full_name AS pharmacist_name
               FROM sales s
               LEFT JOIN users u ON u.id = s.user_id
               WHERE s.session_id = %s
               ORDER BY s.sold_at DESC""",
            (session_id,),
        )
        rows = cur.fetchall()

    def _fmt(r):
        return {
            **r,
            "sold_at": r["sold_at"].isoformat() if hasattr(r["sold_at"], "isoformat") else str(r["sold_at"]),
            "total_amount": str(r["total_amount"]),
            "vat_amount": str(r["vat_amount"]),
        }

    return {"items": [_fmt(r) for r in rows], "session": _fmt_session(session)}


@router.get("/{session_id}/z-report")
def z_report(session_id: str, db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Z-report for a session (open or closed)."""
    with db.cursor() as cur:
        cur.execute(
            """SELECT cs.*, u.full_name AS pharmacist_name,
                      b.name_en AS branch_name_en, b.name_ar AS branch_name_ar
               FROM cash_sessions cs
               LEFT JOIN users u ON u.id = cs.user_id
               LEFT JOIN branches b ON b.id = cs.branch_id
               WHERE cs.id = %s""",
            (session_id,),
        )
        session = cur.fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_date = session["opened_at"].date().isoformat() if hasattr(session["opened_at"], "date") else str(session["opened_at"])[:10]

    with db.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS revenue, COALESCE(SUM(vat_amount),0) AS vat
               FROM sales WHERE session_id = %s""",
            (session_id,),
        )
        totals = cur.fetchone()

        cur.execute(
            "SELECT payment_method, payment_lines, total_amount FROM sales WHERE session_id = %s",
            (session_id,),
        )
        sale_rows = cur.fetchall()

    breakdown_dict = _payment_breakdown_from_sales(sale_rows)
    breakdown = [
        {"method": m, "count": v["count"], "total": str(round(v["total"], 3))}
        for m, v in breakdown_dict.items()
    ]

    return {
        "session_id": session_id,
        "pharmacist_name": session["pharmacist_name"],
        "branch_name_en": session["branch_name_en"],
        "branch_name_ar": session["branch_name_ar"],
        "opening_float": str(session.get("opening_float", "0.000")),
        "status": session.get("status", "CLOSED"),
        "break_minutes": session.get("break_minutes", 0),
        "opened_at": session["opened_at"].isoformat() if hasattr(session["opened_at"], "isoformat") else str(session["opened_at"]),
        "closed_at": session["closed_at"].isoformat() if session["closed_at"] and hasattr(session["closed_at"], "isoformat") else None,
        "total_sales": totals["cnt"],
        "total_revenue": str(round(float(totals["revenue"]), 3)),
        "total_vat": str(round(float(totals["vat"]), 3)),
        "payment_breakdown": breakdown,
    }


@router.post("/tender")
def tender_declaration(
    body: TenderDeclarationRequest,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Mid-shift cash count declaration.
    Calculates expected cash = opening_float + cash sales - cash refunds in this session.
    Saves declaration and returns variance.
    """
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    session = _get_open_session(db, user_id, branch_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active session")

    # Expected cash = opening float + cash sales - cash refunds (including split-payment returns)
    with db.cursor() as cur:
        cur.execute(
            """SELECT payment_method, payment_lines, total_amount
               FROM sales
               WHERE session_id = %s""",
            (session["id"],),
        )
        sale_rows = cur.fetchall()
        cur.execute(
            """SELECT sr.total_refund, s.payment_method, s.payment_lines, s.total_amount
               FROM sale_returns sr
               JOIN sales s ON s.id = sr.sale_id
               WHERE s.session_id = %s""",
            (session["id"],),
        )
        return_rows = cur.fetchall()

    breakdown = _payment_breakdown_from_sales(sale_rows)
    cash_sales = float(breakdown.get("cash", {}).get("total", 0.0))
    cash_refunds = _cash_refunds_from_returns(return_rows)
    opening_float = float(session.get("opening_float", 0) or 0)
    expected      = round(opening_float + cash_sales - cash_refunds, 3)
    declared      = round(body.declared_cash, 3)
    difference    = round(declared - expected, 3)

    decl_id = str(uuid.uuid4())
    now     = datetime.now(timezone.utc)

    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO tender_declarations
               (id, session_id, user_id, branch_id, declared_cash, expected_cash, difference, notes, declared_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (decl_id, session["id"], user_id, branch_id,
             declared, expected, difference, body.notes, now),
        )
    db.commit()

    return {
        "id": decl_id,
        "session_id": session["id"],
        "declared_cash": str(declared),
        "expected_cash": str(expected),
        "difference": str(difference),
        "status": "OVERAGE" if difference > 0 else ("SHORTAGE" if difference < 0 else "BALANCED"),
        "declared_at": now.isoformat(),
    }


@router.get("/tender/history")
def tender_history(db=Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Last 10 tender declarations for the current user's active session."""
    user_id   = current_user["sub"]
    branch_id = current_user["branch_id"]

    session = _get_open_session(db, user_id, branch_id)
    if not session:
        return {"items": []}

    with db.cursor() as cur:
        cur.execute(
            """SELECT id, declared_cash, expected_cash, difference, notes, declared_at
               FROM tender_declarations
               WHERE session_id = %s
               ORDER BY declared_at DESC LIMIT 10""",
            (session["id"],),
        )
        rows = cur.fetchall()

    def _fmt(r):
        return {
            "id": r["id"],
            "declared_cash": str(r["declared_cash"]),
            "expected_cash": str(r["expected_cash"]),
            "difference": str(r["difference"]),
            "notes": r["notes"],
            "declared_at": r["declared_at"].isoformat() if hasattr(r["declared_at"], "isoformat") else str(r["declared_at"]),
            "status": "OVERAGE" if float(r["difference"]) > 0 else ("SHORTAGE" if float(r["difference"]) < 0 else "BALANCED"),
        }

    return {"items": [_fmt(r) for r in rows]}
