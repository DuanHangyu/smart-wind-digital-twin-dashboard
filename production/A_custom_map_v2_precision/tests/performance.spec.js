import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('KTX2 GLB 在目标设备档位正确加载并保持交互', async ({ page }, testInfo) => {
  const mobileThrottle = testInfo.project.name === 'mobile-emulation';
  if (mobileThrottle) {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 80,
      downloadThroughput: 500 * 1024,
      uploadThroughput: 250 * 1024,
      connectionType: 'cellular4g',
    });
  }
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__APP_METRICS?.ready || window.__APP_METRICS?.error, null, {
    timeout: 25_000,
  });
  const firstMetrics = await page.evaluate(() => ({ ...window.__APP_METRICS }));
  expect(firstMetrics.error, firstMetrics.error ?? '').toBeNull();
  await page.waitForFunction(() => window.__APP_METRICS.fpsSamples >= 2, null, { timeout: 10_000 });

  expect(await page.evaluate(() => window.selectPartByName('PART__REGION_14'))).toBe(true);
  await expect(page.locator('#detail-name')).toHaveText('南港');
  await expect(page.locator('[data-target="PART__REGION_14"]').first()).toHaveClass(/active/);

  const metrics = await page.evaluate(() => ({ ...window.__APP_METRICS }));
  expect(metrics.parts).toBe(14);
  expect(metrics.hotspots).toBe(14);
  expect(metrics.outlines).toBe(14);
  expect(metrics.triangles).toBeLessThanOrEqual(30_000);
  expect(metrics.drawCalls).toBeLessThanOrEqual(32);
  expect(metrics.modelBytes).toBeLessThanOrEqual(2_500_000);
  expect(metrics.estimatedVRAMMB).toBeLessThanOrEqual(10);
  expect(metrics.loadMs).toBeLessThan(10_000);
  expect(metrics.fps).toBeGreaterThanOrEqual(25);
  expect(consoleErrors).toEqual([]);

  const reportsDir = path.resolve('reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const report = {
    testedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: testInfo.project.use.viewport,
    browser: `Google Chrome headless / ${metrics.gpuRenderer}`,
    emulation: mobileThrottle
      ? 'Pixel 7 viewport/touch/user-agent + 4x CPU slowdown + 4 Mbps/80 ms network'
      : '1440x900 desktop, local network',
    thresholds: {
      trianglesMax: 30_000,
      drawCallsMax: 32,
      modelBytesMax: 2_500_000,
      estimatedVRAMMBMax: 10,
      loadMsMax: 10_000,
      fpsMin: 25,
    },
    metrics,
    consoleErrors,
  };
  fs.writeFileSync(
    path.join(reportsDir, `performance-${testInfo.project.name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await page.screenshot({
    path: path.join(reportsDir, `web-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
