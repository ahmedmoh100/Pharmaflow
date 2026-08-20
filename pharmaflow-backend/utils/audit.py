"""
Audit logging helper.
Call log_action() from any route to write a row to audit_log.
"""

import uuid
from datetime import datetime, timezone


def log_action(
    db,
    user_id: str,
    branch_id: str,
    entity: str,
    action: str,
    entity_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    ip: str = "",
):
    """
    Insert one row into audit_log. Silently swallows errors so a logging
    failure never breaks the actual operation.
    """
    import json
    try:
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO audit_log
                   (id, user_id, branch_id, entity, entity_id, action,
                    before_json, after_json, ip, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    str(uuid.uuid4()),
                    user_id,
                    branch_id,
                    entity,
                    entity_id,
                    action,
                    json.dumps(before, default=str) if before else None,
                    json.dumps(after,  default=str) if after  else None,
                    ip,
                    datetime.now(timezone.utc),
                ),
            )
        db.commit()
    except Exception as e:
        import logging
        logging.getLogger("audit").error(f"Audit log failed: {e}")
