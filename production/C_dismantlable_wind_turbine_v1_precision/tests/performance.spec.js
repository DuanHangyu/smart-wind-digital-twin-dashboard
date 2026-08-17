import { expect, test } from '@playwright/test';
import fs from 'node:fs'; import path from 'node:path';
test('C 可拆解风机在电脑和手机档位加载、拆解和选择正常',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-emulation';
  if(mobile){const client=await page.context().newCDPSession(page);await client.send('Emulation.setCPUThrottlingRate',{rate:4});await client.send('Network.enable');await client.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:500*1024,uploadThroughput:250*1024,connectionType:'cellular4g'});}
  const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('pageerror',e=>consoleErrors.push(e.message));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__APP_METRICS?.ready||window.__APP_METRICS?.error,null,{timeout:25_000});
  const initial=await page.evaluate(()=>({...window.__APP_METRICS}));expect(initial.error,initial.error??'').toBeNull();await page.waitForFunction(()=>window.__APP_METRICS.fpsSamples>=2,null,{timeout:12_000});
  expect(await page.evaluate(()=>window.selectPartByName('PART__GEARBOX'))).toBe(true);await expect(page.locator('#detail-name')).toHaveText('齿轮箱');
  await page.locator('#mode-cutaway').click();expect(await page.evaluate(()=>window.__APP_METRICS.cutaway)).toBe(true);
  await page.locator('#mode-explode').click();expect(await page.evaluate(()=>window.__APP_METRICS.explode)).toBeGreaterThan(.9);
  await page.locator('#toggle-wire').click();expect(await page.evaluate(()=>window.__APP_METRICS.wireframe)).toBe(true);
  const m=await page.evaluate(()=>({...window.__APP_METRICS}));expect(m.parts).toBe(15);expect(m.hotspots).toBe(9);expect(m.rotors).toBe(1);expect(m.triangles).toBeLessThanOrEqual(45000);expect(m.drawCalls).toBeLessThanOrEqual(30);expect(m.modelBytes).toBeLessThanOrEqual(5000000);expect(m.estimatedVRAMMB).toBeLessThanOrEqual(18);expect(m.loadMs).toBeLessThan(10000);expect(m.fps).toBeGreaterThanOrEqual(25);expect(consoleErrors).toEqual([]);
  const report={testedAt:new Date().toISOString(),project:testInfo.project.name,viewport:testInfo.project.use.viewport,emulation:mobile?'Pixel 7 + 4x CPU + 4 Mbps/80 ms':'1440x900 desktop',thresholds:{trianglesMax:45000,drawCallsMax:30,modelBytesMax:5000000,estimatedVRAMMBMax:18,loadMsMax:10000,fpsMin:25},metrics:m,consoleErrors};fs.mkdirSync(path.resolve('reports'),{recursive:true});fs.writeFileSync(path.resolve(`reports/performance-${testInfo.project.name}.json`),`${JSON.stringify(report,null,2)}\n`);await page.screenshot({path:path.resolve(`reports/web-${testInfo.project.name}.png`),fullPage:true});
});
