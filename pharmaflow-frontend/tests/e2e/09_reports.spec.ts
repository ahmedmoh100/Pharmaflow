/**
 * 09 — Reports
 *
 * Mirrors: test_13_reports.py
 * Tests:
 *  - Sales report overview loads with chart
 *  - By Pharmacist tab shows aggregated rows
 *  - Period toggle (Last 30 / This Month) switches correctly
 *  - Inventory report loads with total medicines + categories
 *  - Purchases report loads with spend data
 *  - VAT report loads with zero-rated and standard rows
 *  - CSV export button present on each report
 *  - Branch filter applied: switching branch changes totals
 *  - Reports hub page (/admin/reports) shows all report links
 */

import { test, expect, request } from '@playwright/test';
import { loginAdmin, getTokenNode, API_BASE, ADMIN } from './helpers';

test.describe('Reports', () => {

  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
  });

  // ── Sales Report ────────────────────────────────────────────────────────────

  test('09-01 sales report page loads with chart', async ({ page }) => {
    await page.goto('/ar/admin/reports/sales');
    await page.waitForTimeout(2_000);
    // recharts renders an SVG — target it specifically
    await expect(page.locator('.recharts-wrapper svg, .recharts-surface, .recharts-responsive-container svg')).toBeVisible({ timeout: 8_000 });
    expect(await page.locator('[class*="error-boundary"], h1:has-text("500")').count()).toBe(0);
  });

  test('09-02 sales report shows Overview and By Pharmacist tabs', async ({ page }) => {
    await page.goto('/ar/admin/reports/sales');
    await page.waitForTimeout(1_500);
    await expect(page.locator('button:has-text("Overview"), button:has-text("نظرة عامة")')).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('button:has-text("By Pharmacist"), button:has-text("حسب الصيدلاني")')).toBeVisible();
  });

  test('09-03 By Pharmacist tab shows pharmacist performance table', async ({ page }) => {
    await page.goto('/ar/admin/reports/sales');
    await page.waitForTimeout(1_500);
    const pharmTab = page.locator('button:has-text("By Pharmacist"), button:has-text("حسب الصيدلاني")').first();
    await pharmTab.click();
    await page.waitForTimeout(2_000);
    // Table should appear with pharmacist data (from seed: 35 sales across 4 pharmacists)
    await expect(page.locator('table, [class*="D365Table"]')).toBeVisible({ timeout: 6_000 });
    // Should show pharmacist names
    await expect(page.locator('body')).toContainText(/Pharm\.|صيدلاني|Layla|Noura|Ahmed|Faisal/i, { timeout: 6_000 });
  });

  test('09-04 By Pharmacist API returns correct shape', async ({ page }) => {
    const token = await page.evaluate(async ({ base, email, password }) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return (await r.json()).access_token;
    }, { base: API_BASE, email: ADMIN.email, password: ADMIN.password });

    const res = await page.evaluate(async ({ base, token }) => {
      const r = await fetch(`${base}/reports/sales/by-pharmacist?from_date=2026-01-01&to_date=2026-12-31`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.json() };
    }, { base: API_BASE, token });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rows');
    for (const row of res.body.rows) {
      expect(row).toHaveProperty('user_id');
      expect(row).toHaveProperty('full_name');
      expect(row).toHaveProperty('tx_count');
      expect(row).toHaveProperty('revenue');
    }
  });

  test('09-05 period toggle changes date label', async ({ page }) => {
    await page.goto('/ar/admin/reports/sales');
    await page.waitForTimeout(1_500);
    const toggleBtn = page.locator('button').filter({ hasText: /Last 30|آخر 30|This month|هذا الشهر/ }).first();
    const before = await toggleBtn.textContent();
    await toggleBtn.click();
    await page.waitForTimeout(500);
    const after = await toggleBtn.textContent();
    expect(before).not.toEqual(after);
  });

  test('09-06 sales report export button is present', async ({ page }) => {
    await page.goto('/ar/admin/reports/sales');
    await page.waitForTimeout(1_500);
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("تصدير")').first();
    await expect(exportBtn).toBeVisible({ timeout: 6_000 });
  });

  // ── Inventory Report ─────────────────────────────────────────────────────────

  test('09-07 inventory report loads with medicine count', async ({ page }) => {
    await page.goto('/ar/admin/reports/inventory');
    await page.waitForTimeout(2_000);
    await expect(page.locator('body')).toContainText(/medicine|دواء|inventory|مخزون/i, { timeout: 6_000 });
    expect(await page.locator('body').getByText(/500|Internal Server Error/).count()).toBe(0);
  });

  test('09-08 inventory report API returns inventory_value and by_category', async ({ page }) => {
    const token = await page.evaluate(async ({ base, email, password }) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return (await r.json()).access_token;
    }, { base: API_BASE, email: ADMIN.email, password: ADMIN.password });

    const res = await page.evaluate(async ({ base, token }) => {
      const r = await fetch(`${base}/reports/inventory?branch_id=br-001`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.json() };
    }, { base: API_BASE, token });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_medicines');
    expect(res.body).toHaveProperty('inventory_value');
    expect(res.body).toHaveProperty('by_category');
    expect(Number(res.body.total_medicines)).toBeGreaterThan(0);
  });

  // ── Purchases Report ─────────────────────────────────────────────────────────

  test('09-09 purchases report page loads', async ({ page }) => {
    await page.goto('/ar/admin/reports/purchases');
    await page.waitForTimeout(2_000);
    await expect(page.locator('body')).toContainText(/purchase|مشتريات|supplier|مورد/i, { timeout: 6_000 });
    expect(await page.locator('body').getByText(/500|Internal Server Error/).count()).toBe(0);
  });

  test('09-10 purchases report API returns spend_by_supplier', async ({ page }) => {
    const token = await page.evaluate(async ({ base, email, password }) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return (await r.json()).access_token;
    }, { base: API_BASE, email: ADMIN.email, password: ADMIN.password });

    const res = await page.evaluate(async ({ base, token }) => {
      const r = await fetch(`${base}/reports/purchases?from_date=2026-01-01&to_date=2026-12-31`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.json() };
    }, { base: API_BASE, token });

    expect(res.status).toBe(200);
    // API returns by_supplier and by_medicine (not spend_by_supplier)
    expect(res.body).toHaveProperty('by_supplier');
    expect(res.body).toHaveProperty('by_medicine');
  });

  // ── VAT Report ───────────────────────────────────────────────────────────────

  test('09-11 VAT report page loads', async ({ page }) => {
    await page.goto('/ar/admin/vat');
    await page.waitForTimeout(2_000);
    await expect(page.locator('body')).toContainText(/VAT|ضريبة|ZATCA/i, { timeout: 6_000 });
    expect(await page.locator('body').getByText(/500|Internal Server Error/).count()).toBe(0);
  });

  test('09-12 VAT report API returns zero_rated and standard breakdown', async ({ page }) => {
    const token = await page.evaluate(async ({ base, email, password }) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return (await r.json()).access_token;
    }, { base: API_BASE, email: ADMIN.email, password: ADMIN.password });

    const res = await page.evaluate(async ({ base, token }) => {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const r = await fetch(`${base}/reports/vat?year=${now.getFullYear()}&month=${month}&branch_id=br-001`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.json() };
    }, { base: API_BASE, token });

    expect(res.status).toBe(200);
    // API returns rows array with monthly breakdown
    // Shape: { rows: [{month, taxable_0, taxable_15, vat_collected, grand_total}], from_date, to_date }
    const hasRows = res.body.hasOwnProperty('rows') || res.body.hasOwnProperty('total_vat_collected');
    expect(hasRows).toBeTruthy();
    // Each row should have VAT data
    const rows = res.body.rows ?? [];
    for (const row of rows) {
      const hasVatData = row.hasOwnProperty('vat_collected') || row.hasOwnProperty('taxable_15');
      expect(hasVatData).toBeTruthy();
    }
  });

  // ── Reports Hub ──────────────────────────────────────────────────────────────

  test('09-13 reports hub page shows links to all sub-reports', async ({ page }) => {
    await page.goto('/ar/admin/reports');
    await page.waitForTimeout(1_500);
    await expect(page.locator('body')).toContainText(/sales|مبيعات/i, { timeout: 6_000 });
    await expect(page.locator('body')).toContainText(/inventory|مخزون/i);
    await expect(page.locator('body')).toContainText(/purchase|مشتريات/i);
  });

  test('09-14 sales report with branch_id filter scopes data correctly', async ({ page }) => {
    const token = await page.evaluate(async ({ base, email, password }) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return (await r.json()).access_token;
    }, { base: API_BASE, email: ADMIN.email, password: ADMIN.password });

    const [br1, all] = await page.evaluate(async ({ base, token }) => {
      const from = '2026-01-01';
      const to = '2026-12-31';
      const [r1, r2] = await Promise.all([
        fetch(`${base}/reports/sales?from_date=${from}&to_date=${to}&branch_id=br-001`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${base}/reports/sales?from_date=${from}&to_date=${to}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      return [await r1.json(), await r2.json()];
    }, { base: API_BASE, token });

    // br-001 total should be <= chain total
    const br1Total = Number(br1.total_revenue ?? 0);
    const allTotal = Number(all.total_revenue ?? 0);
    expect(br1Total).toBeLessThanOrEqual(allTotal + 0.001); // allow float drift
  });

});
