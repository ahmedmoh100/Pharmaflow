"""
PharmaFlow ERP/POS Demo — Minimal Seed
=======================================
Creates a clean, minimal dataset for development and testing:

  2 Branches      (Branch 1 — Main, Branch 2 — North)
  3 Users         (1 Admin, 1 Pharmacist per branch)
  3 Suppliers     (generic distributor names)
  5 Medicines     (mix of zero-rated + standard VAT, 1 controlled)
  10 Batches      (2 per medicine, realistic expiry dates)
  2 Coupons       (DEMO10 — 10%, DEMO20 — 20%)
  0 Sales         (tests create their own)

Credentials:
  Admin:         admin@demo.pharmaflow  /  Demo@1234
  Pharmacist 1:  pharm1@demo.pharmaflow /  Demo@1234
  Pharmacist 2:  pharm2@demo.pharmaflow /  Demo@1234

Usage:
  cd pharmaflow-db
  python seed_minimal.py
"""

import os
import sys
import uuid
from datetime import datetime, timezone, date, timedelta
import bcrypt as bcrypt_lib
import pymysql
from pathlib import Path
from dotenv import load_dotenv

# Load env from backend directory
load_dotenv(Path(__file__).parent.parent / "pharmaflow-backend" / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "mysql+pymysql://root:@127.0.0.1:3306/pharmaflow")

def parse_url(url: str) -> dict:
    url = url.replace("mysql+pymysql://", "").replace("mysql://", "")
    user_pass, rest = url.split("@", 1)
    host_port, database = rest.split("/", 1)
    user, password = (user_pass.split(":", 1) if ":" in user_pass else (user_pass, ""))
    host, port = (host_port.split(":", 1) if ":" in host_port else (host_port, "3306"))
    return {"host": host, "port": int(port), "user": user, "password": password, "database": database}

def hash_password(plain: str) -> str:
    return bcrypt_lib.hashpw(plain.encode(), bcrypt_lib.gensalt(rounds=10)).decode()

p = parse_url(DATABASE_URL)
conn = pymysql.connect(
    host=p["host"], port=p["port"],
    user=p["user"], password=p["password"],
    database=p["database"],
    charset="utf8mb4",
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=False,
)

now = datetime.now(timezone.utc)
today = date.today()

# ── Clear tables ──────────────────────────────────────────────────────────────
print("--> Clearing tables...")
TRUNCATE_ORDER = [
    "credit_notes", "transfers", "controlled_dispense_log",
    "customer_ledger", "insurance_claims", "patient_insurance_policies",
    "insurance_providers", "wasfaty_prescriptions", "mada_terminal_logs",
    "sfda_rsd_events", "tender_declarations", "session_breaks",
    "stock_movements", "sale_return_items", "sale_returns",
    "sale_items", "coupon_usage", "sales", "parked_transactions",
    "prescription_items", "prescriptions", "cash_sessions",
    "purchase_order_items", "purchase_orders", "batches",
    "medicines", "coupons", "customers", "suppliers", "users",
    "branches", "idempotency_keys", "invoice_sequences",
]
with conn.cursor() as cur:
    cur.execute("SET FOREIGN_KEY_CHECKS = 0")
    for t in TRUNCATE_ORDER:
        try:
            cur.execute(f"TRUNCATE TABLE `{t}`")
        except Exception:
            pass  # table may not exist yet — skip
    cur.execute("SET FOREIGN_KEY_CHECKS = 1")
conn.commit()

# ── Branches ──────────────────────────────────────────────────────────────────
print("--> Seeding branches...")
BRANCHES = [
    {
        "id": "br-001",
        "code": "BR-001",
        "name_en": "PharmaFlow — Main Branch",
        "name_ar": "فارما فلو — الفرع الرئيسي",
        "city_en": "Riyadh",
        "city_ar": "الرياض",
        "vat_number": "311111111111113",
        "address": "King Fahad Road, Riyadh",
    },
    {
        "id": "br-002",
        "code": "BR-002",
        "name_en": "PharmaFlow — North Branch",
        "name_ar": "فارما فلو — الفرع الشمالي",
        "city_en": "Medina",
        "city_ar": "المدينة المنورة",
        "vat_number": "311111111111113",
        "address": "King Abdullah Road, Medina",
    },
]
with conn.cursor() as cur:
    for b in BRANCHES:
        cur.execute("""
            INSERT INTO branches (id, code, name_en, name_ar, city_en, city_ar, vat_number, address)
            VALUES (%(id)s, %(code)s, %(name_en)s, %(name_ar)s, %(city_en)s, %(city_ar)s, %(vat_number)s, %(address)s)
        """, b)
conn.commit()
print(f"   {len(BRANCHES)} branches")

# ── Users ─────────────────────────────────────────────────────────────────────
print("--> Seeding users...")
PW = hash_password("Demo@1234")
USERS = [
    {
        "id": "usr-admin-001",
        "branch_id": "br-001",
        "email": "admin@demo.pharmaflow",
        "password_hash": PW,
        "full_name": "Admin User",
        "role": "admin",
        "is_active": 1,
    },
    {
        "id": "usr-pharm-001",
        "branch_id": "br-001",
        "email": "pharm1@demo.pharmaflow",
        "password_hash": PW,
        "full_name": "Pharmacist One",
        "role": "pharmacist",
        "is_active": 1,
    },
    {
        "id": "usr-pharm-002",
        "branch_id": "br-002",
        "email": "pharm2@demo.pharmaflow",
        "password_hash": PW,
        "full_name": "Pharmacist Two",
        "role": "pharmacist",
        "is_active": 1,
    },
]
with conn.cursor() as cur:
    for u in USERS:
        cur.execute("""
            INSERT INTO users (id, branch_id, email, password_hash, full_name, role, is_active)
            VALUES (%(id)s, %(branch_id)s, %(email)s, %(password_hash)s, %(full_name)s, %(role)s, %(is_active)s)
        """, u)
conn.commit()
print(f"   {len(USERS)} users")

# ── Suppliers ─────────────────────────────────────────────────────────────────
print("--> Seeding suppliers...")
SUPPLIERS = [
    {
        "id": "sup-001",
        "name_en": "Alpha Medical Distribution",
        "name_ar": "توزيع ألفا الطبي",
        "tax_number": "311222333444001",
        "supplier_type": "distributor",
        "contact_person": "Sales Team",
        "phone": "+966500000001",
        "email": "sales@alpha-medical.demo",
    },
    {
        "id": "sup-002",
        "name_en": "Beta Pharma Wholesale",
        "name_ar": "بيتا فارما للجملة",
        "tax_number": "311222333444002",
        "supplier_type": "wholesaler",
        "contact_person": "Orders Team",
        "phone": "+966500000002",
        "email": "orders@beta-pharma.demo",
    },
    {
        "id": "sup-003",
        "name_en": "Gamma Healthcare Logistics",
        "name_ar": "جاما للخدمات الصحية",
        "tax_number": "311222333444003",
        "supplier_type": "distributor",
        "contact_person": "Logistics Team",
        "phone": "+966500000003",
        "email": "logistics@gamma-health.demo",
    },
]
with conn.cursor() as cur:
    for s in SUPPLIERS:
        cur.execute("""
            INSERT INTO suppliers (id, name_en, name_ar, tax_number, supplier_type, contact_person, phone, email)
            VALUES (%(id)s, %(name_en)s, %(name_ar)s, %(tax_number)s, %(supplier_type)s,
                    %(contact_person)s, %(phone)s, %(email)s)
        """, s)
conn.commit()
print(f"   {len(SUPPLIERS)} suppliers")

# ── Medicines ─────────────────────────────────────────────────────────────────
print("--> Seeding medicines...")
MEDICINES = [
    # Zero-rated (qualifying medicines)
    {
        "id": "med-001",
        "name_en": "Panadol (Paracetamol) 500mg Tablets (24 Tabs)",
        "name_ar": "بنادول (باراسيتامول) 500 مجم أقراص (24 قرص)",
        "generic_name": "paracetamol",
        "barcode": "6010000000001",
        "category": "analgesics",
        "form": "Tablet",
        "strength": "500mg",
        "unit": "Box",
        "selling_price": "12.000",
        "low_stock_threshold": 20,
        "vat_category": "zero_rated",
        "requires_prescription": 0,
        "is_controlled": 0,
        "max_public_price": "15.000",
        "stock_quantity": 100,
    },
    {
        "id": "med-002",
        "name_en": "Ibuprofen 400mg Tablets (30 Tabs)",
        "name_ar": "إيبوبروفين 400 مجم أقراص (30 قرص)",
        "generic_name": "ibuprofen",
        "barcode": "6010000000002",
        "category": "analgesics",
        "form": "Tablet",
        "strength": "400mg",
        "unit": "Box",
        "selling_price": "18.000",
        "low_stock_threshold": 15,
        "vat_category": "zero_rated",
        "requires_prescription": 0,
        "is_controlled": 0,
        "max_public_price": "22.000",
        "stock_quantity": 80,
    },
    {
        "id": "med-003",
        "name_en": "Amoxicillin 500mg Capsules (14 Caps)",
        "name_ar": "أموكسيسيلين 500 مجم كبسولات (14 كبسولة)",
        "generic_name": "amoxicillin",
        "barcode": "6010000000003",
        "category": "antibiotics",
        "form": "Capsule",
        "strength": "500mg",
        "unit": "Box",
        "selling_price": "35.000",
        "low_stock_threshold": 10,
        "vat_category": "zero_rated",
        "requires_prescription": 1,
        "is_controlled": 0,
        "max_public_price": "40.000",
        "stock_quantity": 50,
    },
    # Standard VAT (15%) — non-medicine pharmacy products
    {
        "id": "med-004",
        "name_en": "Centrum Multivitamin Adults (60 Tabs)",
        "name_ar": "سنتروم فيتامينات متعددة للبالغين (60 قرص)",
        "generic_name": "multivitamin",
        "barcode": "6010000000004",
        "category": "vitamins",
        "form": "Tablet",
        "strength": "Standard",
        "unit": "Bottle",
        "selling_price": "45.000",
        "low_stock_threshold": 10,
        "vat_category": "standard",
        "requires_prescription": 0,
        "is_controlled": 0,
        "max_public_price": "55.000",
        "stock_quantity": 60,
    },
    # Controlled substance
    {
        "id": "med-005",
        "name_en": "Tramadol 50mg Capsules (20 Caps)",
        "name_ar": "ترامادول 50 مجم كبسولات (20 كبسولة)",
        "generic_name": "tramadol",
        "barcode": "6010000000005",
        "category": "analgesics",
        "form": "Capsule",
        "strength": "50mg",
        "unit": "Box",
        "selling_price": "28.000",
        "low_stock_threshold": 5,
        "vat_category": "zero_rated",
        "requires_prescription": 1,
        "is_controlled": 1,
        "control_schedule": "SCHEDULE_IV",
        "max_public_price": "35.000",
        "stock_quantity": 20,
    },
]

with conn.cursor() as cur:
    for m in MEDICINES:
        cur.execute("""
            INSERT INTO medicines
                (id, name_en, name_ar, generic_name, barcode, category, form, strength, unit,
                 selling_price, low_stock_threshold, vat_category, requires_prescription,
                 is_controlled, max_public_price, stock_quantity)
            VALUES
                (%(id)s, %(name_en)s, %(name_ar)s, %(generic_name)s, %(barcode)s,
                 %(category)s, %(form)s, %(strength)s, %(unit)s,
                 %(selling_price)s, %(low_stock_threshold)s, %(vat_category)s,
                 %(requires_prescription)s, %(is_controlled)s, %(max_public_price)s,
                 %(stock_quantity)s)
        """, m)
conn.commit()
print(f"   {len(MEDICINES)} medicines")

# ── Batches (2 per medicine at br-001 and br-002) ────────────────────────────
print("--> Seeding batches...")
BATCHES = []
MINIMAL_BRANCHES = ["br-001", "br-002"]
for med in MEDICINES:
    sup_id = "sup-001"
    unit_cost = str(round(float(med["selling_price"]) * 0.6, 3))
    for br in MINIMAL_BRANCHES:
        # Batch A: expires in ~18 months (fresh)
        BATCHES.append({
            "id": str(uuid.uuid4()),
            "medicine_id": med["id"],
            "branch_id": br,
            "supplier_id": sup_id,
            "batch_number": f"BATCH-{med['id'][-3:]}-{br[-3:].upper()}-A",
            "expiry_date": (today + timedelta(days=548)).isoformat(),
            "manufacturing_date": (today - timedelta(days=90)).isoformat(),
            "qty_received": 30,
            "qty_remaining": 30,
            "unit_cost": unit_cost,
            "status": "active",
        })
        # Batch B: expires in ~75 days (near expiry — visible in alerts)
        BATCHES.append({
            "id": str(uuid.uuid4()),
            "medicine_id": med["id"],
            "branch_id": br,
            "supplier_id": sup_id,
            "batch_number": f"BATCH-{med['id'][-3:]}-{br[-3:].upper()}-B",
            "expiry_date": (today + timedelta(days=75)).isoformat(),
            "manufacturing_date": (today - timedelta(days=300)).isoformat(),
            "qty_received": 20,
            "qty_remaining": 20,
            "unit_cost": unit_cost,
            "status": "active",
        })

with conn.cursor() as cur:
    for b in BATCHES:
        cur.execute("""
            INSERT INTO batches
                (id, medicine_id, branch_id, supplier_id, batch_number,
                 expiry_date, manufacturing_date, qty_received, qty_remaining, unit_cost, status, sfda_status)
            VALUES
                (%(id)s, %(medicine_id)s, %(branch_id)s, %(supplier_id)s, %(batch_number)s,
                 %(expiry_date)s, %(manufacturing_date)s, %(qty_received)s, %(qty_remaining)s,
                 %(unit_cost)s, %(status)s, 'active')
        """, b)
conn.commit()
print(f"   {len(BATCHES)} batches")

# ── Coupons ───────────────────────────────────────────────────────────────────
print("--> Seeding coupons...")
COUPONS = [
    {
        "id": str(uuid.uuid4()),
        "code": "DEMO10",
        "type": "promotional",
        "discount_type": "percentage",
        "discount_value": "10.000",
        "description_en": "Demo 10% discount",
        "description_ar": "خصم 10% تجريبي",
        "valid_from": today.isoformat(),
        "valid_until": (today + timedelta(days=365)).isoformat(),
        "max_uses": 1000,
        "is_active": 1,
        "created_by": "usr-admin-001",
    },
    {
        "id": str(uuid.uuid4()),
        "code": "DEMO20",
        "type": "promotional",
        "discount_type": "percentage",
        "discount_value": "20.000",
        "description_en": "Demo 20% discount",
        "description_ar": "خصم 20% تجريبي",
        "valid_from": today.isoformat(),
        "valid_until": (today + timedelta(days=365)).isoformat(),
        "max_uses": 100,
        "is_active": 1,
        "created_by": "usr-admin-001",
    },
]
with conn.cursor() as cur:
    for c in COUPONS:
        cur.execute("""
            INSERT INTO coupons
                (id, code, type, discount_type, discount_value,
                 description_en, description_ar, valid_from, valid_until,
                 max_uses, is_active, created_by)
            VALUES
                (%(id)s, %(code)s, %(type)s, %(discount_type)s, %(discount_value)s,
                 %(description_en)s, %(description_ar)s, %(valid_from)s, %(valid_until)s,
                 %(max_uses)s, %(is_active)s, %(created_by)s)
        """, c)
conn.commit()
print(f"   {len(COUPONS)} coupons")

# ── Invoice sequences ─────────────────────────────────────────────────────────
print("--> Seeding invoice sequences...")
year = today.year
with conn.cursor() as cur:
    for br in BRANCHES:
        try:
            cur.execute("""
                INSERT INTO invoice_sequences (branch_id, year, last_icv)
                VALUES (%s, %s, 0)
                ON DUPLICATE KEY UPDATE last_icv = last_icv
            """, (br["id"], year))
        except Exception:
            pass
conn.commit()

print()
print("=" * 50)
print("  PharmaFlow seed complete")
print("=" * 50)
print(f"  Branches:   {len(BRANCHES)}")
print(f"  Users:      {len(USERS)}")
print(f"  Suppliers:  {len(SUPPLIERS)}")
print(f"  Medicines:  {len(MEDICINES)}")
print(f"  Batches:    {len(BATCHES)}")
print(f"  Coupons:    {len(COUPONS)}")
print()
print("  Credentials:")
print("  admin@demo.pharmaflow   /  Demo@1234  (admin, br-001)")
print("  pharm1@demo.pharmaflow  /  Demo@1234  (pharmacist, br-001)")
print("  pharm2@demo.pharmaflow  /  Demo@1234  (pharmacist, br-002)")
print()
print("  Coupon codes: DEMO10 (10%), DEMO20 (20%)")
print()

conn.close()
