# PharmaFlow — ERP/POS Demo

A production-grade pharmacy chain management system built for the Saudi Arabian market. Covers the full operational cycle: inventory, procurement, point-of-sale, cash sessions, returns, stock transfers, and reporting — all in one system, bilingual Arabic/English, ZATCA-compliant.

Built as a portfolio demonstration by Ahmed Mahmoud Hamza.

---

## What It Does

A multi-branch pharmacy chain needs more than a simple inventory counter. PharmaFlow covers the full daily workflow:

- **Pharmacist** opens a cash session, serves customers at the POS (barcode or name search), handles prescriptions, processes returns, counts stock, and closes shift with a Z-report
- **Admin** manages inventory across all branches, raises purchase orders, receives goods into batches, monitors expiry and low-stock alerts, transfers stock between branches, runs reports, and reviews the full audit trail

Every stock movement — sale, return, transfer, write-off — is logged append-only. The system knows exactly where every unit came from and where it went.

---

## Features

### Point of Sale
- Barcode + name search in a single input (scanner-compatible)
- FIFO/FEFO batch deduction — oldest expiry sold first, enforced at DB level
- Split payment (cash + card + insurance + Wasfaty on one sale)
- Coupon system with usage tracking
- Global and per-item discounts
- Controlled substance gate — prescription capture required
- Shift lifecycle: open → break → tender declaration → X-report → Z-report → reprint

### Inventory & Procurement
- Batch-level stock traceability — every unit has a batch, supplier, cost, and expiry
- Purchase Orders: DRAFT → SENT → RECEIVED flow before stock hits inventory
- Goods Receipt against PO — confirms actual quantities and batch numbers
- Stock transfers between branches with FIFO deduction at source
- Write-off workflow for expired/damaged batches
- Low-stock alerts with suggested reorder quantities
- Expiry tracking with SAR-at-risk calculation

### Compliance (Saudi Arabia)
- ZATCA-compliant receipts: TLV-encoded QR code (seller name, VAT no, timestamp, totals)
- Per-line VAT: zero-rated medicines (qualifying drugs exempt from 15% VAT) and standard-rated (cosmetics, supplements) handled correctly on the same sale
- Gapless invoice counter (ICV) per branch per year — ZATCA Phase 1 requirement
- Credit notes with reference to original invoice UUID (ZATCA return requirement)
- Hijri dates on receipts alongside Gregorian

### Operations
- Multi-branch: 4 branches, data scoped per branch, admin sees all with branch switcher
- Full audit trail: every master data change logs who, what, when, before, after (JSON diff)
- Stock movement ledger: append-only, every IN/OUT/ADJUST/RETURN/TRANSFER logged
- Returns with restockable flag — non-restockable returns deduct permanently
- Prescription tracking: controlled substances require prescription capture before dispense
- Stock count module: physical count sheet → auto-adjustments → movement log

### Admin Reporting
- Sales report: daily chart, payment breakdown, top 10 medicines with gross profit and margin %
- By-pharmacist performance: transaction count, revenue, VAT, avg transaction
- Inventory report: stock value, by-category breakdown, low-stock list
- Purchases report: spend by supplier, spend by medicine
- VAT report: monthly zero-rated vs standard-rated with ZATCA CSV export

### UI
- Bilingual Arabic RTL (default) / English LTR — full switch including receipts
- POS terminal shell — full-screen, icon-only rail, tile grid, no sidebar scroll (D365 Commerce-style)
- 80mm receipt + A4 invoice, both with ZATCA QR
- Dark mode only (system default — no toggle)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 13.5, TypeScript, Tailwind CSS, Shadcn UI |
| Backend | Python 3.11, FastAPI, Uvicorn |
| Database | MySQL / MariaDB |
| Auth | JWT (python-jose), bcrypt |
| Internationalization | next-intl, Arabic RTL + English LTR |
| Charts | Recharts |
| Receipts | QRCode (ZATCA TLV), custom print CSS |
| Testing | pytest (backend, 139 tests), Playwright (frontend, 105 tests) |

---

## Project Structure

```
pharmaflow/
├── pharmaflow-frontend/          # Next.js 13.5 app
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── admin/            # Admin pages (dashboard, medicines, PO, reports...)
│   │   │   └── pharmacist/       # Pharmacist pages (POS, returns, stockcount...)
│   │   ├── context/              # BranchContext (branch picker state)
│   │   ├── lib/                  # api.ts, auth.ts, utils.ts, csv.ts
│   │   └── messages/             # ar.json, en.json (translations)
│   ├── components/
│   │   ├── layout/               # Sidebar, Header, NavTree, PosShell
│   │   └── shared/               # DataTable, KpiCard, D365Panel, ExpiryBadge...
│   └── tests/e2e/                # Playwright test suite (105 tests)
│
├── pharmaflow-backend/           # FastAPI app
│   ├── routers/                  # One file per domain (sales, purchases, transfers...)
│   ├── utils/                    # auth.py, audit.py
│   └── main.py                   # App entry point, router registration
│
└── pharmaflow-db/                # Database scripts
    ├── schema.sql                # Full schema
    └── seed_minimal.py           # Minimal demo seed (2 branches, 5 medicines)
```

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- MySQL or MariaDB running locally (XAMPP works)

### 1. Clone the repo

```bash
git clone https://github.com/ahmedmoh100/Pharmaflow.git
cd pharmaflow
```

### 2. Database setup

```bash
# Create the database
mysql -u root -p -e "CREATE DATABASE pharmaflow;"

# Import schema
mysql -u root -p pharmaflow < pharmaflow-db/schema.sql

# Seed minimal demo data
cd pharmaflow-db
python seed_minimal.py
```

### 3. Backend setup

```bash
cd pharmaflow-backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env — set DB_PASSWORD and JWT_SECRET_KEY
uvicorn main:app --reload --port 8000
```

### 4. Frontend setup

```bash
cd pharmaflow-frontend
npm install
cp .env.example .env.local
# Edit .env.local — set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

### 5. Open the app

| Service | URL |
|---|---|
| App | http://localhost:3000/ar/login |
| API Docs | http://localhost:8000/docs |

### Default demo credentials

| Role | Email | Password |
|---|---|---|
| Admin | admin@demo.pharmaflow | Demo@1234 |
| Pharmacist (Branch 1) | pharm1@demo.pharmaflow | Demo@1234 |
| Pharmacist (Branch 2) | pharm2@demo.pharmaflow | Demo@1234 |

> These credentials are seeded by `seed_minimal.py`. Change them in production.

---

## Running Tests

### Backend (pytest)

```bash
cd pharmaflow-backend
pytest tests/ -v
```

Expected: **139 tests passing**

### Frontend (Playwright)

With both servers running:

```bash
cd pharmaflow-frontend
npx playwright test tests/e2e/ --reporter=list
```

Expected: **105 tests passing**

---

## Compliance Integration Points

The following Saudi regulatory APIs are stubbed and ready for integration:

| Stub | API | What it connects to |
|---|---|---|
| `routers/sfda.py` | SFDA Drug Registry | Medicine registration lookup, recall checks |
| `routers/insurance.py` | NPHIES | Insurance claim submission, eligibility check |
| `routers/wasfaty.py` | Wasfaty | MOH e-prescription verification |
| `routers/mada.py` | mada / STC Pay | Saudi payment network integration |

These routes are registered but return `501 Not Implemented` until API credentials are provided. The data models and auth flow are already designed for each integration.

---

## What Is and Isn't Implemented

| Feature | Status |
|---|---|
| POS, inventory, procurement, transfers | ✅ Fully implemented |
| ZATCA Phase 1 QR codes | ✅ Implemented |
| ZATCA Phase 2 cryptographic stamping | ✅ Utility implemented (`zatca_phase2.py`) — not wired into live sales flow |
| Multi-branch with branch picker | ✅ Implemented |
| Bilingual AR/EN | ✅ Implemented |
| Full test suite (244 tests) | ✅ Implemented |
| Multi-user concurrent sessions | ✅ Idempotency keys prevent duplicate sales |
| NPHIES insurance claims | 🔶 Simulated workflow — no live payer connection |
| Wasfaty e-prescription API | 🔶 Simulated workflow with OTP + stock deduction — no live MOH connection |

---

## Related Projects

- [FAIA](https://github.com/ahmedmoh100/FAIA) — AI-powered educational chatbot with RAG, local LLM, and role-based access. Graduation project, FastAPI + Python + MySQL.

---

## License

MIT License — see [LICENSE](LICENSE)

---

## Author

Ahmed Mahmoud Hamza
IT Graduate, Future University of Sudan
GitHub: [ahmedmoh100](https://github.com/ahmedmoh100)
