import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 3,
  timeout: 30000,
  use: { baseURL: process.env.SITE_URL || 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 1024 } },
    },
    {
      name: 'webkit',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'webkit',
        // Keep logical viewport coverage without 9x software-rasterization cost in CI.
        deviceScaleFactor: process.env.CI ? 1 : 3,
      },
    },
  ],
  webServer: process.env.SITE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 5173',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
      },
});
