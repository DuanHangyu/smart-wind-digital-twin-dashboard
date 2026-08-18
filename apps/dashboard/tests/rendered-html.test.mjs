import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the W1 digital-twin dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>智慧风电数字孪生可视化大屏<\/title>/i);
  assert.match(html, /智慧风电可视化大屏/);
  assert.match(html, /风场管理/);
  assert.match(html, /统计视图/);
  assert.match(html, /运维管理/);
  assert.match(html, /自定义区域运行态势/);
  assert.match(html, /实时数据/);
  assert.match(html, /W2 LIVE MOCK/);
  assert.match(html, /1952\.47/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the fixed 2560x1080 stage and three-page navigation contract", async () => {
  const [page, styles, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /DESIGN_WIDTH\s*=\s*2560/);
  assert.match(page, /DESIGN_HEIGHT\s*=\s*1080/);
  assert.match(page, /StatisticsPage/);
  assert.match(page, /WindfarmPage/);
  assert.match(page, /OperationsPage/);
  assert.match(page, /localStorage/);
  assert.match(styles, /width:\s*2560px/);
  assert.match(styles, /height:\s*1080px/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("ships reproducible W2 fixtures and a one-hertz data adapter", async () => {
  const [hook, telemetry, page, regions, turbines, manifest] = await Promise.all([
    readFile(new URL("../app/hooks/useMockDashboard.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard/Telemetry.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/fixtures/statistics-regions.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/fixtures/windfarm-turbines.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/fixtures/assets-manifest.json", import.meta.url), "utf8"),
  ]);

  const regionData = JSON.parse(regions);
  const turbineData = JSON.parse(turbines);
  const assets = JSON.parse(manifest);

  assert.equal(regionData.length, 14);
  assert.deepEqual(regionData.map((item) => item.regionName).slice(0, 5), ["北辰", "云岭", "西原", "苍川", "中岳"]);
  assert.equal(turbineData.length, 10);
  assert.equal(assets.length, 3);
  assert.match(hook, /setInterval\(\(\) => setSnapshot\(nextSnapshot\), 1000\)/);
  assert.match(telemetry, /useTweenNumber/);
  assert.match(telemetry, /useCircularWindow/);
  assert.match(telemetry, /暂无数据/);
  assert.doesNotMatch(telemetry, /fetch\(/);
  assert.match(page, /viewMode:\s*"transparent"/);
  assert.match(page, /autoHighlightEnabled:\s*true/);
  assert.match(page, /projectionEnabled:\s*false/);
});
