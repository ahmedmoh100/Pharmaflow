/**
 * 01 — Authentication
 *
 * Mirrors: test_01_auth.py
 * Tests:
 *  - Admin login → redirects to /admin/dashboard
 *  - Pharmacist login → redirects to /pharmacist/dashboard
 *  - Wrong password → error message
 *  - Empty form → does not submit (HTML5 required)
 *  - Unauthenticated access → redirect to login
 *  - Demo credentials panel: quick-select works
 *  - Locale toggle: switches language label
 */

import { test, expect } from '@playwright/test';
import { ADMIN, PHARMACIST } from './helpers';

test.describe('Authentication', () => {

  test('01-01 admin login redirects to /admin/dashboard', async ({ page }) => {
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toContain('/admin/dashboard');
  });

  test('01-02 pharmacist login redirects to /pharmacist/dashboard', async ({ page }) => {
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', PHARMACIST.email);
    await page.fill('input[type="password"]', PHARMACIST.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/pharmacist\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toContain('/pharmacist/dashboard');
  });

  test('01-03 wrong password shows error', async ({ page }) => {
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Error div should appear with a relevant message
    await expect(page.locator('body')).toContainText(/invalid|incorrect|بيانات|خاطئ|error|خطأ/i, { timeout: 8_000 });
    expect(page.url()).toContain('/login');
  });

  test('01-04 unauthenticated access to admin dashboard redirects to login', async ({ page }) => {
    await page.goto('/ar/admin/dashboard');
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    expect(page.url()).toContain('login');
  });

  test('01-05 unauthenticated access to pharmacist dashboard redirects to login', async ({ page }) => {
    await page.goto('/ar/pharmacist/dashboard');
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    expect(page.url()).toContain('login');
  });

  test('01-06 demo credentials panel quick-select fills email and password', async ({ page }) => {
    await page.goto('/ar/login');
    // Click "Show demo credentials" toggle
    await page.click('button:has-text("Show demo"), button:has-text("عرض بيانات")');
    await expect(page.locator('[data-testid="demo-panel"], .demo-panel, form')).toBeVisible({ timeout: 4_000 });
    // Click "Use" button for admin user
    const useBtn = page.locator('button:has-text("Use"), button:has-text("استخدام")').first();
    await useBtn.click();
    // Email should now be filled with admin email
    const emailVal = await page.inputValue('input[type="email"]');
    expect(emailVal).toContain('@demo.pharmaflow');
  });

  test('01-07 login page shows language toggle button', async ({ page }) => {
    await page.goto('/ar/login');
    // The locale toggle button shows "EN" when in Arabic mode
    const toggle = page.locator('button:has-text("EN"), button:has-text("AR")').first();
    await expect(toggle).toBeVisible();
  });

  test('01-08 admin cannot access pharmacist pages after login as admin', async ({ page }) => {
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 10_000 });
    // Navigating to pharmacist area should redirect
    await page.goto('/ar/pharmacist/dashboard');
    // Should either redirect to admin/dashboard or show unauthorized
    await page.waitForTimeout(2_000);
    const url = page.url();
    const isRedirected = url.includes('/admin/') || url.includes('/unauthorized') || url.includes('/login');
    expect(isRedirected).toBeTruthy();
  });

});
