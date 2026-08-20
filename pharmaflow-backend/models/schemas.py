"""
Pydantic request/response models.
Money fields are returned as strings to avoid JavaScript float precision issues.
All list responses follow: { items, total, page, page_size }
"""

from typing import Optional, List, Any
from pydantic import BaseModel


# ── Shared ────────────────────────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    page_size: int


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    branch_id: str
    branch_name_en: str = ""
    branch_name_ar: str = ""
    full_name: str


class MeResponse(BaseModel):
    user_id: str
    email: str
    full_name: str
    role: str
    branch_id: str


# ── Medicine ──────────────────────────────────────────────────────────────────

class MedicineResponse(BaseModel):
    id: str
    name_en: str
    name_ar: str
    generic_name: str
    barcode: str
    category: str
    form: str
    strength: str
    unit: str
    selling_price: str          # money as string
    stock_quantity: int
    low_stock_threshold: int
    requires_prescription: bool
    is_controlled: bool = False
    vat_category: str           # zero_rated / standard / exempt
    requires_cold_chain: bool
    sfda_registration_no: str
    max_public_price: str       # money as string
    is_active: bool
    created_at: str
    updated_at: str


class MedicineCreate(BaseModel):
    name_en: str
    name_ar: str
    generic_name: str
    barcode: str
    category: str
    form: str
    strength: str
    unit: str
    selling_price: str
    low_stock_threshold: int = 10
    requires_prescription: bool = False
    is_controlled: bool = False
    vat_category: str = "zero_rated"
    requires_cold_chain: bool = False
    sfda_registration_no: str = ""
    max_public_price: str = "0.000"


class MedicineUpdate(BaseModel):
    name_en: Optional[str] = None
    name_ar: Optional[str] = None
    generic_name: Optional[str] = None
    barcode: Optional[str] = None
    category: Optional[str] = None
    form: Optional[str] = None
    strength: Optional[str] = None
    unit: Optional[str] = None
    selling_price: Optional[str] = None
    low_stock_threshold: Optional[int] = None
    requires_prescription: Optional[bool] = None
    is_controlled: Optional[bool] = None
    vat_category: Optional[str] = None
    requires_cold_chain: Optional[bool] = None
    sfda_registration_no: Optional[str] = None
    max_public_price: Optional[str] = None
    is_active: Optional[bool] = None


# ── Supplier ──────────────────────────────────────────────────────────────────

class SupplierResponse(BaseModel):
    id: str
    name_en: str
    name_ar: str
    tax_number: str
    contact_person: str
    phone: str
    email: str
    address: str
    supplier_type: str          # distributor / manufacturer / wholesaler
    is_active: bool
    created_at: str
    updated_at: str


class SupplierCreate(BaseModel):
    name_en: str
    name_ar: str
    tax_number: str = ""
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    supplier_type: str = "distributor"


class SupplierUpdate(BaseModel):
    name_en: Optional[str] = None
    name_ar: Optional[str] = None
    tax_number: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    supplier_type: Optional[str] = None
    is_active: Optional[bool] = None


# ── Sale ──────────────────────────────────────────────────────────────────────

class SaleItemCreate(BaseModel):
    medicine_id: str
    quantity: int
    unit_price: str             # sent from frontend — validated against DB price


class SaleCreate(BaseModel):
    branch_id: str
    items: List[SaleItemCreate]
    payment_method: str
    notes: str = ""


class SaleItemResponse(BaseModel):
    id: str
    medicine_id: str
    medicine_name_en: str
    medicine_name_ar: str
    quantity: int
    unit_price: str
    vat_rate: str
    vat_amount: str
    cost_at_sale: str


class VatBreakdownItem(BaseModel):
    rate: str
    taxable_amount: str
    vat_amount: str


class SaleResponse(BaseModel):
    id: str
    invoice_number: str
    branch_id: str
    user_id: str
    subtotal_amount: str
    vat_amount: str
    total_amount: str
    vat_breakdown: List[VatBreakdownItem]
    payment_method: str
    notes: str
    sold_at: str
    uuid: str
    icv: int
    items: List[SaleItemResponse]


# ── Return / Credit Note ──────────────────────────────────────────────────────

class ReturnItemCreate(BaseModel):
    sale_item_id: str
    quantity: int
    reason: str = ""


class ReturnCreate(BaseModel):
    sale_id: str
    items: List[ReturnItemCreate]
    reason: str = ""


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardSummary(BaseModel):
    today_sales_count: int
    today_revenue: str
    today_vat: str
    low_stock_count: int
    expiring_soon_count: int     # within 90 days
    expired_count: int
    total_medicines: int
    out_of_stock_count: int
