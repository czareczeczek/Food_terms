import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined,
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
