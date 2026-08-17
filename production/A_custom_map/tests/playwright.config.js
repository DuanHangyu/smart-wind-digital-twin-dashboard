import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'performance.spec.js',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:43717',
    channel: 'chrome',
    headless: true,
    launchOptions: {
      args: ['--enable-webgl', '--ignore-gpu-blocklist'],
    },
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-emulation',
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 43717',
    url: 'http://127.0.0.1:43717',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
