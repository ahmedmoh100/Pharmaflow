"""
SFDA Tatmeen / RSD Track & Trace Router
========================================
Implements Saudi Food and Drug Authority (SFDA) RSD compliance:
- 2D DataMatrix Barcode Parsing (GTIN, Batch, Expiry, Serial)
- Batch Lifecycle Management (Active, Quarantined, Recalled, Expired)
- SFDA RSD Regulatory Event Logging
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db.connection import get_db
from utils.auth import require_roles, get_current_user
from utils.gs1_parser import parse_gs1_barcode

router = APIRouter(prefix="/sfda", tags=["SFDA & Regulatory"])


class BarcodeParseRequest(BaseModel):
    barcode: str


class BatchLifecycleRequest(BaseModel):
    reason: str
    from_gln: Optional[str] = "GLN-MOH-998811"
    to_gln: Optional[str] = "GLN-PHARMAFLOW-001"


@router.post("/barcode/parse")
def parse_barcode_endpoint(
    body: BarcodeParseRequest,
    current_user: dict = Depends(require_roles("admin", "branch_manager", "pharmacist", "inventory_manager", "cashier")),
):
    """
    Parses a GS1 2D DataMatrix barcode scan string into GTIN, Lot/Batch, Expiry Date, and Serial Number.
    """
    result = parse_gs1_barcode(body.barcode)
    if not result["is_valid"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/batches/{batch_id}/recall")
def recall_batch_endpoint(
    batch_id: str,
    body: BatchLifecycleRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "inventory_manager")),
):
    """
    Recalls a drug batch per SFDA directive. Prevents any future POS sale or transfer.
    """
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute(
            """SELECT b.id, b.batch_number, b.qty_remaining, m.barcode, m.name_en
               FROM batches b
               JOIN medicines m ON m.id = b.medicine_id
               WHERE b.id = %s FOR UPDATE""",
            (batch_id,)
        )
        batch = cur.fetchone()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        cur.execute(
            "UPDATE batches SET sfda_status = 'recalled', status = 'inactive' WHERE id = %s",
            (batch_id,)
        )

        event_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO sfda_rsd_events
               (id, event_type, gtin, batch_number, quantity, from_gln, to_gln, status, response_code, notes, created_at)
               VALUES (%s, 'RECALL', %s, %s, %s, %s, %s, 'CONFIRMED', 'SFDA-RC-200', %s, %s)""",
            (
                event_id,
                batch.get("barcode") or "00000000000000",
                batch["batch_number"],
                batch["qty_remaining"],
                body.from_gln,
                body.to_gln,
                f"Batch recalled by {current_user['sub']}: {body.reason}",
                now,
            ),
        )
    db.commit()

    return {
        "status": "recalled",
        "batch_id": batch_id,
        "batch_number": batch["batch_number"],
        "sfda_event_id": event_id,
        "message": f"Batch {batch['batch_number']} successfully recalled. POS checkout is now strictly blocked.",
    }


@router.post("/batches/{batch_id}/quarantine")
def quarantine_batch_endpoint(
    batch_id: str,
    body: BatchLifecycleRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "inventory_manager")),
):
    """
    Quarantines a drug batch pending SFDA inspection or temperature excursion analysis.
    """
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute(
            """SELECT b.id, b.batch_number, b.qty_remaining, m.barcode, m.name_en
               FROM batches b
               JOIN medicines m ON m.id = b.medicine_id
               WHERE b.id = %s FOR UPDATE""",
            (batch_id,)
        )
        batch = cur.fetchone()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        cur.execute(
            "UPDATE batches SET sfda_status = 'quarantined' WHERE id = %s",
            (batch_id,)
        )

        event_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO sfda_rsd_events
               (id, event_type, gtin, batch_number, quantity, from_gln, to_gln, status, response_code, notes, created_at)
               VALUES (%s, 'QUARANTINE', %s, %s, %s, %s, %s, 'CONFIRMED', 'SFDA-QT-200', %s, %s)""",
            (
                event_id,
                batch.get("barcode") or "00000000000000",
                batch["batch_number"],
                batch["qty_remaining"],
                body.from_gln,
                body.to_gln,
                f"Batch quarantined by {current_user['sub']}: {body.reason}",
                now,
            ),
        )
    db.commit()

    return {
        "status": "quarantined",
        "batch_id": batch_id,
        "batch_number": batch["batch_number"],
        "sfda_event_id": event_id,
        "message": f"Batch {batch['batch_number']} quarantined successfully.",
    }


@router.post("/batches/{batch_id}/release")
def release_batch_endpoint(
    batch_id: str,
    body: BatchLifecycleRequest,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "inventory_manager")),
):
    """
    Releases a quarantined batch back to active status.
    """
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute(
            """SELECT b.id, b.batch_number, b.qty_remaining, m.barcode
               FROM batches b
               JOIN medicines m ON m.id = b.medicine_id
               WHERE b.id = %s FOR UPDATE""",
            (batch_id,)
        )
        batch = cur.fetchone()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        cur.execute(
            "UPDATE batches SET sfda_status = 'active', status = 'active' WHERE id = %s",
            (batch_id,)
        )

        event_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO sfda_rsd_events
               (id, event_type, gtin, batch_number, quantity, from_gln, to_gln, status, response_code, notes, created_at)
               VALUES (%s, 'RELEASE', %s, %s, %s, %s, %s, 'CONFIRMED', 'SFDA-RL-200', %s, %s)""",
            (
                event_id,
                batch.get("barcode") or "00000000000000",
                batch["batch_number"],
                batch["qty_remaining"],
                body.from_gln,
                body.to_gln,
                f"Batch released to active by {current_user['sub']}: {body.reason}",
                now,
            ),
        )
    db.commit()

    return {
        "status": "active",
        "batch_id": batch_id,
        "batch_number": batch["batch_number"],
        "sfda_event_id": event_id,
        "message": f"Batch {batch['batch_number']} released to active status.",
    }


@router.get("/events")
def list_sfda_events(
    event_type: Optional[str] = None,
    batch_number: Optional[str] = None,
    limit: int = 50,
    db=Depends(get_db),
    current_user: dict = Depends(require_roles("admin", "branch_manager", "auditor", "inventory_manager")),
):
    """
    Lists SFDA RSD compliance audit log events.
    """
    with db.cursor() as cur:
        query = "SELECT * FROM sfda_rsd_events WHERE 1=1"
        params = []
        if event_type:
            query += " AND event_type = %s"
            params.append(event_type.upper())
        if batch_number:
            query += " AND batch_number = %s"
            params.append(batch_number)
        query += " ORDER BY created_at DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, tuple(params))
        events = cur.fetchall()

    return {"events": events, "count": len(events)}
