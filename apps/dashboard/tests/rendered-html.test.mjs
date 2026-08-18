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
  assert.match(html, /W3 REAL GLB/);
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

test("integrates the validated A map GLB with fourteen interactive regions", async () => {
  const [model, scene, page, packageJson] = await Promise.all([
    readFile(new URL("../public/models/custom-map.glb", import.meta.url)),
    readFile(new URL("../app/components/scenes/CustomRegionMapScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.equal(model.subarray(0, 4).toString("utf8"), "glTF");
  const jsonLength = model.readUInt32LE(12);
  const jsonType = model.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a);
  const gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  const nodeNames = gltf.nodes.map((node) => node.name ?? "");
  assert.equal(nodeNames.filter((name) => name.startsWith("PART__REGION_")).length, 14);
  assert.equal(nodeNames.filter((name) => name.startsWith("HOTSPOT__REGION_")).length, 14);
  assert.equal(nodeNames.filter((name) => name.startsWith("FX__OUTLINE_")).length, 14);
  assert.match(scene, /GLTFLoader/);
  assert.match(scene, /KTX2Loader/);
  assert.match(scene, /Raycaster/);
  assert.match(scene, /targetY/);
  assert.match(scene, /setTurbinesVisible/);
  assert.match(scene, /dispose\(\)/);
  assert.match(page, /CustomRegionMapScene/);
  assert.match(packageJson, /"three": "0\.185\.1"/);
});

test("integrates the validated B V5 terrain with linked turbine points", async () => {
  const [model, scene, page, telemetry] = await Promise.all([
    readFile(new URL("../public/models/windfarm.glb", import.meta.url)),
    readFile(new URL("../app/components/scenes/WindFarmTerrainScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard/Telemetry.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal(model.subarray(0, 4).toString("utf8"), "glTF");
  assert.ok(model.byteLength < 5_000_000);
  const jsonLength = model.readUInt32LE(12);
  const gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  const nodeNames = gltf.nodes.map((node) => node.name ?? "");
  const rotorNodes = gltf.nodes.filter((node) => (node.name ?? "").startsWith("ROTOR__TURBINE_"));
  assert.equal(nodeNames.filter((name) => name.startsWith("PART__TURBINE_")).length, 3);
  assert.equal(rotorNodes.length, 3);
  assert.deepEqual(rotorNodes.map((node) => node.extras?.rotor_axis), ["Y", "Y", "Y"]);
  assert.deepEqual(rotorNodes.map((node) => node.extras?.rpm), [8.2, 7.1, 9.1]);
  assert.equal(nodeNames.filter((name) => name.startsWith("HOTSPOT__")).length, 4);
  assert.ok(nodeNames.includes("PART__TERRAIN"));
  assert.ok(nodeNames.includes("PART__LAKE"));
  assert.match(scene, /T-A01[\s\S]*T-A02[\s\S]*T-A04/);
  assert.match(scene, /WireframeGeometry/);
  assert.match(scene, /setWaterVisible/);
  assert.match(scene, /setProjectionEnabled/);
  assert.match(scene, /status === "offline"/);
  assert.doesNotMatch(scene, /status === "standby"\s*\|\|\s*turbine\.status === "fault"/);
  assert.match(scene, /axis === "Y"[\s\S]*new THREE\.Vector3\(0, 0, -1\)/);
  assert.match(scene, /rotateOnAxis\(axis/);
  assert.doesNotMatch(scene, /rotorLocalAxis/);
  assert.match(scene, /sourceRpm \* Math\.PI \* 2 \/ 60 \* delta/);
  assert.match(scene, /5000/);
  assert.match(scene, /forceContextLoss/);
  assert.match(page, /WindFarmTerrainScene/);
  assert.match(page, /W4 REAL GLB/);
  assert.match(telemetry, /linkedTurbineIds/);
  assert.match(telemetry, /selectedTurbineId/);
});

test("integrates the validated C V3 dismantlable turbine with four exclusive modes", async () => {
  const [model, scene, page, parts] = await Promise.all([
    readFile(new URL("../public/models/turbine.glb", import.meta.url)),
    readFile(new URL("../app/components/scenes/TurbineTwinScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/fixtures/turbine-parts.json", import.meta.url), "utf8"),
  ]);

  assert.equal(model.subarray(0, 4).toString("utf8"), "glTF");
  assert.ok(model.byteLength < 2_000_000);
  const jsonLength = model.readUInt32LE(12);
  const gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  const nodeNames = gltf.nodes.map((node) => node.name ?? "");
  const partNodes = gltf.nodes.filter((node) => (node.name ?? "").startsWith("PART__"));
  const partRecords = JSON.parse(parts);
  const rotorNode = gltf.nodes.find((node) => (node.name ?? "").startsWith("ROTOR__"));
  assert.equal(partNodes.length, 15);
  assert.equal(nodeNames.filter((name) => name.startsWith("HOTSPOT__")).length, 9);
  assert.equal(rotorNode?.extras?.rotation_axis, "Y");
  assert.equal(rotorNode?.extras?.rpm, 8.5);
  assert.equal(partRecords.length, 15);
  assert.deepEqual(
    partRecords.map((part) => part.modelNodeName).sort(),
    partNodes.map((node) => node.name).sort(),
  );
  assert.ok(partNodes.every((node) => Array.isArray(node.extras?.explode_vector) && node.extras.explode_vector.length === 3));
  assert.match(scene, /KTX2Loader/);
  assert.match(scene, /blenderVectorToThree/);
  assert.match(scene, /RUNTIME__ROTOR_PIVOT/);
  assert.match(scene, /setFromObject\(shaftRuntime\.object\)/);
  assert.match(scene, /sourceRotor\.children\.slice\(\)\.forEach\(\(child\) => runtimeRotor\.attach\(child\)\)/);
  assert.match(scene, /const EXTERNAL_PARTS[\s\S]*PART__MAIN_SHAFT[\s\S]*PART__YAW_GEAR/);
  assert.match(scene, /localClippingEnabled = true/);
  assert.match(scene, /shaftRevealStartZ/);
  assert.match(scene, /partName === "PART__MAIN_SHAFT"[\s\S]*externalShaftClipPlanes/);
  assert.match(scene, /rotateOnAxis\(rotorAxis/);
  assert.match(scene, /WireframeGeometry/);
  assert.match(scene, /mode === "structure"/);
  assert.match(scene, /forceContextLoss/);
  assert.match(page, /TurbineTwinScene/);
  assert.match(page, /W5 REAL GLB/);
  assert.match(page, /selectedPartId: null, viewMode: mode/);
});
