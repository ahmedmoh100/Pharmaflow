-- ============================================================
-- PharmaFlow ERP/POS Demo — Database Schema
-- Engine: MySQL (MariaDB 10.4+)
-- Encoding: utf8mb4
-- Money: DECIMAL(12,3) — never FLOAT
-- Stock source of truth: stock_movements ledger (append-only)
-- stock_quantity on medicines = materialized cache only
-- Costing: FIFO (by expiry_date ASC, skip expired/written-off batches)
-- ============================================================

CREATE DATABASE IF NOT EXISTS pharmaflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pharmaflow;

-- ── Branches ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    code        VARCHAR(10)  NOT NULL UNIQUE,
    name_en     VARCHAR(120) NOT NULL,
    name_ar     VARCHAR(120) NOT NULL,
    city_en     VARCHAR(60)  NOT NULL,
    city_ar     VARCHAR(60)  NOT NULL,
    vat_number  VARCHAR(20)  NOT NULL DEFAULT '',
    address     TEXT         NOT NULL DEFAULT '',
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    branch_id       VARCHAR(36)  NOT NULL,
    email           VARCHAR(120) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,          -- bcrypt, never plaintext
    full_name       VARCHAR(120) NOT NULL,
    phone           VARCHAR(20)  NOT NULL DEFAULT '',
    role            ENUM('admin','pharmacist') NOT NULL DEFAULT 'pharmacist',
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    last_login_at   DATETIME     NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- ── Suppliers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    name_en         VARCHAR(120) NOT NULL,
    name_ar         VARCHAR(120) NOT NULL,
    tax_number      VARCHAR(20)  NOT NULL DEFAULT '',
    contact_person  VARCHAR(120) NOT NULL DEFAULT '',
    phone           VARCHAR(20)  NOT NULL DEFAULT '',
    email           VARCHAR(120) NOT NULL DEFAULT '',
    address         TEXT         NOT NULL DEFAULT '',
    -- retail pharmacies buy from distributors, not manufacturers directly
    supplier_type   ENUM('distributor','manufacturer','wholesaler') NOT NULL DEFAULT 'distributor',
    lead_time_days      INT            NOT NULL DEFAULT 0,
    reliability_score   DECIMAL(3,2)   NOT NULL DEFAULT 0.00,
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Medicines / Products ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicines (
    id                      VARCHAR(36)    NOT NULL PRIMARY KEY,
    name_en                 VARCHAR(200)   NOT NULL,
    name_ar                 VARCHAR(200)   NOT NULL,
    generic_name            VARCHAR(200)   NOT NULL DEFAULT '',
    barcode                 VARCHAR(50)    NOT NULL DEFAULT '',
    category                VARCHAR(60)    NOT NULL DEFAULT '',
    form                    VARCHAR(60)    NOT NULL DEFAULT '',   -- tablet, syrup, injection...
    strength                VARCHAR(60)    NOT NULL DEFAULT '',   -- 500mg, 10ml...
    unit                    VARCHAR(20)    NOT NULL DEFAULT '',   -- box, bottle, vial...
    selling_price           DECIMAL(12,3)  NOT NULL DEFAULT 0.000,
    -- materialized cache — source of truth is stock_movements ledger
    stock_quantity          INT            NOT NULL DEFAULT 0,
    low_stock_threshold     INT            NOT NULL DEFAULT 10,
    requires_prescription   TINYINT(1)     NOT NULL DEFAULT 0,
    is_controlled           TINYINT(1)     NOT NULL DEFAULT 0,
    control_schedule        VARCHAR(20)    NOT NULL DEFAULT '',
    -- zero_rated: qualifying medicines (0% VAT per MOH list)
    -- standard: cosmetics, devices, baby, supplements (15%)
    -- exempt: specific exempted items
    vat_category            ENUM('zero_rated','standard','exempt') NOT NULL DEFAULT 'zero_rated',
    requires_cold_chain     TINYINT(1)     NOT NULL DEFAULT 0,
    sfda_registration_no    VARCHAR(30)    NOT NULL DEFAULT '',
    max_public_price        DECIMAL(12,3)  NOT NULL DEFAULT 0.000,  -- MOH maximum retail price
    is_active               TINYINT(1)     NOT NULL DEFAULT 1,
    created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_medicines_barcode   (barcode),
    INDEX idx_medicines_category  (category),
    INDEX idx_medicines_active    (is_active)
);

-- ── Batches ───────────────────────────────────────────────────────────────────
-- One row per physical batch received. FIFO deduction uses expiry_date ASC.
CREATE TABLE IF NOT EXISTS batches (
    id                  VARCHAR(36)   NOT NULL PRIMARY KEY,
    medicine_id         VARCHAR(36)   NOT NULL,
    branch_id           VARCHAR(36)   NOT NULL,
    supplier_id         VARCHAR(36)   NULL,
    batch_number        VARCHAR(60)   NOT NULL,
    expiry_date         DATE          NOT NULL,
    manufacturing_date  DATE          NULL,
    qty_received        INT           NOT NULL DEFAULT 0,
    -- qty_remaining is also a cache — derive from stock_movements if needed
    qty_remaining       INT           NOT NULL DEFAULT 0,
    unit_cost           DECIMAL(12,3) NOT NULL DEFAULT 0.000,  -- cost per unit at receipt
    status              ENUM('active','expired','written_off') NOT NULL DEFAULT 'active',
    sfda_status         ENUM('active','quarantined','recalled','expired') NOT NULL DEFAULT 'active',
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_batches_medicine  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
    CONSTRAINT fk_batches_branch    FOREIGN KEY (branch_id)   REFERENCES branches(id),
    INDEX idx_batches_medicine_expiry (medicine_id, expiry_date),  -- FIFO query index
    INDEX idx_batches_branch          (branch_id),
    INDEX idx_batches_status          (status)
);

-- ── Stock Movements (append-only ledger) ─────────────────────────────────────
-- Never UPDATE or DELETE rows in this table.
-- movement_type drives what happened: IN/OUT/ADJUST/RETURN/WRITE_OFF
CREATE TABLE IF NOT EXISTS stock_movements (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    medicine_id     VARCHAR(36)  NOT NULL,
    branch_id       VARCHAR(36)  NOT NULL,
    batch_id        VARCHAR(36)  NULL,             -- NULL for adjustments not tied to a batch
    -- signed delta: positive = stock increases, negative = stock decreases
    qty_delta       INT          NOT NULL,
    movement_type   ENUM('IN','OUT','ADJUST','RETURN','WRITE_OFF') NOT NULL,
    reference_id    VARCHAR(36)  NULL,             -- sale_id, return_id, purchase_id, etc.
    reference_type  VARCHAR(30)  NULL,             -- 'sale', 'return', 'purchase', 'adjustment'
    reason          TEXT         NOT NULL DEFAULT '',
    created_by      VARCHAR(36)  NOT NULL,         -- user_id
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_movements_medicine  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
    CONSTRAINT fk_movements_branch    FOREIGN KEY (branch_id)   REFERENCES branches(id),
    INDEX idx_movements_medicine   (medicine_id),
    INDEX idx_movements_reference  (reference_id),
    INDEX idx_movements_created_at (created_at)
);

-- ── Invoice Sequence (concurrency-safe ICV per branch per year) ───────────────
-- SELECT ... FOR UPDATE on this row before issuing an invoice.
-- ICV = Invoice Counter Value — ZATCA requires gapless sequential numbering.
CREATE TABLE IF NOT EXISTS invoice_sequences (
    branch_id   VARCHAR(36) NOT NULL,
    year        SMALLINT    NOT NULL,
    last_icv    INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (branch_id, year),
    CONSTRAINT fk_seq_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- ── Sales ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
    id              VARCHAR(36)    NOT NULL PRIMARY KEY,
    branch_id       VARCHAR(36)    NOT NULL,
    user_id         VARCHAR(36)    NOT NULL,        -- pharmacist who processed the sale
    invoice_number  VARCHAR(30)    NOT NULL UNIQUE, -- human-readable: BR001-2026-000001
    uuid            VARCHAR(36)    NOT NULL UNIQUE, -- for ZATCA QR and credit note reference
    icv             INT            NOT NULL,        -- gapless sequential per branch per year
    subtotal_amount DECIMAL(12,3)  NOT NULL DEFAULT 0.000,
    vat_amount      DECIMAL(12,3)  NOT NULL DEFAULT 0.000,
    total_amount    DECIMAL(12,3)  NOT NULL DEFAULT 0.000,
    -- vat_breakdown stored as JSON: [{rate, taxable_amount, vat_amount}, ...]
    vat_breakdown   JSON           NULL,
    payment_method  ENUM('cash','card','mada','transfer','insurance','wasfaty','credit') NOT NULL DEFAULT 'cash',
    -- split payment: [{method, amount}] — NULL for single-method sales (backward compat)
    payment_lines   JSON           NULL,
    notes           TEXT           NOT NULL DEFAULT '',
    session_id      VARCHAR(36)    NULL DEFAULT NULL,
    customer_id     VARCHAR(36)    NULL DEFAULT NULL,
    customer_name   VARCHAR(120)   NOT NULL DEFAULT '',
    coupon_id       VARCHAR(36)    NULL DEFAULT NULL,
    zatca_status    VARCHAR(20)    NOT NULL DEFAULT 'pending',
    zatca_xml       TEXT           NULL,
    zatca_hash      VARCHAR(64)    NOT NULL DEFAULT '',
    sold_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sales_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
    CONSTRAINT fk_sales_user   FOREIGN KEY (user_id)   REFERENCES users(id),
    INDEX idx_sales_branch     (branch_id),
    INDEX idx_sales_sold_at    (sold_at),
    INDEX idx_sales_user       (user_id)
);

-- ── Sale Items ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sale_items (
    id              VARCHAR(36)   NOT NULL PRIMARY KEY,
    sale_id         VARCHAR(36)   NOT NULL,
    medicine_id     VARCHAR(36)   NOT NULL,
    batch_id        VARCHAR(36)   NOT NULL,         -- which batch was deducted (FIFO)
    quantity        INT           NOT NULL,
    unit_price      DECIMAL(12,3) NOT NULL,
    vat_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0.00,   -- 0.00 or 15.00
    vat_amount      DECIMAL(12,3) NOT NULL DEFAULT 0.000,  -- per line, not per sale
    -- snapshot cost at time of sale — immutable, enables historical margin
    cost_at_sale    DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    CONSTRAINT fk_sale_items_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
    CONSTRAINT fk_sale_items_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id),
    CONSTRAINT fk_sale_items_batch    FOREIGN KEY (batch_id)    REFERENCES batches(id)
);

-- ── Sale Returns ──────────────────────────────────────────────────────────────
-- A return is NOT a negative sale. It is a separate document referencing the original.
-- ZATCA requires a CreditNote document type, not a negated invoice.
CREATE TABLE IF NOT EXISTS sale_returns (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    sale_id         VARCHAR(36)  NOT NULL,          -- original sale
    branch_id       VARCHAR(36)  NOT NULL,
    processed_by    VARCHAR(36)  NOT NULL,           -- user_id (manager role required)
    reason          TEXT         NOT NULL DEFAULT '',
    total_refund    DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_returns_sale   FOREIGN KEY (sale_id)   REFERENCES sales(id),
    CONSTRAINT fk_returns_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS sale_return_items (
    id              VARCHAR(36)   NOT NULL PRIMARY KEY,
    return_id       VARCHAR(36)   NOT NULL,
    sale_item_id    VARCHAR(36)   NOT NULL,
    quantity        INT           NOT NULL,
    -- can this batch go back on the shelf? (no for opened/controlled items)
    restockable     TINYINT(1)    NOT NULL DEFAULT 1,
    reason          TEXT          NOT NULL DEFAULT '',
    CONSTRAINT fk_return_items_return    FOREIGN KEY (return_id)    REFERENCES sale_returns(id),
    CONSTRAINT fk_return_items_sale_item FOREIGN KEY (sale_item_id) REFERENCES sale_items(id)
);

-- ── Credit Notes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_notes (
    id                      VARCHAR(36)   NOT NULL PRIMARY KEY,
    return_id               VARCHAR(36)   NOT NULL UNIQUE,
    original_invoice_uuid   VARCHAR(36)   NOT NULL,   -- ZATCA: must reference original
    credit_note_number      VARCHAR(30)   NOT NULL UNIQUE,
    amount                  DECIMAL(12,3) NOT NULL,
    created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cn_return FOREIGN KEY (return_id) REFERENCES sale_returns(id)
);

-- ── Audit Log ─────────────────────────────────────────────────────────────────
-- Every meaningful action: sale, stock change, user edit, price change.
CREATE TABLE IF NOT EXISTS audit_log (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    user_id     VARCHAR(36)  NOT NULL,
    branch_id   VARCHAR(36)  NOT NULL,
    entity      VARCHAR(40)  NOT NULL,   -- 'sale', 'medicine', 'user', 'batch' ...
    entity_id   VARCHAR(36)  NULL,
    action      VARCHAR(20)  NOT NULL,   -- CREATE, UPDATE, DELETE, LOGIN ...
    before_json JSON         NULL,
    after_json  JSON         NULL,
    ip          VARCHAR(45)  NOT NULL DEFAULT '',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_entity    (entity, entity_id),
    INDEX idx_audit_user      (user_id),
    INDEX idx_audit_created   (created_at)
);

-- ── Coupons (Employee Discount + Promotional) ────────────────────────────
-- type: 'employee' (staff discount) or 'promotional' (time-limited, marketing)
-- discount_type: 'percentage' (0-100) or 'fixed' (SAR amount)
-- applies_to: 'all_items', 'category', 'medicine' (for future use)
-- valid_from/valid_until: NULL = always valid, otherwise date-based
-- max_uses: NULL = unlimited, otherwise cap redemptions
-- active: can disable a coupon without deleting it
CREATE TABLE IF NOT EXISTS coupons (
    id              VARCHAR(36)   NOT NULL PRIMARY KEY,
    code            VARCHAR(30)   NOT NULL UNIQUE,   -- e.g. "EMP10", "SUMMER50", "ANTIBIOTIC15"
    type            ENUM('employee','promotional') NOT NULL,
    discount_type   ENUM('percentage','fixed') NOT NULL,
    discount_value  DECIMAL(12,3) NOT NULL,          -- either % (0-100) or SAR amount
    description_en  VARCHAR(200)  NOT NULL DEFAULT '',
    description_ar  VARCHAR(200)  NOT NULL DEFAULT '',
    applies_to      ENUM('all_items','category','medicine') NOT NULL DEFAULT 'all_items',
    applies_to_id   VARCHAR(36)   NULL,               -- category code or medicine id (if category/medicine)
    valid_from      DATE          NULL,               -- NULL = valid immediately
    valid_until     DATE          NULL,               -- NULL = no expiry
    max_uses        INT           NULL,               -- NULL = unlimited
    usage_count     INT           NOT NULL DEFAULT 0, -- current redemptions
    is_active       TINYINT(1)    NOT NULL DEFAULT 1,
    created_by      VARCHAR(36)   NOT NULL,          -- admin user_id
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_coupon_code     (code),
    INDEX idx_coupon_type     (type),
    INDEX idx_coupon_active   (is_active),
    INDEX idx_coupon_dates    (valid_from, valid_until)
);

-- ── Coupon Usage Log (audit trail) ────────────────────────────────────────
-- Track which sales redeemed which coupons (for analytics + fraud detection)
CREATE TABLE IF NOT EXISTS coupon_usage (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    coupon_id       VARCHAR(36)  NOT NULL,
    sale_id         VARCHAR(36)  NOT NULL,
    discount_amount DECIMAL(12,3) NOT NULL,         -- actual amount deducted
    used_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usage_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id),
    CONSTRAINT fk_usage_sale   FOREIGN KEY (sale_id)   REFERENCES sales(id),
    INDEX idx_usage_coupon (coupon_id),
    INDEX idx_usage_sale   (sale_id)
);

-- ── Idempotency Keys (prevents duplicate POS submissions) ────────────────────
-- TTL: 24 hours. Frontend generates a UUID before POSTing a sale.
-- If the same key arrives twice, return the cached response.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key_value       VARCHAR(36)  NOT NULL PRIMARY KEY,
    response_json   JSON         NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_idem_created (created_at)   -- for TTL cleanup job
);

-- ── Prescriptions ─────────────────────────────────────────────────────────────
-- One row per paper or electronic prescription received at the branch.
-- Dispensing creates a real sale — prescription_id stored on the sale for traceability.
CREATE TABLE IF NOT EXISTS prescriptions (
    id                  VARCHAR(36)   NOT NULL PRIMARY KEY,
    branch_id           VARCHAR(36)   NOT NULL,
    rx_number           VARCHAR(30)   NOT NULL UNIQUE,   -- e.g. RX-2026-000001
    patient_name        VARCHAR(120)  NOT NULL,
    patient_id_number   VARCHAR(30)   NOT NULL DEFAULT '', -- Saudi national ID or Iqama
    prescriber_name     VARCHAR(120)  NOT NULL,
    prescriber_license  VARCHAR(30)   NOT NULL DEFAULT '',
    -- PENDING: received, not dispensed yet
    -- DISPENSED: sale created, stock deducted
    -- CANCELLED: voided before dispensing
    -- PARTIAL: some items dispensed, others unavailable (future)
    status              ENUM('PENDING','DISPENSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    notes               TEXT          NOT NULL DEFAULT '',
    sale_id             VARCHAR(36)   NULL,          -- set when dispensed
    dispensed_by        VARCHAR(36)   NULL,          -- user_id who dispensed
    dispensed_at        DATETIME      NULL,
    created_by          VARCHAR(36)   NOT NULL,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_rx_branch     FOREIGN KEY (branch_id)    REFERENCES branches(id),
    CONSTRAINT fk_rx_sale       FOREIGN KEY (sale_id)      REFERENCES sales(id),
    CONSTRAINT fk_rx_dispensed  FOREIGN KEY (dispensed_by) REFERENCES users(id),
    CONSTRAINT fk_rx_created    FOREIGN KEY (created_by)   REFERENCES users(id),
    INDEX idx_rx_branch  (branch_id),
    INDEX idx_rx_status  (status),
    INDEX idx_rx_created (created_at)
);

-- ── Prescription Items ────────────────────────────────────────────────────────
-- One row per medicine on the prescription.
CREATE TABLE IF NOT EXISTS prescription_items (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    prescription_id VARCHAR(36)  NOT NULL,
    medicine_id     VARCHAR(36)  NOT NULL,
    quantity        INT          NOT NULL DEFAULT 1,
    dosage_instructions TEXT     NOT NULL DEFAULT '',  -- e.g. "1 tab twice daily for 7 days"
    CONSTRAINT fk_rx_items_rx       FOREIGN KEY (prescription_id) REFERENCES prescriptions(id),
    CONSTRAINT fk_rx_items_medicine FOREIGN KEY (medicine_id)     REFERENCES medicines(id)
);

-- ── Customers ─────────────────────────────────────────────────────────────────
-- Walk-in customer records. Optional — sales can proceed without a customer.
-- Attached to a sale for receipt personalisation and audit trail.
CREATE TABLE IF NOT EXISTS customers (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    name_ar     VARCHAR(120) NOT NULL,
    name_en     VARCHAR(120) NOT NULL DEFAULT '',
    phone       VARCHAR(20)  NOT NULL DEFAULT '',
    national_id VARCHAR(20)  NOT NULL DEFAULT '',
    notes       TEXT         NOT NULL DEFAULT '',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_credit_allowed   TINYINT(1)   NOT NULL DEFAULT 0,
    credit_limit        DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    current_balance     DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    INDEX idx_customers_phone (phone),
    INDEX idx_customers_nid   (national_id)
);

-- ── Tender Declarations ──────────────────────────────────────────────────────
-- Mid-shift cash count snapshots. Pharmacist declares actual cash in drawer.
-- expected_cash = opening_float + SUM(cash sales in this session)
-- difference = declared - expected (positive = overage, negative = shortage)
CREATE TABLE IF NOT EXISTS tender_declarations (
    id              VARCHAR(36)    NOT NULL PRIMARY KEY,
    session_id      VARCHAR(36)    NOT NULL,
    user_id         VARCHAR(36)    NOT NULL,
    branch_id       VARCHAR(36)    NOT NULL,
    declared_cash   DECIMAL(12,3)  NOT NULL,
    expected_cash   DECIMAL(12,3)  NOT NULL,
    difference      DECIMAL(12,3)  NOT NULL,
    notes           VARCHAR(255)   NOT NULL DEFAULT '',
    declared_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES cash_sessions(id),
    FOREIGN KEY (user_id)    REFERENCES users(id),
    INDEX idx_tender_session (session_id)
);

-- ── Parked Transactions ──────────────────────────────────────────────────────
-- Saved mid-transaction carts (Hold / Suspend).
-- cart_json: [{medicine_id, name_en, name_ar, quantity, unit_price, vat_rate, batch_id, discount_pct, line_comment}]
-- Recalled via "Recall transaction" tile on POS home.
CREATE TABLE IF NOT EXISTS parked_transactions (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    session_id  VARCHAR(36)  NULL,
    user_id     VARCHAR(36)  NOT NULL,
    branch_id   VARCHAR(36)  NOT NULL,
    cart_json   JSON         NOT NULL,
    parked_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status      ENUM('PARKED','RECALLED','VOIDED') NOT NULL DEFAULT 'PARKED',
    FOREIGN KEY (user_id)   REFERENCES users(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    INDEX idx_parked_user_branch (user_id, branch_id, status)
);

-- ── CashSessions ──────────────────────────────────────────────────────────────
-- One shift per pharmacist per day (user + branch + date).
-- Opened manually by pharmacist via "Declare start amount" tile (float entered).
-- status: OPEN → ON_BREAK → OPEN → CLOSED
-- break_minutes: total accumulated break time in minutes (updated on each break end).
-- total_sales, total_revenue, total_vat populated on close from sales ledger.
CREATE TABLE IF NOT EXISTS cash_sessions (
    id                VARCHAR(36)    NOT NULL PRIMARY KEY,
    user_id           VARCHAR(36)    NOT NULL,
    branch_id         VARCHAR(36)    NOT NULL,
    opening_float     DECIMAL(12,3)  NOT NULL DEFAULT 0.000,  -- cash in drawer at start
    status            ENUM('OPEN','ON_BREAK','CLOSED') NOT NULL DEFAULT 'OPEN',
    break_minutes     INT            NOT NULL DEFAULT 0,       -- total break time
    opened_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at         DATETIME       NULL,
    total_sales       INT            NOT NULL DEFAULT 0,
    total_revenue     DECIMAL(12,3)  NOT NULL DEFAULT 0,
    total_vat         DECIMAL(12,3)  NOT NULL DEFAULT 0,
    payment_breakdown JSON           NULL,    -- {cash: X, mada: X, ...} populated on close
    FOREIGN KEY (user_id)   REFERENCES users(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- ── Session Breaks ────────────────────────────────────────────────────────────
-- One row per break within a shift. ended_at NULL = currently on break.
CREATE TABLE IF NOT EXISTS session_breaks (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    session_id  VARCHAR(36)  NOT NULL,
    started_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at    DATETIME     NULL,
    reason      VARCHAR(120) NOT NULL DEFAULT '',
    FOREIGN KEY (session_id) REFERENCES cash_sessions(id),
    INDEX idx_breaks_session (session_id)
);

-- Add session_id to sales (nullable — pre-CashSession sales have NULL)
-- ALTER TABLE sales ADD COLUMN session_id VARCHAR(36) NULL DEFAULT NULL;
-- (run once on existing DB — already applied 2026-08-13)

-- ── Controlled Dispense Log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS controlled_dispense_log (
    id                   VARCHAR(36)  NOT NULL PRIMARY KEY,
    sale_id              VARCHAR(36)  NOT NULL,
    medicine_id          VARCHAR(36)  NOT NULL,
    batch_id             VARCHAR(36)  NOT NULL,
    quantity             INT          NOT NULL,
    patient_national_id  VARCHAR(32)  NOT NULL,
    doctor_license       VARCHAR(64)  NOT NULL,
    authorizing_user_id  VARCHAR(36)  NOT NULL,
    dispensed_at         DATETIME     NOT NULL,
    INDEX idx_cdl_sale    (sale_id),
    INDEX idx_cdl_med     (medicine_id),
    INDEX idx_cdl_patient (patient_national_id)
);

-- ── Customer Ledger ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_ledger (
    id                VARCHAR(36)    NOT NULL PRIMARY KEY,
    customer_id       VARCHAR(36)    NOT NULL,
    transaction_type  ENUM('CHARGE','PAYMENT','ADJUSTMENT','REFUND') NOT NULL,
    amount            DECIMAL(10,2)  NOT NULL,
    balance_after     DECIMAL(10,2)  NOT NULL,
    reference_id      VARCHAR(64)    NULL DEFAULT NULL,
    notes             TEXT           NULL,
    created_by        VARCHAR(36)    NOT NULL,
    created_at        DATETIME       NOT NULL,
    INDEX idx_cl_customer (customer_id),
    INDEX idx_cl_created  (created_at)
);

-- ── Purchase Orders ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
    id            VARCHAR(36)   NOT NULL PRIMARY KEY,
    supplier_id   VARCHAR(36)   NOT NULL,
    branch_id     VARCHAR(36)   NOT NULL,
    status        ENUM('DRAFT','SENT','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    expected_date DATE          NULL DEFAULT NULL,
    notes         VARCHAR(500)  NOT NULL DEFAULT '',
    created_by    VARCHAR(36)   NOT NULL,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (branch_id)   REFERENCES branches(id),
    FOREIGN KEY (created_by)  REFERENCES users(id),
    INDEX idx_po_supplier (supplier_id),
    INDEX idx_po_branch   (branch_id),
    INDEX idx_po_status   (status)
);

-- ── Purchase Order Items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                VARCHAR(36)    NOT NULL PRIMARY KEY,
    po_id             VARCHAR(36)    NOT NULL,
    medicine_id       VARCHAR(36)    NOT NULL,
    ordered_qty       INT            NOT NULL,
    agreed_unit_cost  DECIMAL(12,3)  NOT NULL DEFAULT 0.000,
    FOREIGN KEY (po_id)        REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_id)  REFERENCES medicines(id),
    INDEX idx_poi_po       (po_id),
    INDEX idx_poi_medicine (medicine_id)
);

-- ── Transfers ────────────────────────────────────────────────────────────────
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
);

-- ── Insurance Providers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_providers (
    id               VARCHAR(36)   NOT NULL PRIMARY KEY,
    name_en          VARCHAR(128)  NOT NULL,
    name_ar          VARCHAR(128)  NOT NULL,
    nphies_payer_id  VARCHAR(64)   NOT NULL,
    contact_email    VARCHAR(128)  NULL DEFAULT NULL,
    is_active        TINYINT(1)    NOT NULL DEFAULT 1,
    created_at       DATETIME      NOT NULL,
    UNIQUE KEY (nphies_payer_id)
);

-- ── Patient Insurance Policies ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_insurance_policies (
    id                    VARCHAR(36)    NOT NULL PRIMARY KEY,
    customer_id           VARCHAR(36)    NOT NULL,
    provider_id           VARCHAR(36)    NOT NULL,
    policy_number         VARCHAR(64)    NOT NULL,
    member_id             VARCHAR(64)    NOT NULL,
    copay_percent         DECIMAL(5,2)   NOT NULL DEFAULT 20.00,
    max_copay_amount      DECIMAL(10,2)  NOT NULL DEFAULT 50.00,
    deductible_remaining  DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    is_active             TINYINT(1)     NOT NULL DEFAULT 1,
    valid_until           DATE           NOT NULL,
    created_at            DATETIME       NOT NULL,
    INDEX idx_pip_cust   (customer_id),
    INDEX idx_pip_prov   (provider_id),
    INDEX idx_pip_member (member_id)
);

-- ── Insurance Claims ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_claims (
    id                      VARCHAR(36)    NOT NULL PRIMARY KEY,
    sale_id                 VARCHAR(36)    NOT NULL,
    policy_id               VARCHAR(36)    NOT NULL,
    total_claim_amount      DECIMAL(10,2)  NOT NULL,
    patient_share_amount    DECIMAL(10,2)  NOT NULL,
    insurance_share_amount  DECIMAL(10,2)  NOT NULL,
    status                  ENUM('SUBMITTED','APPROVED','PARTIALLY_APPROVED','REJECTED') NOT NULL DEFAULT 'SUBMITTED',
    pre_auth_code           VARCHAR(64)    NULL DEFAULT NULL,
    rejection_reason        TEXT           NULL,
    created_at              DATETIME       NOT NULL,
    INDEX idx_ic_sale   (sale_id),
    INDEX idx_ic_policy (policy_id),
    INDEX idx_ic_status (status)
);

-- ── Wasfaty Prescriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wasfaty_prescriptions (
    id                   VARCHAR(36)   NOT NULL PRIMARY KEY,
    wasfaty_rx_id        VARCHAR(64)   NOT NULL,
    patient_national_id  VARCHAR(32)   NOT NULL,
    patient_name         VARCHAR(128)  NOT NULL,
    patient_phone        VARCHAR(32)   NOT NULL,
    doctor_name          VARCHAR(128)  NOT NULL,
    doctor_license       VARCHAR(64)   NOT NULL,
    items_json           LONGTEXT      NOT NULL,
    status               ENUM('PENDING','OTP_VERIFIED','DISPENSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    otp_code             VARCHAR(8)    NULL DEFAULT NULL,
    otp_verified         TINYINT(1)    NOT NULL DEFAULT 0,
    dispensed_at         DATETIME      NULL DEFAULT NULL,
    created_at           DATETIME      NOT NULL,
    UNIQUE KEY (wasfaty_rx_id),
    INDEX idx_wp_rx      (wasfaty_rx_id),
    INDEX idx_wp_patient (patient_national_id)
);

-- ── SFDA RSD Events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sfda_rsd_events (
    id             VARCHAR(36)   NOT NULL PRIMARY KEY,
    event_type     ENUM('DISPATCH','ACCEPT','DISPENSE','RECALL','QUARANTINE','RELEASE','EXPORT') NOT NULL,
    gtin           VARCHAR(14)   NOT NULL,
    batch_number   VARCHAR(64)   NOT NULL,
    serial_number  VARCHAR(64)   NULL DEFAULT NULL,
    quantity       INT           NOT NULL DEFAULT 1,
    from_gln       VARCHAR(13)   NULL DEFAULT NULL,
    to_gln         VARCHAR(13)   NULL DEFAULT NULL,
    status         ENUM('LOGGED','TRANSMITTED','CONFIRMED','FAILED') NOT NULL DEFAULT 'LOGGED',
    response_code  VARCHAR(32)   NULL DEFAULT NULL,
    notes          TEXT          NULL,
    created_at     DATETIME      NOT NULL,
    INDEX idx_sre_gtin    (gtin),
    INDEX idx_sre_batch   (batch_number),
    INDEX idx_sre_event   (event_type),
    INDEX idx_sre_created (created_at)
);

-- ── MADA Terminal Logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mada_terminal_logs (
    id               VARCHAR(36)    NOT NULL PRIMARY KEY,
    sale_id          VARCHAR(36)    NULL DEFAULT NULL,
    terminal_id      VARCHAR(32)    NOT NULL,
    stan             VARCHAR(16)    NOT NULL,
    auth_code        VARCHAR(16)    NOT NULL,
    card_scheme      VARCHAR(32)    NOT NULL DEFAULT 'MADA',
    masked_pan       VARCHAR(24)    NULL DEFAULT NULL,
    amount           DECIMAL(10,2)  NOT NULL,
    status           ENUM('INITIATED','APPROVED','DECLINED','REVERSED','TIMEOUT') NOT NULL,
    response_payload LONGTEXT       NULL,
    created_at       DATETIME       NOT NULL,
    INDEX idx_mtl_sale (sale_id),
    INDEX idx_mtl_stan (stan)
);
