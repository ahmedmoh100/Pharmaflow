-- Migration: Phase 3 Operational MVP Features
-- 1. Controlled Substances Flag & Register
-- 2. Customer Credit Limits & Accounts Receivable Ledger
-- 3. Granular RBAC Role Expansion

USE pharmaflow;

-- 1. Controlled Substances
ALTER TABLE medicines
ADD COLUMN is_controlled BOOLEAN NOT NULL DEFAULT 0 COMMENT 'Flag for narcotics/restricted drugs requiring dual authorization' AFTER requires_prescription;

CREATE TABLE IF NOT EXISTS controlled_dispense_log (
    id VARCHAR(36) PRIMARY KEY,
    sale_id VARCHAR(36) NOT NULL,
    medicine_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    patient_national_id VARCHAR(32) NOT NULL,
    doctor_license VARCHAR(64) NOT NULL,
    authorizing_user_id VARCHAR(36) NOT NULL,
    dispensed_at DATETIME NOT NULL,
    INDEX idx_cdl_sale (sale_id),
    INDEX idx_cdl_med (medicine_id),
    INDEX idx_cdl_patient (patient_national_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Customer Credit & Accounts Receivable
ALTER TABLE customers
ADD COLUMN credit_limit DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Max allowable outstanding credit' AFTER national_id,
ADD COLUMN current_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Current outstanding balance owed' AFTER credit_limit,
ADD COLUMN is_credit_allowed BOOLEAN NOT NULL DEFAULT 0 COMMENT 'Whether customer is approved for house credit' AFTER current_balance;

CREATE TABLE IF NOT EXISTS customer_ledger (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    transaction_type ENUM('CHARGE', 'PAYMENT', 'ADJUSTMENT', 'REFUND') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    reference_id VARCHAR(64) NULL,
    notes TEXT NULL,
    created_by VARCHAR(36) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_cl_customer (customer_id),
    INDEX idx_cl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. User Roles (admin and pharmacist only)
ALTER TABLE users
MODIFY COLUMN role ENUM('admin', 'pharmacist') NOT NULL DEFAULT 'pharmacist';

-- 4. Expanded Sales Payment Methods (House Credit & Split)
ALTER TABLE sales
MODIFY COLUMN payment_method ENUM('cash', 'card', 'mada', 'transfer', 'insurance', 'wasfaty', 'credit', 'split') NOT NULL DEFAULT 'cash';
