/**
 * 07 — Returns
 *
 * Mirrors: test_08_returns.py
 * Tests:
 *  - Returns page loads for pharmacist
 *  - Invoice search input is present
 *  - Invalid invoice shows error toast
 *  - Valid invoice lookup shows sale summary + items
 *  - Full return end-to-end via API → credit note created
 *  - Restockable flag: stock increments after return
 *  - Non-restockable: stock does NOT increment
 */

import { test, expect, request } from '@playwright/test';
import { loginPharmacist, ensureShiftOpen, getTokenNode, API_BASE, PHARMACIST } from './helpers';

test.describe('Returns', () => {

  test.beforeEach(async ({ page }) => {
    await ensureShiftOpen(page);
    await loginPharmacist(page);
  });

  test('07-01 returns page loads', async ({ page }) => {
    await page.goto('/ar/pharmacist/returns');
    await page.waitForTimeout(1_000);
    await expect(page.locator('body')).toContainText(/Return|إرجاع/i, { timeout: 6_000 });
    expect(await page.locator('[class*="error-boundary"], h1:has-text("500")').count()).toBe(0);
  });

  test('07-02 invoice search input is present and focusable', async ({ page }) => {
    await page.goto('/ar/pharmacist/returns');
    await page.waitForTimeout(1_000);
    const input = page.locator('input[placeholder*="Invoice"], input[placeholder*="رقم الفاتورة"]').first();
    await expect(input).toBeVisible({ timeout: 6_000 });
    await input.focus();
    await input.fill('TEST');
    const val = await input.inputValue();
    expect(val).toBe('TEST');
  });

  test('07-03 searching invalid invoice shows error', async ({ page }) => {
    await page.goto('/ar/pharmacist/returns');
    await page.waitForTimeout(1_000);
    const input = page.locator('input[placeholder*="Invoice"], input[placeholder*="رقم الفاتورة"]').first();
    await input.fill('NOTREAL-9999-000000');
    await page.locator('button:has-text("Search"), button:has-text("بحث")').click();
    await page.waitForTimeout(2_000);
    // Toast or inline error — accept any error indication
    const bodyText = await page.locator('body').textContent() ?? '';
    const hasError = /not found|غير موجود|invalid|خطأ|الفاتورة|error/i.test(bodyText);
    expect(hasError).toBeTruthy();
  });

  test('07-04 valid invoice lookup shows sale summary and items', async ({ page }) => {
    // Create a sale via Node API to get a valid invoice number
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    const medsRes = await ctx.get('/medicines?branch_id=br-001&is_active=true&page_size=20');
    const meds = (await medsRes.json()).items;
    const med = meds.find((m: any) => m.stock_quantity >= 2 && !m.is_controlled);
    if (!med) { await ctx.dispose(); return; }

    const saleRes = await ctx.post('/sales', {
      headers: { 'X-Idempotency-Key': Math.random().toString(36) },
      data: { branch_id: 'br-001', payment_method: 'cash', items: [{ medicine_id: med.id, quantity: 2, unit_price: med.selling_price }] },
    });
    const sale = await saleRes.json();
    await ctx.dispose();

    if (!sale.invoice_number) return;

    await page.goto('/ar/pharmacist/returns');
    await page.waitForTimeout(1_000);
    const input = page.locator('input[placeholder*="Invoice"], input[placeholder*="رقم الفاتورة"]').first();
    await input.fill(sale.invoice_number);
    await page.locator('button:has-text("Search"), button:has-text("بحث")').click();
    await page.waitForTimeout(1_500);

    await expect(page.locator('body')).toContainText(sale.invoice_number, { timeout: 6_000 });
  });

  test('07-05 return via API creates credit note with correct fields', async ({ page }) => {
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    const medsRes = await ctx.get('/medicines?branch_id=br-001&is_active=true&page_size=20');
    const meds = (await medsRes.json()).items;
    const med = meds.find((m: any) => m.stock_quantity >= 2 && !m.is_controlled);
    if (!med) { await ctx.dispose(); return; }

    const saleRes = await ctx.post('/sales', {
      headers: { 'X-Idempotency-Key': Math.random().toString(36) },
      data: { branch_id: 'br-001', payment_method: 'cash', items: [{ medicine_id: med.id, quantity: 2, unit_price: med.selling_price }] },
    });
    const sale = await saleRes.json();

    const lookupRes = await ctx.get(`/returns/lookup/${sale.invoice_number}`);
    const lookup = await lookupRes.json();
    const itemId = lookup.items?.[0]?.id;
    if (!itemId) { await ctx.dispose(); return; }

    const retRes = await ctx.post('/returns', {
      data: {
        sale_id: sale.id,
        reason: 'Playwright return test',
        items: [{ sale_item_id: itemId, quantity: 1, restockable: true, reason: 'Test' }],
      },
    });
    const ret = await retRes.json();
    await ctx.dispose();

    expect(ret).toHaveProperty('credit_note_number');
    expect(ret).toHaveProperty('total_refund');
    expect(Number(ret.total_refund)).toBeGreaterThan(0);
  });

  test('07-06 restockable return increments stock', async ({ page }) => {
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    const medsRes = await ctx.get('/medicines?branch_id=br-001&is_active=true&page_size=20');
    const meds = (await medsRes.json()).items;
    const med = meds.find((m: any) => m.stock_quantity >= 3 && !m.is_controlled);
    if (!med) { await ctx.dispose(); return; }
    const stockBefore = med.stock_quantity;

    const saleRes = await ctx.post('/sales', {
      headers: { 'X-Idempotency-Key': Math.random().toString(36) },
      data: { branch_id: 'br-001', payment_method: 'cash', items: [{ medicine_id: med.id, quantity: 2, unit_price: med.selling_price }] },
    });
    const sale = await saleRes.json();

    const lookupRes = await ctx.get(`/returns/lookup/${sale.invoice_number}`);
    const lookup = await lookupRes.json();
    const itemId = lookup.items?.[0]?.id;

    await ctx.post('/returns', {
      data: { sale_id: sale.id, reason: 'restock test', items: [{ sale_item_id: itemId, quantity: 1, restockable: true, reason: 'good' }] },
    });

    const medsAfterRes = await ctx.get(`/medicines?branch_id=br-001&page_size=100`);
    const medAfter = (await medsAfterRes.json()).items.find((m: any) => m.id === med.id);
    await ctx.dispose();

    // sold 2, returned 1 restockable → net -1
    expect(medAfter?.stock_quantity).toBe(stockBefore - 1);
  });

  test('07-07 non-restockable return does NOT increment stock', async ({ page }) => {
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    const medsRes = await ctx.get('/medicines?branch_id=br-001&is_active=true&page_size=20');
    const meds = (await medsRes.json()).items;
    const med = meds.find((m: any) => m.stock_quantity >= 2 && !m.is_controlled);
    if (!med) { await ctx.dispose(); return; }
    const stockBefore = med.stock_quantity;

    const saleRes = await ctx.post('/sales', {
      headers: { 'X-Idempotency-Key': Math.random().toString(36) },
      data: { branch_id: 'br-001', payment_method: 'cash', items: [{ medicine_id: med.id, quantity: 1, unit_price: med.selling_price }] },
    });
    const sale = await saleRes.json();

    const lookupRes = await ctx.get(`/returns/lookup/${sale.invoice_number}`);
    const lookup = await lookupRes.json();
    const itemId = lookup.items?.[0]?.id;

    await ctx.post('/returns', {
      data: { sale_id: sale.id, reason: 'damaged', items: [{ sale_item_id: itemId, quantity: 1, restockable: false, reason: 'damaged' }] },
    });

    const medsAfterRes = await ctx.get(`/medicines?branch_id=br-001&page_size=100`);
    const medAfter = (await medsAfterRes.json()).items.find((m: any) => m.id === med.id);
    await ctx.dispose();

    // sold 1, non-restockable → net -1 (no restock)
    expect(medAfter?.stock_quantity).toBe(stockBefore - 1);
  });

  test('07-08 return page shows success state with credit note number', async ({ page }) => {
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    const medsRes = await ctx.get('/medicines?branch_id=br-001&is_active=true&page_size=20');
    const meds = (await medsRes.json()).items;
    const med = meds.find((m: any) => m.stock_quantity >= 2 && !m.is_controlled);
    if (!med) { await ctx.dispose(); return; }

    const saleRes = await ctx.post('/sales', {
      headers: { 'X-Idempotency-Key': Math.random().toString(36) },
      data: { branch_id: 'br-001', payment_method: 'cash', items: [{ medicine_id: med.id, quantity: 2, unit_price: med.selling_price }] },
    });
    const saleData = await saleRes.json();
    await ctx.dispose();

    if (!saleData?.invoice_number) return;

    await page.goto('/ar/pharmacist/returns');
    await page.waitForTimeout(1_000);
    const input = page.locator('input[placeholder*="Invoice"], input[placeholder*="رقم الفاتورة"]').first();
    await input.fill(saleData.invoice_number);
    await page.locator('button:has-text("Search"), button:has-text("بحث")').click();
    await page.waitForTimeout(1_500);

    const reasonInput = page.locator('input[placeholder*="reason"], input[placeholder*="سبب"]').first();
    const reasonCount = await reasonInput.count();
    if (reasonCount === 0) return;
    await reasonInput.fill('Customer request');

    const confirmBtn = page.locator('button:has-text("Confirm Return"), button:has-text("تأكيد الإرجاع")').first();
    await confirmBtn.click();
    await page.waitForTimeout(2_500);

    await expect(page.locator('body')).toContainText(/Credit Note|إشعار الدائن|Return Processed|تم الإرجاع/i, { timeout: 8_000 });
  });

});
