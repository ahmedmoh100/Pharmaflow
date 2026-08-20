"""
Test 01 — Authentication
Covers: POST /auth/login, GET /auth/me
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_admin_login_success(state, admin_token):
    """Admin login returns valid token and correct role."""
    assert admin_token
    assert state["admin_branch_id"]


def test_pharmacist_login_success(state, pharm_token):
    """Pharmacist login returns valid token and correct branch."""
    assert pharm_token
    assert state["pharm_branch_id"] == "br-001"


def test_login_wrong_password():
    """Wrong password returns 401."""
    r = requests.post(f"{BASE}/auth/login", json={
        "email": "admin@demo.pharmaflow",
        "password": "wrongpassword"
    })
    assert r.status_code == 401


def test_login_nonexistent_user():
    """Non-existent email returns 401."""
    r = requests.post(f"{BASE}/auth/login", json={
        "email": "nobody@demo.pharmaflow",
        "password": "Demo@1234"
    })
    assert r.status_code == 401


def test_login_missing_fields():
    """Login with no body returns 422."""
    r = requests.post(f"{BASE}/auth/login", json={})
    assert r.status_code == 422


def test_me_with_valid_token(admin_token):
    """GET /auth/me returns user info with valid token."""
    r = requests.get(f"{BASE}/auth/me",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "admin"
    assert data["email"] == "admin@demo.pharmaflow"
    assert "branch_id" in data


def test_me_pharmacist_role(pharm_token):
    """GET /auth/me for pharmacist returns pharmacist role."""
    r = requests.get(f"{BASE}/auth/me",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    assert r.status_code == 200
    assert r.json()["role"] == "pharmacist"


def test_me_without_token():
    """GET /auth/me without token returns 401/403."""
    r = requests.get(f"{BASE}/auth/me")
    assert r.status_code in (401, 403)


def test_me_with_invalid_token():
    """GET /auth/me with garbage token returns 401/403."""
    r = requests.get(f"{BASE}/auth/me",
                     headers={"Authorization": "Bearer notavalidtoken"})
    assert r.status_code in (401, 403)


def test_protected_endpoint_blocked_without_token():
    """GET /medicines without token is rejected."""
    r = requests.get(f"{BASE}/medicines")
    assert r.status_code in (401, 403)


def test_inactive_user_cannot_login(admin_token, state):
    """Deactivated user cannot log in."""
    import uuid
    # Create a new user
    unique_email = f"inactive.{uuid.uuid4().hex[:6]}@demo.pharmaflow"
    r = requests.post(f"{BASE}/users",
                      json={
                          "branch_id": "br-001",
                          "email": unique_email,
                          "password": "Test@1234",
                          "full_name": "Inactive Test User",
                          "role": "pharmacist"
                      },
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 201
    user_id = r.json()["id"]

    # Deactivate the user
    requests.put(f"{BASE}/users/{user_id}",
                 json={"is_active": False},
                 headers={"Authorization": f"Bearer {admin_token}"})

    # Attempt login — should fail
    r2 = requests.post(f"{BASE}/auth/login", json={
        "email": unique_email,
        "password": "Test@1234"
    })
    assert r2.status_code in (401, 403)
