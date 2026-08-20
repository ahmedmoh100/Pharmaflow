"""
Mada POS Terminal Integration Bridge
====================================
Simulates and manages the POS-terminal communication bridge for Saudi payment terminals (Mada / Visa / Mastercard).
Handles:
- Terminal Handshake & Health Check
- Transaction Initiation & Amount Display
- Card Scheme & Approval Code Parsing (STAN, RRN, Auth Code)
- Cardholder PIN / Tap completion
- Transaction Reversals / Voids
"""

import uuid
import random
from datetime import datetime, timezone
from typing import Dict, Any, Optional


class MadaTerminalBridge:
    def __init__(self, terminal_id: str = "MADA-TERM-01"):
        self.terminal_id = terminal_id
        self._stan_counter = 100000

    def get_next_stan(self) -> str:
        """Returns Systems Trace Audit Number (6-digit sequential)."""
        self._stan_counter += 1
        return f"{self._stan_counter:06d}"

    def initiate_transaction(self, amount: float, sale_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Sends transaction request to payment terminal.
        """
        stan = self.get_next_stan()
        txn_ref = str(uuid.uuid4())
        return {
            "transaction_reference": txn_ref,
            "terminal_id": self.terminal_id,
            "stan": stan,
            "amount": round(amount, 2),
            "status": "INITIATED",
            "message": "Please tap, insert, or swipe card on Mada terminal",
        }

    def process_terminal_response(
        self,
        transaction_reference: str,
        amount: float,
        simulate_action: str = "APPROVE",  # APPROVE, DECLINE, TIMEOUT
        card_scheme: str = "MADA",
    ) -> Dict[str, Any]:
        """
        Simulates / handles response from terminal after customer card interaction.
        """
        now = datetime.now(timezone.utc)
        auth_code = f"AUTH{random.randint(100000, 999999)}"
        rrn = f"RRN{random.randint(100000000000, 999999999999)}"
        stan = self.get_next_stan()
        masked_pan = f"5888-50**-****-{random.randint(1000, 9999)}"

        if simulate_action == "APPROVE":
            return {
                "transaction_reference": transaction_reference,
                "terminal_id": self.terminal_id,
                "status": "APPROVED",
                "response_code": "000",
                "response_message": "Approved",
                "auth_code": auth_code,
                "rrn": rrn,
                "stan": stan,
                "card_scheme": card_scheme.upper(),
                "masked_pan": masked_pan,
                "amount": round(amount, 2),
                "timestamp": now.isoformat(),
            }
        elif simulate_action == "DECLINE":
            return {
                "transaction_reference": transaction_reference,
                "terminal_id": self.terminal_id,
                "status": "DECLINED",
                "response_code": "051",
                "response_message": "Insufficient Funds / Declined by Issuer",
                "auth_code": None,
                "rrn": rrn,
                "stan": stan,
                "card_scheme": card_scheme.upper(),
                "masked_pan": masked_pan,
                "amount": round(amount, 2),
                "timestamp": now.isoformat(),
            }
        else:
            return {
                "transaction_reference": transaction_reference,
                "terminal_id": self.terminal_id,
                "status": "TIMEOUT",
                "response_code": "091",
                "response_message": "Terminal Response Timeout",
                "auth_code": None,
                "rrn": None,
                "stan": stan,
                "card_scheme": None,
                "masked_pan": None,
                "amount": round(amount, 2),
                "timestamp": now.isoformat(),
            }


# Default global bridge instance
mada_bridge = MadaTerminalBridge()
