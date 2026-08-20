"""
Migration: add stock transfer support
- Extend stock_movements.movement_type ENUM with TRANSFER_IN / TRANSFER_OUT
- Create transfers table

Run from pharmaflow-db after starting XAMPP MySQL.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / 'pharmaflow-backend'))

from db.connection import get_connection

conn = get_connection()
cur = conn.cursor()

print("1. Extending movement_type ENUM...")
cur.execute("""
    ALTER TABLE stock_movements
    MODIFY COLUMN movement_type
    ENUM('IN','OUT','ADJUST','RETURN','WRITE_OFF','TRANSFER_IN','TRANSFER_OUT') NOT NULL
""")
print("   Done.")

print("2. Creating transfers table...")
cur.execute("""
    CREATE TABLE IF NOT EXISTS transfers (
        id              VARCHAR(36)   NOT NULL PRIMARY KEY,
        from_branch_id  VARCHAR(36)   NOT NULL,
        to_branch_id    VARCHAR(36)   NOT NULL,
        medicine_id     VARCHAR(36)   NOT NULL,
        qty             INT           NOT NULL,
        status          ENUM('COMPLETED','CANCELLED') NOT NULL DEFAULT 'COMPLETED',
        notes           VARCHAR(255)  NOT NULL DEFAULT '',
        created_by      VARCHAR(36)   NOT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_branch_id) REFERENCES branches(id),
        FOREIGN KEY (to_branch_id)   REFERENCES branches(id),
        FOREIGN KEY (medicine_id)    REFERENCES medicines(id),
        FOREIGN KEY (created_by)     REFERENCES users(id),
        INDEX idx_transfer_from (from_branch_id),
        INDEX idx_transfer_to   (to_branch_id),
        INDEX idx_transfer_med  (medicine_id)
    )
""")
print("   Done.")

conn.commit()
conn.close()
print("\nMigration complete.")
