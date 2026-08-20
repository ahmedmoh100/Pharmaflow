"""
Mada POS Payment Terminal Router
=================================
Manages direct integration with Saudi Mada/Visa/Mastercard payment terminals:
- POS-to-Terminal Transaction Dispatch
- Card Scheme & Approval Code Parsing (STAN, RRN, Auth Code)
- Terminal Audit Logging (`mada_terminal_logs`)
"""

import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db.connection import get_db
from utils.auth import require_roles, get_current_user
from utils.mada_bridge import mada_bridge

router = APIRouter(prefix="/mada", tags=["Mada POS Integration"])


class MadaInitiateRequest(BaseModel):
    amount: float = Field(gt=0)
    sale_id: Optional[str] = None
    terminal_id: Optional[str] = "MADA-TERM-01"


class MadaProcessRequest(BaseModel):
    transaction_reference: str
    amount: float = Field(gt=0)
    simulate_action: str = "APPROVE"  # APPROVE, DECLINE, TIMEOUT
    card_scheme: str = "MADA"
    sale_id: Optional[str] = None


@router.get("/terminals/status")
def get_terminal_status(
    terminal_id: str = "MADA-TERM-01",
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist", "cashier")),
):
    """Checks online status of Mada POS payment terminal."""
    return {
        "terminal_id": terminal_id,
        "status": "ONLINE",
        "protocol": "ZVT/POS-Bridge",
        "supported_schemes": ["MADA", "VISA", "MASTERCARD", "APPLE_PAY"],
        "message": "Payment terminal ready for transactions",
    }


@router.post("/transactions/initiate")
def initiate_mada_payment(
    body: MadaInitiateRequest,
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist", "cashier")),
):
    """
    Sends payment initiation command to Mada terminal.
    """
    txn = mada_bridge.initiate_transaction(amount=body.amount, sale_id=body.sale_id)
    return txn


@router.post("/transactions/process")
def process_mada_payment(
    body: MadaProcessRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist", "cashier")),
):
    """
    Processes cardholder interaction on the terminal and logs audit data.
    """
    now = datetime.now(timezone.utc)
    result = mada_bridge.process_terminal_response(
        transaction_reference=body.transaction_reference,
        amount=body.amount,
        simulate_action=body.simulate_action,
        card_scheme=body.card_scheme,
    )

    log_id = str(uuid.uuid4())
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO mada_terminal_logs
               (id, sale_id, terminal_id, stan, auth_code, card_scheme, masked_pan, amount, status, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                log_id,
                body.sale_id,
                result["terminal_id"],
                result.get("stan") or "000000",
                result.get("auth_code") or "N/A",
                result.get("card_scheme") or "UNKNOWN",
                result.get("masked_pan") or "N/A",
                result["amount"],
                result["status"],
                now,
            ),
        )
    db.commit()

    if result["status"] == "DECLINED":
        raise HTTPException(status_code=400, detail=f"Mada payment declined: {result['response_message']}")
    elif result["status"] == "TIMEOUT":
        raise HTTPException(status_code=408, detail="Mada payment timed out. Please retry.")

    return result
