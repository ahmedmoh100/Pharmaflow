-- Migration: Add lead time tracking to suppliers table
-- Date: 2026-08-16
-- Purpose: Enable better purchasing planning and suggested order generation

USE pharmaflow;

-- Add lead time and reliability fields to suppliers table
ALTER TABLE suppliers 
ADD COLUMN lead_time_days INT NOT NULL DEFAULT 7 COMMENT 'Average delivery time in days' AFTER supplier_type,
ADD COLUMN reliability_score DECIMAL(5,2) DEFAULT 100.00 COMMENT 'Supplier reliability score (0-100)' AFTER lead_time_days;

-- Update existing suppliers with default lead times based on supplier type
UPDATE suppliers SET lead_time_days = 5 WHERE supplier_type = 'distributor';
UPDATE suppliers SET lead_time_days = 14 WHERE supplier_type = 'manufacturer';
UPDATE suppliers SET lead_time_days = 3 WHERE supplier_type = 'wholesaler';

-- Create index for queries filtering by reliability
CREATE INDEX idx_suppliers_reliability ON suppliers(reliability_score);

-- Verify the changes
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'suppliers' 
AND TABLE_SCHEMA = 'pharmaflow'
AND COLUMN_NAME IN ('lead_time_days', 'reliability_score');
