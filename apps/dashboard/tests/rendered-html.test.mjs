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
