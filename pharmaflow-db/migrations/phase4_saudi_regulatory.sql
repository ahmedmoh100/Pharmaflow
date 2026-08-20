-- Migration: Phase 4 Saudi Regulatory Roadmap & Tier 3 Integrations
-- 1. SFDA RSD Track & Trace and Batch Lifecycle
-- 2. NPHIES / Waseel Insurance Providers, Policies, and Claims
-- 3. Wasfaty e-Prescriptions & OTP Verification
-- 4. Mada POS Terminal Transaction Logs
-- 5. ZATCA Phase 2 Clearance Status & XML Storage

USE pharmaflow;

-- 1. SFDA RSD Track & Trace
CREATE TABLE IF NOT EXISTS sfda_rsd_events (
    id VARCHAR(36) PRIMARY KEY,
    event_type ENUM('DISPATCH', 'ACCEPT', 'DISPENSE', 'RECALL', 'QUARANTINE', 'RELEASE', 'EXPORT') NOT NULL,
    gtin VARCHAR(14) NOT NULL,
    batch_number VARCHAR(64) NOT NULL,
    serial_number VARCHAR(64) NULL,
    quantity INT NOT NULL DEFAULT 1,
    from_gln VARCHAR(13) NULL COMMENT 'Global Location Number of sender',
    to_gln VARCHAR(13) NULL COMMENT 'Global Location Number of receiver',
    status ENUM('LOGGED', 'TRANSMITTED', 'CONFIRMED', 'FAILED') NOT NULL DEFAULT 'LOGGED',
    response_code VARCHAR(32) NULL,
    notes TEXT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_sre_gtin (gtin),
    INDEX idx_sre_batch (batch_number),
    INDEX idx_sre_event (event_type),
    INDEX idx_sre_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE batches
ADD COLUMN sfda_status ENUM('active', 'quarantined', 'recalled', 'expired') NOT NULL DEFAULT 'active' AFTER status;

-- 2. NPHIES / Waseel Insurance
CREATE TABLE IF NOT EXISTS insurance_providers (
    id VARCHAR(36) PRIMARY KEY,
    name_en VARCHAR(128) NOT NULL,
    name_ar VARCHAR(128) NOT NULL,
    nphies_payer_id VARCHAR(64) NOT NULL UNIQUE,
    contact_email VARCHAR(128) NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS patient_insurance_policies (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    provider_id VARCHAR(36) NOT NULL,
    policy_number VARCHAR(64) NOT NULL,
    member_id VARCHAR(64) NOT NULL,
    copay_percent DECIMAL(5,2) NOT NULL DEFAULT 20.00 COMMENT 'Patient copay percentage (e.g. 20.00%)',
    max_copay_amount DECIMAL(10,2) NOT NULL DEFAULT 50.00 COMMENT 'Max patient copay cap in SAR (e.g. 50.00 SAR)',
    deductible_remaining DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    valid_until DATE NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_pip_cust (customer_id),
    INDEX idx_pip_prov (provider_id),
    INDEX idx_pip_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS insurance_claims (
    id VARCHAR(36) PRIMARY KEY,
    sale_id VARCHAR(36) NOT NULL,
    policy_id VARCHAR(36) NOT NULL,
    total_claim_amount DECIMAL(10,2) NOT NULL,
    patient_share_amount DECIMAL(10,2) NOT NULL,
    insurance_share_amount DECIMAL(10,2) NOT NULL,
    status ENUM('SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
    pre_auth_code VARCHAR(64) NULL,
    rejection_reason TEXT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_ic_sale (sale_id),
    INDEX idx_ic_policy (policy_id),
    INDEX idx_ic_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Wasfaty e-Prescriptions
CREATE TABLE IF NOT EXISTS wasfaty_prescriptions (
    id VARCHAR(36) PRIMARY KEY,
    wasfaty_rx_id VARCHAR(64) NOT NULL UNIQUE,
    patient_national_id VARCHAR(32) NOT NULL,
    patient_name VARCHAR(128) NOT NULL,
    patient_phone VARCHAR(32) NOT NULL,
    doctor_name VARCHAR(128) NOT NULL,
    doctor_license VARCHAR(64) NOT NULL,
    items_json JSON NOT NULL,
    status ENUM('PENDING', 'OTP_VERIFIED', 'DISPENSED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    otp_code VARCHAR(8) NULL,
    otp_verified BOOLEAN NOT NULL DEFAULT 0,
    dispensed_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_wp_rx (wasfaty_rx_id),
    INDEX idx_wp_patient (patient_national_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Mada POS Terminal Logs
CREATE TABLE IF NOT EXISTS mada_terminal_logs (
    id VARCHAR(36) PRIMARY KEY,
    sale_id VARCHAR(36) NULL,
    terminal_id VARCHAR(32) NOT NULL,
    stan VARCHAR(16) NOT NULL COMMENT 'Systems Trace Audit Number',
    auth_code VARCHAR(16) NOT NULL COMMENT 'Bank Approval Code',
    card_scheme VARCHAR(32) NOT NULL DEFAULT 'MADA' COMMENT 'MADA, VISA, MASTERCARD',
    masked_pan VARCHAR(24) NULL,
    amount DECIMAL(10,2) NOT NULL,
    status ENUM('INITIATED', 'APPROVED', 'DECLINED', 'REVERSED', 'TIMEOUT') NOT NULL,
    response_payload JSON NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_mtl_sale (sale_id),
    INDEX idx_mtl_stan (stan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. ZATCA Phase 2 Clearance Metadata
ALTER TABLE sales
ADD COLUMN zatca_status ENUM('PENDING', 'CLEARED', 'REPORTED', 'REJECTED') NOT NULL DEFAULT 'PENDING' AFTER session_id,
ADD COLUMN zatca_hash VARCHAR(64) NULL AFTER zatca_status,
ADD COLUMN zatca_xml LONGTEXT NULL AFTER zatca_hash;
