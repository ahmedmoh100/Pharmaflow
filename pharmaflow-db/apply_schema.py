#!/usr/bin/env python3
"""Create coupon tables in the database."""
import os, sys
from pathlib import Path
import pymysql
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "pharmaflow-backend" / ".env")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set"); sys.exit(1)

def parse_url(url: str) -> dict:
    url = url.replace("mysql+pymysql://", "")
    user_pass, rest = url.split("@", 1)
    host_port, database = rest.split("/", 1)
    user, password = (user_pass.split(":", 1) if ":" in user_pass else (user_pass, ""))
    host, port = (host_port.split(":", 1) if ":" in host_port else (host_port, "3306"))
    return {"host": host, "port": int(port), "user": user, "password": password, "database": database}

p = parse_url(DATABASE_URL)
conn = pymysql.connect(host=p["host"], port=p["port"], user=p["user"], password=p["password"],
                       database=p["database"], charset="utf8mb4", autocommit=True)

try:
    with conn.cursor() as cur:
        # Create coupons table
        cur.execute("""CREATE TABLE IF NOT EXISTS coupons (
            id              VARCHAR(36)   NOT NULL PRIMARY KEY,
            code            VARCHAR(30)   NOT NULL UNIQUE,
            type            ENUM('employee','promotional') NOT NULL,
            discount_type   ENUM('percentage','fixed') NOT NULL,
            discount_value  DECIMAL(12,3) NOT NULL,
            description_en  VARCHAR(200)  NOT NULL DEFAULT '',
            description_ar  VARCHAR(200)  NOT NULL DEFAULT '',
            applies_to      ENUM('all_items','category','medicine') NOT NULL DEFAULT 'all_items',
            applies_to_id   VARCHAR(36)   NULL,
            valid_from      DATE          NULL,
            valid_until     DATE          NULL,
            max_uses        INT           NULL,
            usage_count     INT           NOT NULL DEFAULT 0,
            is_active       TINYINT(1)    NOT NULL DEFAULT 1,
            created_by      VARCHAR(36)   NOT NULL,
            created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_coupon_code     (code),
            INDEX idx_coupon_type     (type),
            INDEX idx_coupon_active   (is_active),
            INDEX idx_coupon_dates    (valid_from, valid_until)
        )""")
        print("  coupons table created.")
        
        # Create coupon_usage table
        cur.execute("""CREATE TABLE IF NOT EXISTS coupon_usage (
            id              VARCHAR(36)  NOT NULL PRIMARY KEY,
            coupon_id       VARCHAR(36)  NOT NULL,
            sale_id         VARCHAR(36)  NOT NULL,
            discount_amount DECIMAL(12,3) NOT NULL,
            used_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_usage_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id),
            CONSTRAINT fk_usage_sale   FOREIGN KEY (sale_id)   REFERENCES sales(id),
            INDEX idx_usage_coupon (coupon_id),
            INDEX idx_usage_sale   (sale_id)
        )""")
        print("  coupon_usage table created.")
    
    print("✓ Coupon tables created successfully.")
except Exception as e:
    print(f"ERROR: {e}")
    raise
finally:
    conn.close()


