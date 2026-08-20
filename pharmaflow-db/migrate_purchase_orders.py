"""
Migration: add purchase_orders + purchase_order_items tables
Run from pharmaflow-db with XAMPP MySQL running.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / 'pharmaflow-backend'))
from db.connection import get_connection

conn = get_connection()
cur = conn.cursor()

print("1. Creating purchase_orders table...")
cur.execute("""
    CREATE TABLE IF NOT EXISTS purchase_orders (
        id              VARCHAR(36)   NOT NULL PRIMARY KEY,
        supplier_id     VARCHAR(36)   NOT NULL,
        branch_id       VARCHAR(36)   NOT NULL,
        status          ENUM('DRAFT','SENT','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        expected_date   DATE          NULL,
        notes           VARCHAR(500)  NOT NULL DEFAULT '',
        created_by      VARCHAR(36)   NOT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (branch_id)   REFERENCES branches(id),
        FOREIGN KEY (created_by)  REFERENCES users(id),
        INDEX idx_po_supplier (supplier_id),
        INDEX idx_po_branch   (branch_id),
        INDEX idx_po_status   (status)
    )
""")
print("   Done.")

print("2. Creating purchase_order_items table...")
cur.execute("""
    CREATE TABLE IF NOT EXISTS purchase_order_items (
        id              VARCHAR(36)   NOT NULL PRIMARY KEY,
        po_id           VARCHAR(36)   NOT NULL,
        medicine_id     VARCHAR(36)   NOT NULL,
        ordered_qty     INT           NOT NULL,
        agreed_unit_cost DECIMAL(12,3) NOT NULL DEFAULT 0.000,
        FOREIGN KEY (po_id)         REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (medicine_id)   REFERENCES medicines(id),
        INDEX idx_poi_po       (po_id),
        INDEX idx_poi_medicine (medicine_id)
    )
""")
print("   Done.")

conn.commit()
conn.close()
print("\nMigration complete.")
