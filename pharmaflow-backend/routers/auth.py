"""
Auth routes:
  POST /auth/login  — email + password → JWT
  GET  /auth/me     — JWT → current user info
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from db.connection import get_db
from models.schemas import LoginRequest, TokenResponse, MeResponse
from utils.auth import verify_password, create_access_token, get_current_user
from utils.audit import log_action
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(body: LoginRequest, request: Request, db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute(
            "SELECT id, email, password_hash, full_name, role, branch_id, is_active "
            "FROM users WHERE email = %s LIMIT 1",
            (body.email,),
        )
        user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    # Get branch name
    with db.cursor() as cur:
        cur.execute("SELECT name_en, name_ar FROM branches WHERE id = %s", (user["branch_id"],))
        branch = cur.fetchone()
    branch_name_en = branch["name_en"] if branch else ""
    branch_name_ar = branch["name_ar"] if branch else ""

    # Update last_login_at
    with db.cursor() as cur:
        cur.execute("UPDATE users SET last_login_at = NOW() WHERE id = %s", (user["id"],))
    db.commit()

    token_data = {
        "sub": user["id"],
        "role": user["role"],
        "branch_id": user["branch_id"],
        "email": user["email"],
    }
    token = create_access_token(token_data)

    log_action(db, user["id"], user["branch_id"], "user", "LOGIN",
               entity_id=user["id"], ip=request.client.host if request.client else "")

    return TokenResponse(
        access_token=token,
        user_id=user["id"],
        role=user["role"],
        branch_id=user["branch_id"],
        branch_name_en=branch_name_en,
        branch_name_ar=branch_name_ar,
        full_name=user["full_name"],
    )


@router.get("/me", response_model=MeResponse)
def me(current_user: dict = Depends(get_current_user)):
    return MeResponse(
        user_id=current_user["sub"],
        email=current_user["email"],
        full_name="",           # full_name not in token — fetch from DB if needed
        role=current_user["role"],
        branch_id=current_user["branch_id"],
    )
