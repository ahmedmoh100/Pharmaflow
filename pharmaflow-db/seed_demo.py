"""
PharmaFlow ERP/POS Demo — Demo Seed
====================================
Loads the minimal seed first, then adds rich demo data on top:

  4 Branches      (2 added to the 2 from minimal seed)
  25 Medicines    (20 added to the 5 from minimal seed)
  10 Suppliers    (7 added to the 3 from minimal seed)
  8 Customers
  90 Sales        (spread over last 60 days, across branches)
  ~180 Sale Items
  8 Returns / Credit Notes
  10 Purchase Orders
  8 Sessions      (closed shifts with Z-report data)

Usage:
  cd pharmaflow-db
  python seed_minimal.py   # always run first
  python seed_demo.py
"""

import os
import sys
import uuid
import json
import random
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from dotenv import load_dotenv
import pymysql

load_dotenv(Path(__file__).parent.parent / "pharmaflow-backend" / ".env")
DATABASE_URL = os.environ.get("DATABASE_URL", "mysql+pymysql://root:@127.0.0.1:3306/pharmaflow")

def parse_url(url):
    url = url.replace("mysql+pymysql://", "").replace("mysql://", "")
    user_pass, rest = url.split("@", 1)
    host_port, database = rest.split("/", 1)
    user, password = (user_pass.split(":", 1) if ":" in user_pass else (user_pass, ""))
    host, port = (host_port.split(":", 1) if ":" in host_port else (host_port, "3306"))
    return {"host": host, "port": int(port), "user": user, "password": password, "database": database}

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
rng = random.Random(42)  # fixed seed for reproducibility

# ── Extra Branches ────────────────────────────────────────────────────────────
print("--> Adding extra branches...")
EXTRA_BRANCHES = [
    {
        "id": "br-003",
        "code": "BR-003",
        "name_en": "PharmaFlow — East Branch",
        "name_ar": "فارما فلو — الفرع الشرقي",
        "city_en": "Dammam",
        "city_ar": "الدمام",
        "vat_number": "311111111111113",
        "address": "Prince Mohammed St, Dammam",
    },
    {
        "id": "br-004",
        "code": "BR-004",
        "name_en": "PharmaFlow — West Branch",
        "name_ar": "فارما فلو — الفرع الغربي",
        "city_en": "Jeddah",
        "city_ar": "جدة",
        "vat_number": "311111111111113",
        "address": "Tahlia Street, Jeddah",
    },
]
with conn.cursor() as cur:
    for b in EXTRA_BRANCHES:
        cur.execute("""
            INSERT IGNORE INTO branches (id, code, name_en, name_ar, city_en, city_ar, vat_number, address)
            VALUES (%(id)s, %(code)s, %(name_en)s, %(name_ar)s, %(city_en)s, %(city_ar)s, %(vat_number)s, %(address)s)
        """, b)
        cur.execute("""
            INSERT IGNORE INTO invoice_sequences (branch_id, year, last_icv) VALUES (%s, %s, 0)
        """, (b["id"], today.year))
conn.commit()
print(f"   {len(EXTRA_BRANCHES)} extra branches")

# Add near-expiry batches for new branches (mirrors minimal seed B batches)
print("--> Seeding near-expiry batches for br-003 and br-004...")
MINIMAL_MED_IDS = ["med-001", "med-002", "med-003", "med-004", "med-005"]
near_expiry_batches = []
for med_id in MINIMAL_MED_IDS:
    with conn.cursor() as cur:
        cur.execute("SELECT selling_price FROM medicines WHERE id = %s", (med_id,))
        row = cur.fetchone()
    if not row:
        continue
    unit_cost = str(round(float(row["selling_price"]) * 0.6, 3))
    for br in ["br-003", "br-004"]:
        near_expiry_batches.append({
            "id": str(uuid.uuid4()),
            "medicine_id": med_id,
            "branch_id": br,
            "supplier_id": "sup-001",
            "batch_number": f"BATCH-{med_id[-3:]}-{br[-3:].upper()}-A",
            "expiry_date": (today + timedelta(days=548)).isoformat(),
            "manufacturing_date": (today - timedelta(days=90)).isoformat(),
            "qty_received": 30,
            "qty_remaining": 30,
            "unit_cost": unit_cost,
            "status": "active",
            "sfda_status": "active",
        })
        near_expiry_batches.append({
            "id": str(uuid.uuid4()),
            "medicine_id": med_id,
            "branch_id": br,
            "supplier_id": "sup-001",
            "batch_number": f"BATCH-{med_id[-3:]}-{br[-3:].upper()}-B",
            "expiry_date": (today + timedelta(days=75)).isoformat(),
            "manufacturing_date": (today - timedelta(days=300)).isoformat(),
            "qty_received": 20,
            "qty_remaining": 20,
            "unit_cost": unit_cost,
            "status": "active",
            "sfda_status": "active",
        })
with conn.cursor() as cur:
    for b in near_expiry_batches:
        cur.execute("""
            INSERT IGNORE INTO batches
                (id, medicine_id, branch_id, supplier_id, batch_number,
                 expiry_date, manufacturing_date, qty_received, qty_remaining,
                 unit_cost, status, sfda_status)
            VALUES
                (%(id)s, %(medicine_id)s, %(branch_id)s, %(supplier_id)s, %(batch_number)s,
                 %(expiry_date)s, %(manufacturing_date)s, %(qty_received)s, %(qty_remaining)s,
                 %(unit_cost)s, %(status)s, %(sfda_status)s)
        """, b)
conn.commit()
print(f"   {len(near_expiry_batches)} near-expiry batches for br-003 and br-004")

# ── Extra Suppliers ───────────────────────────────────────────────────────────
print("--> Adding extra suppliers...")
EXTRA_SUPPLIERS = [
    {"id": "sup-004", "name_en": "Delta Pharma Supplies",      "name_ar": "دلتا للمستلزمات الدوائية",   "tax_number": "311222333444004", "supplier_type": "distributor"},
    {"id": "sup-005", "name_en": "Epsilon Medical Trading",    "name_ar": "إبسيلون للتجارة الطبية",     "tax_number": "311222333444005", "supplier_type": "wholesaler"},
    {"id": "sup-006", "name_en": "Zeta Healthcare Products",   "name_ar": "زيتا للمنتجات الصحية",       "tax_number": "311222333444006", "supplier_type": "distributor"},
    {"id": "sup-007", "name_en": "Eta Pharma Distribution",    "name_ar": "إيتا لتوزيع الأدوية",        "tax_number": "311222333444007", "supplier_type": "distributor"},
    {"id": "sup-008", "name_en": "Theta Medical Wholesale",    "name_ar": "ثيتا للجملة الطبية",         "tax_number": "311222333444008", "supplier_type": "wholesaler"},
    {"id": "sup-009", "name_en": "Iota Pharmaceutical Co.",    "name_ar": "شركة يوتا الدوائية",         "tax_number": "311222333444009", "supplier_type": "manufacturer"},
    {"id": "sup-010", "name_en": "Kappa Drug Distributors",    "name_ar": "كابا لتوزيع الأدوية",        "tax_number": "311222333444010", "supplier_type": "distributor"},
]
with conn.cursor() as cur:
    for s in EXTRA_SUPPLIERS:
        cur.execute("""
            INSERT IGNORE INTO suppliers (id, name_en, name_ar, tax_number, supplier_type,
                contact_person, phone, email)
            VALUES (%(id)s, %(name_en)s, %(name_ar)s, %(tax_number)s, %(supplier_type)s,
                'Sales Team', '+966500000000', 'sales@demo.pharmaflow')
        """, s)
conn.commit()
print(f"   {len(EXTRA_SUPPLIERS)} extra suppliers")

# ── Extra Medicines ───────────────────────────────────────────────────────────
print("--> Adding extra medicines...")
EXTRA_MEDICINES = [
    # Zero-rated
    {"id": "med-006",  "name_en": "Brufen 400mg Tablets (24 Tabs)",            "name_ar": "بروفين 400 مجم أقراص (24 قرص)",               "generic_name": "ibuprofen",        "barcode": "6010000000006",  "category": "analgesics",    "form": "Tablet",  "strength": "400mg",   "unit": "Box",    "selling_price": "22.000", "vat_category": "zero_rated",  "low_stock_threshold": 15, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "28.000",  "stock_quantity": 60},
    {"id": "med-007",  "name_en": "Augmentin 625mg Tablets (14 Tabs)",          "name_ar": "أوجمنتين 625 مجم أقراص (14 قرص)",             "generic_name": "amoxicillin clavulanate", "barcode": "6010000000007", "category": "antibiotics",   "form": "Tablet",  "strength": "625mg",   "unit": "Box",    "selling_price": "48.000", "vat_category": "zero_rated",  "low_stock_threshold": 10, "requires_prescription": 1, "is_controlled": 0, "max_public_price": "55.000",  "stock_quantity": 40},
    {"id": "med-008",  "name_en": "Cipro 500mg Tablets (10 Tabs)",              "name_ar": "سيبرو 500 مجم أقراص (10 أقراص)",              "generic_name": "ciprofloxacin",    "barcode": "6010000000008",  "category": "antibiotics",   "form": "Tablet",  "strength": "500mg",   "unit": "Box",    "selling_price": "35.000", "vat_category": "zero_rated",  "low_stock_threshold": 10, "requires_prescription": 1, "is_controlled": 0, "max_public_price": "42.000",  "stock_quantity": 45},
    {"id": "med-009",  "name_en": "Nexium 40mg Capsules (14 Caps)",             "name_ar": "نيكسيوم 40 مجم كبسولات (14 كبسولة)",          "generic_name": "esomeprazole",     "barcode": "6010000000009",  "category": "gastro",        "form": "Capsule", "strength": "40mg",    "unit": "Box",    "selling_price": "42.000", "vat_category": "zero_rated",  "low_stock_threshold": 10, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "50.000",  "stock_quantity": 55},
    {"id": "med-010",  "name_en": "Zithromax 500mg Tablets (3 Tabs)",           "name_ar": "زيثروماكس 500 مجم أقراص (3 أقراص)",           "generic_name": "azithromycin",     "barcode": "6010000000010",  "category": "antibiotics",   "form": "Tablet",  "strength": "500mg",   "unit": "Box",    "selling_price": "38.000", "vat_category": "zero_rated",  "low_stock_threshold": 8,  "requires_prescription": 1, "is_controlled": 0, "max_public_price": "45.000",  "stock_quantity": 35},
    {"id": "med-011",  "name_en": "Concor 5mg Tablets (30 Tabs)",               "name_ar": "كونكور 5 مجم أقراص (30 قرص)",                 "generic_name": "bisoprolol",       "barcode": "6010000000011",  "category": "cardiology",    "form": "Tablet",  "strength": "5mg",     "unit": "Box",    "selling_price": "55.000", "vat_category": "zero_rated",  "low_stock_threshold": 8,  "requires_prescription": 1, "is_controlled": 0, "max_public_price": "65.000",  "stock_quantity": 30},
    {"id": "med-012",  "name_en": "Glucophage 500mg Tablets (30 Tabs)",         "name_ar": "جلوكوفاج 500 مجم أقراص (30 قرص)",             "generic_name": "metformin",        "barcode": "6010000000012",  "category": "diabetes",      "form": "Tablet",  "strength": "500mg",   "unit": "Box",    "selling_price": "28.000", "vat_category": "zero_rated",  "low_stock_threshold": 10, "requires_prescription": 1, "is_controlled": 0, "max_public_price": "35.000",  "stock_quantity": 50},
    {"id": "med-013",  "name_en": "Voltaren Gel 50g",                           "name_ar": "فولتارين جل 50 جرام",                         "generic_name": "diclofenac",       "barcode": "6010000000013",  "category": "analgesics",    "form": "Gel",     "strength": "1%",      "unit": "Tube",   "selling_price": "32.000", "vat_category": "zero_rated",  "low_stock_threshold": 12, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "38.000",  "stock_quantity": 45},
    {"id": "med-014",  "name_en": "Ventolin Inhaler 100mcg",                   "name_ar": "فنتولين بخاخ 100 ميكروجرام",                  "generic_name": "salbutamol",       "barcode": "6010000000014",  "category": "respiratory",   "form": "Inhaler", "strength": "100mcg",  "unit": "Unit",   "selling_price": "52.000", "vat_category": "zero_rated",  "low_stock_threshold": 8,  "requires_prescription": 1, "is_controlled": 0, "max_public_price": "62.000",  "stock_quantity": 25},
    {"id": "med-015",  "name_en": "Lipitor 20mg Tablets (30 Tabs)",             "name_ar": "ليبيتور 20 مجم أقراص (30 قرص)",               "generic_name": "atorvastatin",     "barcode": "6010000000015",  "category": "cardiology",    "form": "Tablet",  "strength": "20mg",    "unit": "Box",    "selling_price": "62.000", "vat_category": "zero_rated",  "low_stock_threshold": 8,  "requires_prescription": 1, "is_controlled": 0, "max_public_price": "72.000",  "stock_quantity": 35},
    # Standard VAT (15%)
    {"id": "med-016",  "name_en": "Vitamin C 1000mg Effervescent (20 Tabs)",    "name_ar": "فيتامين سي 1000 مجم فوار (20 قرص)",           "generic_name": "ascorbic acid",    "barcode": "6010000000016",  "category": "vitamins",      "form": "Effervescent","strength": "1000mg","unit": "Tube",  "selling_price": "38.000", "vat_category": "standard",    "low_stock_threshold": 10, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "45.000",  "stock_quantity": 70},
    {"id": "med-017",  "name_en": "Omega-3 Fish Oil 1000mg (60 Caps)",          "name_ar": "أوميجا-3 زيت السمك 1000 مجم (60 كبسولة)",    "generic_name": "omega-3",          "barcode": "6010000000017",  "category": "vitamins",      "form": "Capsule", "strength": "1000mg",  "unit": "Bottle", "selling_price": "65.000", "vat_category": "standard",    "low_stock_threshold": 8,  "requires_prescription": 0, "is_controlled": 0, "max_public_price": "78.000",  "stock_quantity": 55},
    {"id": "med-018",  "name_en": "Calcium + D3 600mg (60 Tabs)",               "name_ar": "كالسيوم + د3 600 مجم (60 قرص)",               "generic_name": "calcium carbonate","barcode": "6010000000018",  "category": "vitamins",      "form": "Tablet",  "strength": "600mg",   "unit": "Bottle", "selling_price": "42.000", "vat_category": "standard",    "low_stock_threshold": 10, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "52.000",  "stock_quantity": 60},
    {"id": "med-019",  "name_en": "Colgate Sensitive Toothpaste 110g",          "name_ar": "كولجيت سنستيف معجون أسنان 110 جرام",          "generic_name": "potassium nitrate","barcode": "6010000000019",  "category": "personal_care", "form": "Paste",   "strength": "5%",      "unit": "Tube",   "selling_price": "22.000", "vat_category": "standard",    "low_stock_threshold": 15, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "28.000",  "stock_quantity": 80},
    {"id": "med-020",  "name_en": "Dettol Antiseptic Liquid 250ml",             "name_ar": "ديتول سائل مطهر 250 مل",                      "generic_name": "chloroxylenol",    "barcode": "6010000000020",  "category": "antiseptics",   "form": "Liquid",  "strength": "4.8%",    "unit": "Bottle", "selling_price": "18.000", "vat_category": "standard",    "low_stock_threshold": 15, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "24.000",  "stock_quantity": 90},
    {"id": "med-021",  "name_en": "Nivea Body Lotion SPF15 400ml",              "name_ar": "نيفيا لوشن جسم واقي شمس 400 مل",              "generic_name": "glycerin",         "barcode": "6010000000021",  "category": "personal_care", "form": "Lotion",  "strength": "SPF15",   "unit": "Bottle", "selling_price": "32.000", "vat_category": "standard",    "low_stock_threshold": 10, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "40.000",  "stock_quantity": 65},
    {"id": "med-022",  "name_en": "Ensure Nutrition Shake Vanilla 237ml",       "name_ar": "إنشور تغذية فانيليا 237 مل",                  "generic_name": "nutritional supplement","barcode": "6010000000022","category": "nutrition",     "form": "Liquid",  "strength": "N/A",     "unit": "Can",    "selling_price": "25.000", "vat_category": "standard",    "low_stock_threshold": 12, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "32.000",  "stock_quantity": 75},
    {"id": "med-023",  "name_en": "Blood Pressure Monitor Wrist (1 Unit)",      "name_ar": "جهاز قياس ضغط الدم للمعصم (وحدة)",            "generic_name": "medical device",   "barcode": "6010000000023",  "category": "devices",       "form": "Device",  "strength": "N/A",     "unit": "Unit",   "selling_price": "185.000","vat_category": "standard",    "low_stock_threshold": 3,  "requires_prescription": 0, "is_controlled": 0, "max_public_price": "220.000", "stock_quantity": 12},
    {"id": "med-024",  "name_en": "Glucometer Test Strips (50 Strips)",         "name_ar": "شرائط قياس السكر (50 شريط)",                  "generic_name": "glucose test strip","barcode": "6010000000024", "category": "devices",       "form": "Strips",  "strength": "N/A",     "unit": "Box",    "selling_price": "72.000", "vat_category": "standard",    "low_stock_threshold": 5,  "requires_prescription": 0, "is_controlled": 0, "max_public_price": "88.000",  "stock_quantity": 28},
    {"id": "med-025",  "name_en": "Surgical Face Mask (50 Pcs)",                "name_ar": "كمامة جراحية (50 قطعة)",                      "generic_name": "surgical mask",    "barcode": "6010000000025",  "category": "ppe",           "form": "Mask",    "strength": "N/A",     "unit": "Box",    "selling_price": "28.000", "vat_category": "standard",    "low_stock_threshold": 10, "requires_prescription": 0, "is_controlled": 0, "max_public_price": "35.000",  "stock_quantity": 100},
]
with conn.cursor() as cur:
    for m in EXTRA_MEDICINES:
        cur.execute("""
            INSERT IGNORE INTO medicines
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
print(f"   {len(EXTRA_MEDICINES)} extra medicines")

# Add batches for new medicines at br-001
print("--> Adding batches for extra medicines...")
ALL_BRANCH_IDS = ["br-001", "br-002", "br-003", "br-004"]
extra_batches = []
for med in EXTRA_MEDICINES:
    unit_cost = str(round(float(med["selling_price"]) * 0.6, 3))
    for br in ["br-001", "br-002", "br-003", "br-004"]:
        extra_batches.append({
            "id": str(uuid.uuid4()),
            "medicine_id": med["id"],
            "branch_id": br,
            "supplier_id": rng.choice(["sup-001", "sup-002", "sup-003", "sup-004", "sup-005"]),
            "batch_number": f"BATCH-{med['id'][-3:]}-{br[-3:].upper()}",
            "expiry_date": (today + timedelta(days=rng.randint(180, 730))).isoformat(),
            "manufacturing_date": (today - timedelta(days=rng.randint(30, 180))).isoformat(),
            "qty_received": rng.randint(20, 50),
            "qty_remaining": rng.randint(10, 40),
            "unit_cost": unit_cost,
            "status": "active",
            "sfda_status": "active",
        })
with conn.cursor() as cur:
    for b in extra_batches:
        cur.execute("""
            INSERT IGNORE INTO batches
                (id, medicine_id, branch_id, supplier_id, batch_number,
                 expiry_date, manufacturing_date, qty_received, qty_remaining,
                 unit_cost, status, sfda_status)
            VALUES
                (%(id)s, %(medicine_id)s, %(branch_id)s, %(supplier_id)s, %(batch_number)s,
                 %(expiry_date)s, %(manufacturing_date)s, %(qty_received)s, %(qty_remaining)s,
                 %(unit_cost)s, %(status)s, %(sfda_status)s)
        """, b)
conn.commit()
print(f"   {len(extra_batches)} batches")

# ── Customers ─────────────────────────────────────────────────────────────────
print("--> Seeding customers...")
CUSTOMERS = [
    {"id": str(uuid.uuid4()), "name_ar": "محمد العمري",     "name_en": "Mohammed Al-Omari",  "phone": "0501111001", "national_id": "1000000001"},
    {"id": str(uuid.uuid4()), "name_ar": "سارة الغامدي",    "name_en": "Sarah Al-Ghamdi",    "phone": "0501111002", "national_id": "1000000002"},
    {"id": str(uuid.uuid4()), "name_ar": "خالد الدوسري",    "name_en": "Khalid Al-Dosari",   "phone": "0501111003", "national_id": "1000000003"},
    {"id": str(uuid.uuid4()), "name_ar": "نورة الشهراني",   "name_en": "Noura Al-Shahrani",  "phone": "0501111004", "national_id": "1000000004"},
    {"id": str(uuid.uuid4()), "name_ar": "فيصل الزهراني",   "name_en": "Faisal Al-Zahrani",  "phone": "0501111005", "national_id": "1000000005"},
    {"id": str(uuid.uuid4()), "name_ar": "ريم القحطاني",    "name_en": "Reem Al-Qahtani",    "phone": "0501111006", "national_id": "1000000006"},
    {"id": str(uuid.uuid4()), "name_ar": "عبدالله المالكي", "name_en": "Abdullah Al-Maliki", "phone": "0501111007", "national_id": "1000000007"},
    {"id": str(uuid.uuid4()), "name_ar": "هند العتيبي",     "name_en": "Hind Al-Otaibi",     "phone": "0501111008", "national_id": "1000000008"},
]
with conn.cursor() as cur:
    for c in CUSTOMERS:
        cur.execute("""
            INSERT INTO customers (id, name_ar, name_en, phone, national_id)
            VALUES (%(id)s, %(name_ar)s, %(name_en)s, %(phone)s, %(national_id)s)
        """, c)
conn.commit()
print(f"   {len(CUSTOMERS)} customers")

# ── Purchase Orders ────────────────────────────────────────────────────────────
print("--> Seeding purchase orders...")
PO_DATA = []
for i in range(10):
    po_id = str(uuid.uuid4())
    br = rng.choice(["br-001", "br-002", "br-003", "br-004"])
    sup = rng.choice(["sup-001", "sup-002", "sup-003", "sup-004", "sup-005"])
    status = rng.choice(["RECEIVED", "RECEIVED", "RECEIVED", "SENT", "DRAFT"])
    created_days_ago = rng.randint(5, 45)
    PO_DATA.append({
        "id": po_id,
        "supplier_id": sup,
        "branch_id": br,
        "status": status,
        "notes": f"Demo PO {i+1}",
        "created_by": "usr-admin-001",
        "created_at": (now - timedelta(days=created_days_ago)).strftime("%Y-%m-%d %H:%M:%S"),
    })

with conn.cursor() as cur:
    for po in PO_DATA:
        cur.execute("""
            INSERT INTO purchase_orders (id, supplier_id, branch_id, status, notes, created_by, created_at)
            VALUES (%(id)s, %(supplier_id)s, %(branch_id)s, %(status)s, %(notes)s, %(created_by)s, %(created_at)s)
        """, po)
        # Add 1-3 items per PO
        med_ids = ["med-001", "med-002", "med-003", "med-006", "med-007", "med-008", "med-009", "med-010"]
        for med_id in rng.sample(med_ids, k=rng.randint(1, 3)):
            cur.execute("""
                INSERT INTO purchase_order_items (id, po_id, medicine_id, ordered_qty, agreed_unit_cost)
                VALUES (%s, %s, %s, %s, %s)
            """, (str(uuid.uuid4()), po["id"], med_id, rng.randint(10, 50), round(rng.uniform(10, 40), 3)))
conn.commit()
print(f"   {len(PO_DATA)} purchase orders")

# ── Cash Sessions ──────────────────────────────────────────────────────────────
print("--> Seeding cash sessions...")
SESSIONS = []
for i in range(8):
    days_ago = rng.randint(1, 55)
    opened_dt = now - timedelta(days=days_ago, hours=rng.randint(0, 2))
    closed_dt = opened_dt + timedelta(hours=rng.randint(6, 10))
    br = rng.choice(["br-001", "br-002", "br-003", "br-004"])
    user = "usr-pharm-001" if br in ["br-001", "br-003"] else "usr-pharm-002"
    sess_id = str(uuid.uuid4())
    SESSIONS.append({
        "id": sess_id,
        "user_id": user,
        "branch_id": br,
        "opening_float": round(rng.uniform(200, 500), 3),
        "status": "CLOSED",
        "opened_at": opened_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "closed_at": closed_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "total_sales": rng.randint(8, 20),
        "total_revenue": round(rng.uniform(800, 3500), 3),
        "total_vat": round(rng.uniform(50, 200), 3),
    })
with conn.cursor() as cur:
    for s in SESSIONS:
        cur.execute("""
            INSERT INTO cash_sessions
                (id, user_id, branch_id, opening_float, status, opened_at, closed_at,
                 total_sales, total_revenue, total_vat)
            VALUES
                (%(id)s, %(user_id)s, %(branch_id)s, %(opening_float)s, %(status)s,
                 %(opened_at)s, %(closed_at)s, %(total_sales)s, %(total_revenue)s, %(total_vat)s)
        """, s)
conn.commit()
print(f"   {len(SESSIONS)} sessions")

# ── Sales ──────────────────────────────────────────────────────────────────────
print("--> Seeding sales...")

# Fetch batches per branch for FIFO assignment
def get_batches(cur, branch_id):
    cur.execute("""
        SELECT b.id, b.medicine_id, b.qty_remaining, b.unit_cost, m.selling_price, m.vat_category
        FROM batches b JOIN medicines m ON m.id = b.medicine_id
        WHERE b.branch_id = %s AND b.qty_remaining > 0 AND b.status = 'active'
        ORDER BY b.expiry_date ASC
    """, (branch_id,))
    return cur.fetchall()

PAYMENT_METHODS = ["cash", "cash", "cash", "mada", "card", "cash", "mada"]
BRANCH_USERS = {"br-001": "usr-pharm-001", "br-002": "usr-pharm-002", "br-003": "usr-pharm-001", "br-004": "usr-pharm-002"}
BRANCH_CODES = {"br-001": "BR001", "br-002": "BR002", "br-003": "BR003", "br-004": "BR004"}

created_sales = []
with conn.cursor() as cur:
    # Get current ICV per branch
    cur.execute("SELECT branch_id, last_icv FROM invoice_sequences WHERE year = %s", (today.year,))
    icv_map = {r["branch_id"]: r["last_icv"] for r in cur.fetchall()}

    for sale_idx in range(90):
        days_ago = rng.randint(0, 59)
        sale_dt = now - timedelta(days=days_ago, hours=rng.randint(8, 20), minutes=rng.randint(0, 59))
        br = rng.choice(["br-001", "br-001", "br-001", "br-002", "br-002", "br-003", "br-003", "br-004"])
        user_id = BRANCH_USERS[br]
        payment = rng.choice(PAYMENT_METHODS)
        cust = rng.choice(CUSTOMERS) if rng.random() < 0.3 else None

        batches = get_batches(cur, br)
        if not batches:
            continue

        # Pick 1-4 items
        selected = rng.sample(batches, k=min(rng.randint(1, 4), len(batches)))
        items = []
        for b in selected:
            qty = rng.randint(1, 3)
            price = float(b["selling_price"])
            vat_rate = 15.0 if b["vat_category"] == "standard" else 0.0
            vat_amt = round(price * qty * vat_rate / 100, 3)
            items.append({
                "medicine_id": b["medicine_id"],
                "batch_id": b["id"],
                "quantity": qty,
                "unit_price": price,
                "vat_rate": vat_rate,
                "vat_amount": vat_amt,
                "cost_at_sale": float(b["unit_cost"]),
            })

        subtotal = round(sum(i["unit_price"] * i["quantity"] for i in items), 3)
        vat_total = round(sum(i["vat_amount"] for i in items), 3)
        total = round(subtotal + vat_total, 3)

        # Increment ICV
        icv = icv_map.get(br, 0) + 1
        icv_map[br] = icv
        invoice_number = f"{BRANCH_CODES[br]}-{today.year}-{icv:05d}"
        sale_id = str(uuid.uuid4())
        sale_uuid = str(uuid.uuid4())

        vat_breakdown = json.dumps([
            {"rate": 15.0, "taxable_amount": round(subtotal - round(sum(i["unit_price"]*i["quantity"] for i in items if i["vat_rate"] == 0), 3), 3), "vat_amount": vat_total}
        ] if vat_total > 0 else [
            {"rate": 0.0, "taxable_amount": subtotal, "vat_amount": 0.0}
        ])

        cur.execute("""
            INSERT INTO sales
                (id, branch_id, user_id, invoice_number, uuid, icv,
                 subtotal_amount, vat_amount, total_amount, vat_breakdown,
                 payment_method, notes, sold_at,
                 customer_id, customer_name, zatca_status, zatca_hash)
            VALUES
                (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'reported','')
        """, (
            sale_id, br, user_id, invoice_number, sale_uuid, icv,
            subtotal, vat_total, total, vat_breakdown,
            payment, "",
            sale_dt.strftime("%Y-%m-%d %H:%M:%S"),
            cust["id"] if cust else None,
            cust["name_en"] if cust else "",
        ))

        for item in items:
            cur.execute("""
                INSERT INTO sale_items
                    (id, sale_id, medicine_id, batch_id, quantity, unit_price,
                     vat_rate, vat_amount, cost_at_sale)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                str(uuid.uuid4()), sale_id,
                item["medicine_id"], item["batch_id"],
                item["quantity"], item["unit_price"],
                item["vat_rate"], item["vat_amount"], item["cost_at_sale"],
            ))
            # Deduct stock
            cur.execute("""
                UPDATE batches SET qty_remaining = GREATEST(0, qty_remaining - %s) WHERE id = %s
            """, (item["quantity"], item["batch_id"]))

        created_sales.append({"id": sale_id, "branch_id": br, "total": total, "user_id": user_id, "invoice_number": invoice_number})

    # Update ICV counters
    for br_id, last_icv in icv_map.items():
        cur.execute("""
            INSERT INTO invoice_sequences (branch_id, year, last_icv) VALUES (%s,%s,%s)
            ON DUPLICATE KEY UPDATE last_icv = %s
        """, (br_id, today.year, last_icv, last_icv))

conn.commit()
print(f"   {len(created_sales)} sales")

# ── Returns (8 credit notes) ──────────────────────────────────────────────────
print("--> Seeding returns...")
returnable_sales = [s for s in created_sales if s["total"] > 50]
return_sample = rng.sample(returnable_sales, k=min(8, len(returnable_sales)))

with conn.cursor() as cur:
    for s in return_sample:
        # Get first item from this sale
        cur.execute("SELECT * FROM sale_items WHERE sale_id = %s LIMIT 1", (s["id"],))
        item = cur.fetchone()
        if not item:
            continue

        return_id = str(uuid.uuid4())
        refund = round(float(item["unit_price"]) * 1, 3)
        return_dt = (now - timedelta(days=rng.randint(0, 10))).strftime("%Y-%m-%d %H:%M:%S")

        cur.execute("""
            INSERT INTO sale_returns
                (id, sale_id, branch_id, processed_by, total_refund, reason, created_at)
            VALUES (%s,%s,%s,%s,%s,'Customer request',%s)
        """, (return_id, s["id"], s["branch_id"], s["user_id"], refund, return_dt))

        cur.execute("""
            INSERT INTO sale_return_items
                (id, return_id, sale_item_id, quantity, restockable, reason)
            VALUES (%s,%s,%s,1,1,'Customer request')
        """, (str(uuid.uuid4()), return_id, item["id"]))

        # Credit note
        cur.execute("SELECT uuid, invoice_number FROM sales WHERE id = %s", (s["id"],))
        sale_row = cur.fetchone()
        cn_number = f"CN-{s['branch_id'][-3:].upper()}-{today.year}-{rng.randint(1000,9999)}"
        cur.execute("""
            INSERT INTO credit_notes (id, return_id, original_invoice_uuid, credit_note_number, amount, created_at)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, (str(uuid.uuid4()), return_id, sale_row["uuid"], cn_number, refund, return_dt))

conn.commit()
print(f"   {len(return_sample)} returns / credit notes")

# ── Stock Movements ────────────────────────────────────────────────────────────
print("--> Seeding stock movements (purchase receipts)...")
with conn.cursor() as cur:
    for po in PO_DATA[:6]:  # log receipts for first 6 POs
        cur.execute("SELECT * FROM purchase_order_items WHERE po_id = %s", (po["id"],))
        items = cur.fetchall()
        for item in items:
            cur.execute("""
                INSERT INTO stock_movements
                    (id, medicine_id, branch_id, movement_type, qty_delta, reference_id, reference_type, created_by, created_at)
                VALUES (%s,%s,%s,'IN',%s,%s,'purchase_order','usr-admin-001',%s)
            """, (
                str(uuid.uuid4()), item["medicine_id"], po["branch_id"],
                item["ordered_qty"], po["id"],
                po["created_at"]
            ))
conn.commit()
print("   stock movements logged")

# ── Stock Transfers ────────────────────────────────────────────────────────────
print("--> Seeding stock transfers...")
TRANSFER_DATA = [
    {"from": "br-001", "to": "br-002", "medicine_id": "med-001", "qty": 10, "days_ago": 12},
    {"from": "br-001", "to": "br-003", "medicine_id": "med-006", "qty": 8,  "days_ago": 8},
    {"from": "br-002", "to": "br-004", "medicine_id": "med-004", "qty": 5,  "days_ago": 5},
    {"from": "br-001", "to": "br-002", "medicine_id": "med-009", "qty": 12, "days_ago": 3},
    {"from": "br-003", "to": "br-004", "medicine_id": "med-007", "qty": 6,  "days_ago": 1},
]
with conn.cursor() as cur:
    for t in TRANSFER_DATA:
        transfer_id = str(uuid.uuid4())
        transfer_dt = (now - timedelta(days=t["days_ago"])).strftime("%Y-%m-%d %H:%M:%S")
        cur.execute("""
            INSERT INTO transfers
                (id, from_branch_id, to_branch_id, medicine_id, qty, status, notes, created_by, created_at)
            VALUES (%s,%s,%s,%s,%s,'COMPLETED','Demo stock transfer','usr-admin-001',%s)
        """, (transfer_id, t["from"], t["to"], t["medicine_id"], t["qty"], transfer_dt))
        # Log stock movements
        cur.execute("""
            INSERT INTO stock_movements
                (id, medicine_id, branch_id, movement_type, qty_delta, reference_id, reference_type, created_by, created_at)
            VALUES (%s,%s,%s,'OUT',%s,%s,'transfer','usr-admin-001',%s)
        """, (str(uuid.uuid4()), t["medicine_id"], t["from"], -t["qty"], transfer_id, transfer_dt))
        cur.execute("""
            INSERT INTO stock_movements
                (id, medicine_id, branch_id, movement_type, qty_delta, reference_id, reference_type, created_by, created_at)
            VALUES (%s,%s,%s,'IN',%s,%s,'transfer','usr-admin-001',%s)
        """, (str(uuid.uuid4()), t["medicine_id"], t["to"], t["qty"], transfer_id, transfer_dt))
conn.commit()
print(f"   {len(TRANSFER_DATA)} transfers")

# ── Final summary ──────────────────────────────────────────────────────────────
print()
print("=" * 50)
print("  PharmaFlow demo seed complete")
print("=" * 50)
with conn.cursor() as cur:
    for tbl in ["branches","users","medicines","suppliers","customers","sales","sale_returns","purchase_orders","cash_sessions","batches","credit_notes","transfers"]:
        cur.execute(f"SELECT COUNT(*) AS cnt FROM {tbl}")
        print(f"  {tbl:<25} {cur.fetchone()['cnt']}")
print()
conn.close()
