"""
PharmaFlow ERP/POS Demo — FastAPI Backend
Entry point: registers all routers, configures CORS, validates required env vars on startup.
"""

import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from db.connection import get_db

# Load .env file before anything else
load_dotenv()

from routers import auth, medicines, suppliers, purchases, sales, returns_, dashboard, reports, audit, users, branches, prescriptions, stockcount, sessions, parked, customers, coupons, transfers, purchase_orders, alerts, sfda, insurance, wasfaty, mada

# ── Startup env checks ────────────────────────────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is required — set it in .env")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required — set it in .env")

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="PharmaFlow API",
    version="1.0.0",
    description="Pharmacy chain ERP/POS demo — inventory, sales, returns, audit trail, KSA regulatory compliance",
)

# ── CORS — specific origins only, never wildcard with credentials ─────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router,       prefix="/auth",       tags=["auth"])
app.include_router(medicines.router,  prefix="/medicines",  tags=["medicines"])
app.include_router(suppliers.router,  prefix="/suppliers",  tags=["suppliers"])
app.include_router(purchases.router,  prefix="/purchases",  tags=["purchases"])
app.include_router(sales.router,      prefix="/sales",      tags=["sales"])
app.include_router(returns_.router,   prefix="/returns",    tags=["returns"])
app.include_router(dashboard.router,  prefix="/dashboard",  tags=["dashboard"])
app.include_router(reports.router,    prefix="/reports",    tags=["reports"])
app.include_router(audit.router,      prefix="/audit",      tags=["audit"])
app.include_router(users.router,      prefix="/users",      tags=["users"])
app.include_router(branches.router,   prefix="/branches",   tags=["branches"])
app.include_router(prescriptions.router, prefix="/prescriptions", tags=["prescriptions"])
app.include_router(stockcount.router,    prefix="/stockcount",    tags=["stockcount"])
app.include_router(sessions.router,      prefix="/sessions",      tags=["sessions"])
app.include_router(parked.router,        prefix="/parked",        tags=["parked"])
app.include_router(customers.router,     prefix="/customers",     tags=["customers"])
app.include_router(coupons.router,       prefix="/coupons",       tags=["coupons"])
app.include_router(transfers.router,         prefix="/transfers",         tags=["transfers"])
app.include_router(purchase_orders.router,   prefix="/purchase-orders",   tags=["purchase-orders"])
app.include_router(alerts.router,            prefix="/alerts",            tags=["alerts"])
app.include_router(sfda.router)
app.include_router(insurance.router)
app.include_router(wasfaty.router)
app.include_router(mada.router)


@app.get("/health", tags=["health"])
def health_check(db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute("SELECT 1 AS alive")
        row = cur.fetchone()
    return {
        "status": "ok",
        "service": "pharmaflow-api",
        "database_pool": "connected" if row and row.get("alive") == 1 else "degraded",
    }
