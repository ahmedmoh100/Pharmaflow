"""
Pytest configuration and shared fixtures for PharmaFlow test suite.

All tests run against the live local API (localhost:8000).
Requires: backend running + DB seeded (python seed_minimal.py from pharmaflow-db/)

Usage:
    cd pharmaflow-backend
    pytest tests/ -v

Test order matters — IDs created in earlier tests are used by later tests.
The shared `state` dict carries IDs across the session.
"""

import pytest
import requests
import uuid

BASE = "http://localhost:8000"

# ── Shared state across the whole test session ──────────────────────────────
@pytest.fixture(scope="session")
def state():
    return {}


# ── Auth helpers ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_token(state):
    """Log in as admin and return Bearer token."""
    r = requests.post(f"{BASE}/auth/login", json={
        "email": "admin@demo.pharmaflow",
        "password": "Demo@1234"
    })
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    data = r.json()
    token = data["access_token"]
    state["admin_token"] = token
    state["admin_branch_id"] = data["branch_id"]
    return token


@pytest.fixture(scope="session")
def pharm_token(state):
    """Log in as pharmacist (br-001) and return Bearer token."""
    r = requests.post(f"{BASE}/auth/login", json={
        "email": "pharm1@demo.pharmaflow",
        "password": "Demo@1234"
    })
    assert r.status_code == 200, f"Pharmacist login failed: {r.text}"
    data = r.json()
    token = data["access_token"]
    state["pharm_token"] = token
    state["pharm_branch_id"] = data["branch_id"]
    state["pharm_user_id"] = data["user_id"]
    return token


def admin_headers(token):
    return {"Authorization": f"Bearer {token}"}


def pharm_headers(token):
    return {"Authorization": f"Bearer {token}"}
