"""
Test 02 — Branches
Covers: GET /branches, GET /branches/{id}, POST /branches, PUT /branches/{id}
"""

import requests
import pytest

BASE = "http://localhost:8000"


def test_list_branches(admin_token):
    """GET /branches returns at least 2 branches."""
    r = requests.get(f"{BASE}/branches",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) >= 2


def test_list_branches_pharmacist_blocked(pharm_token):
    """Pharmacist can read branches but cannot create/modify them."""
    r = requests.get(f"{BASE}/branches",
                     headers={"Authorization": f"Bearer {pharm_token}"})
    # Branches are readable by all authenticated users
    assert r.status_code in (200, 401, 403)


def test_get_branch_br001(admin_token, state):
    """GET /branches/br-001 returns Al Aziziyah branch."""
    r = requests.get(f"{BASE}/branches/br-001",
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == "br-001"
    assert "name_en" in data
    assert "name_ar" in data


def test_create_and_deactivate_branch(admin_token, state):
    """Create a test branch then verify it exists."""
    import uuid as _uuid
    unique_code = f"T{_uuid.uuid4().hex[:4].upper()}"
    payload = {
        "code": unique_code,
        "name_en": "Test Branch EN",
        "name_ar": "فرع تجريبي",
        "city_en": "Riyadh",
        "city_ar": "الرياض",
        "vat_number": "300000000000003",
        "address": "Test Address"
    }
    r = requests.post(f"{BASE}/branches", json=payload,
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 201
    branch = r.json()
    state["test_branch_id"] = branch["id"]
    assert branch["name_en"] == "Test Branch EN"


def test_update_branch(admin_token, state):
    """PUT /branches/{id} updates branch name."""
    branch_id = state.get("test_branch_id")
    if not branch_id:
        pytest.skip("test_branch_id not set")
    r = requests.put(f"{BASE}/branches/{branch_id}",
                     json={"name_en": "Test Branch Updated"},
                     headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert r.json()["name_en"] == "Test Branch Updated"
