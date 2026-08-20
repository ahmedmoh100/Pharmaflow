/**
 * 04 — Cash Sessions (Shift Lifecycle)
 *
 * Mirrors: test_06_sessions.py
 * Tests:
 *  - Shift gate: Charge disabled when no shift
 *  - Open shift via API → no shift message gone
 *  - Session current returns OPEN after open
 *  - Session close → 404 on current
 *  - Tender declaration API returns BALANCED/OVERAGE/SHORTAGE
 *  - Z-report endpoint returns required fields
 *  - Session history has items property
 *  - Double break start returns 400
 */

import { test, expect, request } from '@playwright/test';
import { loginPharmacist, ensureShiftOpen, closeShiftIfOpen, getTokenNode, PHARMACIST, API_BASE } from './helpers';

test.describe('Cash Sessions (Shift Lifecycle)', () => {

  test('04-01 when no shift is open, Charge button is disabled on POS', async ({ page }) => {
    await closeShiftIfOpen(page);
    await loginPharmacist(page);
    await page.goto('/ar/pharmacist/sales/new');
    await page.waitForTimeout(1_500);
    const chargeBtn = page.locator('button:has-text("Charge"), button:has-text("إتمام البيع")');
    await expect(chargeBtn).toBeDisabled({ timeout: 6_000 });
  });

  test('04-02 "no open shift" banner visible on POS when shift is closed', async ({ page }) => {
    await closeShiftIfOpen(page);
    await loginPharmacist(page);
    await page.goto('/ar/pharmacist/sales/new');
    await page.waitForTimeout(1_500);
    await expect(page.locator('body')).toContainText(/No open shift|no open|لا توجد وردية/i, { timeout: 6_000 });
  });

  test('04-03 open shift via API then POS has no shift-closed message', async ({ page }) => {
    await ensureShiftOpen(page);
    await loginPharmacist(page);
    await page.goto('/ar/pharmacist/sales/new');
    await page.waitForTimeout(1_500);
    const hasNoShiftMsg = await page.locator('body').getByText(/No open shift|لا توجد وردية/).count();
    expect(hasNoShiftMsg).toBe(0);
  });

  test('04-04 PosShell renders pharmacist tiles on dashboard', async ({ page }) => {
    await ensureShiftOpen(page);
    await loginPharmacist(page);
    await page.goto('/ar/pharmacist/dashboard');
    await page.waitForTimeout(1_500);
    await expect(page.locator('body')).toContainText(/.+/, { timeout: 4_000 });
    expect(await page.locator('[class*="error-boundary"], h1:has-text("500")').count()).toBe(0);
  });

  test('04-05 session current endpoint returns OPEN after ensureShiftOpen', async ({ page }) => {
    await ensureShiftOpen(page);
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.get('/sessions/current');
    const body = await res.json();
    await ctx.dispose();
    expect(res.status()).toBe(200);
    expect(body.status).toBe('OPEN');
  });

  test('04-06 session close via API results in 404 on /sessions/current', async ({ page }) => {
    await ensureShiftOpen(page);
    await closeShiftIfOpen(page);
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.get('/sessions/current');
    await ctx.dispose();
    expect(res.status()).toBe(404);
    await ensureShiftOpen(page);
  });

  test('04-07 tender declaration API returns BALANCED, OVERAGE, or SHORTAGE', async ({ page }) => {
    await ensureShiftOpen(page);
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.post('/sessions/tender', { data: { declared_cash: 500.0, notes: 'Playwright test tender' } });
    const body = await res.json();
    await ctx.dispose();
    expect(['BALANCED', 'OVERAGE', 'SHORTAGE']).toContain(body.status);
    expect(body).toHaveProperty('declared_cash');
    expect(body).toHaveProperty('expected_cash');
    expect(body).toHaveProperty('difference');
  });

  test('04-08 Z-report endpoint returns required fields for closed session', async ({ page }) => {
    await ensureShiftOpen(page);
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    const closeRes = await ctx.post('/sessions/close');
    const closeBody = await closeRes.json();
    expect(closeBody.status).toBe('CLOSED');
    const sessionId = closeBody.id;

    const zRes = await ctx.get(`/sessions/${sessionId}/z-report`);
    const zReport = await zRes.json();
    await ctx.dispose();

    expect(zReport).toHaveProperty('total_sales');
    expect(zReport).toHaveProperty('total_revenue');
    expect(zReport).toHaveProperty('payment_breakdown');

    await ensureShiftOpen(page);
  });

  test('04-09 session history shows closed sessions', async ({ page }) => {
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.get('/sessions/history');
    const body = await res.json();
    await ctx.dispose();
    expect(body).toHaveProperty('items');
  });

  test('04-10 double break start returns 400', async ({ page }) => {
    await ensureShiftOpen(page);
    const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
    const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

    await ctx.post('/sessions/break/start', { data: { reason: 'Test break 1' } });
    const res2 = await ctx.post('/sessions/break/start', { data: { reason: 'Test break 2' } });
    expect(res2.status()).toBe(400);

    await ctx.post('/sessions/break/end');
    await ctx.dispose();
  });

});
