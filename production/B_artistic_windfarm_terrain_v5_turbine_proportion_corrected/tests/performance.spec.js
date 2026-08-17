import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('B 风场 KTX2 GLB 在电脑和手机档位加载、交互并达标', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-emulation';
  if (mobile) {
    const client = await page.context().newCDPSession(page); await client.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 500 * 1024, uploadThroughput: 250 * 1024, connectionType: 'cellular4g' });
  }
  const consoleErrors = []; page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); }); page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__APP_METRICS?.ready || window.__APP_METRICS?.error, null, { timeout: 25_000 });
  const initial = await page.evaluate(() => ({ ...window.__APP_METRICS })); expect(initial.error, initial.error ?? '').toBeNull();
  await page.waitForFunction(() => window.__APP_METRICS.fpsSamples >= 2, null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.selectPartByName('PART__TURBINE_03'))).toBe(true); await expect(page.locator('#detail-name')).toHaveText('风机03');
  await page.locator('#toggle-wire').click(); await expect(page.locator('#toggle-wire')).toHaveClass(/active/); expect(await page.evaluate(() => window.__APP_METRICS.wireframe)).toBe(true);
  const metrics = await page.evaluate(() => ({ ...window.__APP_METRICS }));
  expect(metrics.parts).toBe(6); expect(metrics.hotspots).toBe(4); expect(metrics.rotors).toBe(3); expect(metrics.triangles).toBeLessThanOrEqual(45_000);
  expect(metrics.drawCalls).toBeLessThanOrEqual(28); expect(metrics.modelBytes).toBeLessThanOrEqual(5_000_000); expect(metrics.estimatedVRAMMB).toBeLessThanOrEqual(18);
  expect(metrics.loadMs).toBeLessThan(10_000); expect(metrics.fps).toBeGreaterThanOrEqual(25); expect(consoleErrors).toEqual([]);
  const report = { testedAt: new Date().toISOString(), project: testInfo.project.name, viewport: testInfo.project.use.viewport, browser: `Google Chrome headless / ${metrics.gpuRenderer}`,
    emulation: mobile ? 'Pixel 7 + 4x CPU slowdown + 4 Mbps/80 ms network' : '1440x900 desktop, local network', thresholds: { trianglesMax: 45000, drawCallsMax: 28, modelBytesMax: 5000000, estimatedVRAMMBMax: 18, loadMsMax: 10000, fpsMin: 25 }, metrics, consoleErrors };
  fs.mkdirSync(path.resolve('reports'), { recursive: true }); fs.writeFileSync(path.resolve(`reports/performance-${testInfo.project.name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await page.screenshot({ path: path.resolve(`reports/web-${testInfo.project.name}.png`), fullPage: true });
});
