"""
Test 06 — Cash Sessions (Shift Lifecycle)
Covers: POST /sessions/open, GET /sessions/current, POST /sessions/break/start,
        POST /sessions/break/end, POST /sessions/tender, GET /sessions/tender/history,
        GET /sessions/history, POST /sessions/close, GET /sessions/{id}/z-report
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_open_session(pharm_token, state):
    """POST /sessions/open creates a new shift with opening float."""
    # Close any existing open session first
    requests.post(f"{BASE}/sessions/close",
                  headers={"Authorization": f"Bearer {pharm_token}"})

    r = requests.post(f"{BASE}/sessions/open",
                      json={"opening_float": 100.0},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "OPEN"
    assert float(data["opening_float"]) == 100.0
    state["session_id"] = data["id"]


def test_open_session_idempotent(pharm_token, state):
    """POST /sessions/open returns existing session if already open."""
    r = requests.post(f"{BASE}/sessions/open",
                      json={"opening_float": 200.0},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    # Should return the SAME session, not create a new one
    assert r.json()["id"] == state["session_id"]


def test_get_current_session(pharm_token, state):
    """GET /sessions/current returns the open session."""
    r = requests.get(f"{BASE}/sessions/current",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "OPEN"
    assert data["id"] == state["session_id"]


def test_start_break(pharm_token, state):
    """POST /sessions/break/start changes status to ON_BREAK."""
    r = requests.post(f"{BASE}/sessions/break/start",
                      json={"reason": "Lunch"},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert r.json()["status"] == "ON_BREAK"
    state["break_id"] = r.json().get("break_id")


def test_start_break_while_on_break(pharm_token):
    """Cannot start a break while already on break."""
    r = requests.post(f"{BASE}/sessions/break/start",
                      json={"reason": "Double break"},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 400


def test_end_break(pharm_token):
    """POST /sessions/break/end changes status back to OPEN."""
    r = requests.post(f"{BASE}/sessions/break/end",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert r.json()["status"] == "OPEN"


def test_tender_declaration(pharm_token, state):
    """POST /sessions/tender saves cash count and returns variance."""
    r = requests.post(f"{BASE}/sessions/tender",
                      json={"declared_cash": 100.0, "notes": "Test count"},
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "declared_cash" in data
    assert "expected_cash" in data
    assert "difference" in data
    assert data["status"] in ("BALANCED", "OVERAGE", "SHORTAGE")
    # Expected = 100 opening float + 0 cash sales = 100, so BALANCED
    assert data["status"] == "BALANCED"


def test_tender_history(pharm_token):
    """GET /sessions/tender/history returns past declarations."""
    r = requests.get(f"{BASE}/sessions/tender/history",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert len(data["items"]) >= 1


def test_session_history_empty_before_close(pharm_token):
    """GET /sessions/history returns CLOSED sessions only — none yet."""
    r = requests.get(f"{BASE}/sessions/history",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    # May have old closed sessions from seed data
    assert "items" in r.json()


def test_close_session(pharm_token, state):
    """POST /sessions/close closes the shift and returns Z-report data."""
    r = requests.post(f"{BASE}/sessions/close",
                      headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "CLOSED"
    state["closed_session_id"] = data["id"]


def test_get_current_session_after_close(pharm_token):
    """GET /sessions/current returns 404 after shift is closed."""
    r = requests.get(f"{BASE}/sessions/current",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 404


def test_z_report_on_closed_session(pharm_token, state):
    """GET /sessions/{id}/z-report returns report for closed session."""
    session_id = state.get("closed_session_id")
    if not session_id:
        pytest.skip("closed_session_id not set")
    r = requests.get(f"{BASE}/sessions/{session_id}/z-report",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    data = r.json()
    assert "total_sales" in data
    assert "total_revenue" in data
    assert "pharmacist_name" in data
    assert "payment_breakdown" in data


def test_session_history_after_close(pharm_token, state):
    """GET /sessions/history shows the newly closed session."""
    r = requests.get(f"{BASE}/sessions/history",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["items"]]
    assert state.get("closed_session_id") in ids
