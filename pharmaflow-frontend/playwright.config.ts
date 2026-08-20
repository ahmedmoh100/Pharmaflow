import { defineConfig, devices } from '@playwright/test';

/**
 * PharmaFlow — Playwright Configuration
 *
 * Requirements:
 *  - Frontend running on http://localhost:3000  (npm run dev)
 *  - Backend  running on http://localhost:8000  (uvicorn or start.bat)
 *  - DB seeded:  cd pharmaflow-db && python seed_minimal.py
 *
 * Run all tests:
 *   npx playwright test --reporter=list
 *
 * Run one file:
 *   npx playwright test tests/e2e/01_auth.spec.ts --reporter=list
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,          // serial — tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                    // single worker — avoid race conditions on shared DB
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'en-US',
    timezoneId: 'Asia/Riyadh',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
