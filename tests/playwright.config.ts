import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
  baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'Chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
  command: 'node tests/static-server.cjs',
    port: 5173,
    reuseExistingServer: true,
  cwd: '..',
  },
});
