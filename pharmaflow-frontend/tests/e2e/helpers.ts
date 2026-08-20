/**
 * PharmaFlow — Playwright Helpers
 *
 * Shared fixtures, constants, and utility functions used across all test files.
 */
import { Page, expect, request as playwrightRequest } from '@playwright/test';

// ── Credentials ──────────────────────────────────────────────────────────────
export const ADMIN = {
  email: 'admin@demo.pharmaflow',
  password: 'Demo@1234',
  name: 'Admin User',
  role: 'admin',
};

export const PHARMACIST = {
  email: 'pharm1@demo.pharmaflow',
  password: 'Demo@1234',
  name: 'Pharmacist One',
  role: 'pharmacist',
  branchId: 'br-001',
};

export const API_BASE = 'http://127.0.0.1:8000';
export const APP_BASE = 'http://localhost:3000';

// ── Medicines with known properties (from seed_minimal.py) ──────────────────
export const MED = {
  panadol:      { id: 'med-001', name: 'Panadol Extra 500mg (24 Tabs)', barcode: '6281033745001', vat: 'zero_rated' },
  centrum:      { id: 'med-015', name: 'Centrum Adults Multivitamin (100 Tabs)', barcode: '6281033745015', vat: 'standard' },
  omega3:       { id: 'med-016', name: 'Omega-3 Fish Oil 1000mg (60 Caps)', barcode: '6281033745016', vat: 'standard' },
  xanax:        { id: 'med-018', name: 'Xanax 0.5mg Alprazolam (30 Tabs)', barcode: '6281033745018', vat: 'zero_rated', controlled: true },
  tramadol:     { id: 'med-020', name: 'Tramadol 50mg Hydrochloride (20 Caps)', barcode: '6281033745020', vat: 'zero_rated', controlled: true },
  bepanthen:    { id: 'med-017', name: 'Bepanthen Moisturizing Cream 100g', barcode: '6281033745017', vat: 'standard' },
};

export const COUPONS = {
  demo10:    'DEMO10',
  promo20:   'PROMO20',
  invalid:   'NOTVALID999',
};

// ── Login helper ─────────────────────────────────────────────────────────────
export async function login(page: Page, email: string, password: string) {
  await page.goto('/ar/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|pharmacist)\/dashboard/, { timeout: 10_000 });
}

export async function loginAdmin(page: Page) {
  await login(page, ADMIN.email, ADMIN.password);
}

export async function loginPharmacist(page: Page) {
  await login(page, PHARMACIST.email, PHARMACIST.password);
}

// ── Node-side API helpers (bypass browser security) ──────────────────────────

/** Get a JWT token via Node-side HTTP (not browser fetch) */
export async function getTokenNode(email: string, password: string): Promise<string> {
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });
  const res = await ctx.post('/auth/login', { data: { email, password } });
  const body = await res.json();
  await ctx.dispose();
  return body.access_token;
}

/** Ensure a shift is open for the pharmacist — Node-side, no browser fetch */
export async function ensureShiftOpen(page: Page) {
  const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
  const ctx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const cur = await ctx.get('/sessions/current');
  if (cur.status() === 404) {
    await ctx.post('/sessions/open', { data: { opening_float: 500 } });
  }
  await ctx.dispose();
}

/** Close the current shift if open — Node-side */
export async function closeShiftIfOpen(page: Page) {
  const token = await getTokenNode(PHARMACIST.email, PHARMACIST.password);
  const ctx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const cur = await ctx.get('/sessions/current');
  if (cur.status() === 200) {
    await ctx.post('/sessions/close');
  }
  await ctx.dispose();
}

// ── Legacy browser-side helpers (kept for backward compat, use sparingly) ────

export async function apiPost(page: Page, path: string, body: object, extraHeaders: Record<string, string> = {}) {
  return page.evaluate(
    async ({ url, body, headers }) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    },
    { url: `${API_BASE}${path}`, body, headers: extraHeaders },
  );
}

export async function apiGet(page: Page, path: string, token: string) {
  return page.evaluate(
    async ({ url, token }) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json() };
    },
    { url: `${API_BASE}${path}`, token },
  );
}

/** Get a JWT token via browser page.evaluate — use getTokenNode instead when possible */
export async function getToken(page: Page, email: string, password: string): Promise<string> {
  const res = await apiPost(page, '/auth/login', { email, password });
  return (res as any).body.access_token;
}

/** Create a sale via API — returns sale object */
export async function createSaleViaApi(
  page: Page,
  token: string,
  medicineId: string,
  sellingPrice: string,
  qty: number = 1,
) {
  return page.evaluate(
    async ({ base, token, medicineId, sellingPrice, qty }) => {
      const r = await fetch(`${base}/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          branch_id: 'br-001',
          payment_method: 'cash',
          items: [{ medicine_id: medicineId, quantity: qty, unit_price: sellingPrice }],
        }),
      });
      return r.json();
    },
    { base: API_BASE, token, medicineId, sellingPrice, qty },
  );
}

// ── Toast / notification checker ─────────────────────────────────────────────
export async function expectToast(page: Page, textFragment: string) {
  await expect(page.locator('body')).toContainText(textFragment, { timeout: 6_000 });
}

// ── Wait for API-driven content ───────────────────────────────────────────────
export async function waitForTableRows(page: Page, minRows: number = 1) {
  await page.waitForFunction(
    (min) => document.querySelectorAll('table tbody tr').length >= min,
    minRows,
    { timeout: 8_000 },
  );
}
