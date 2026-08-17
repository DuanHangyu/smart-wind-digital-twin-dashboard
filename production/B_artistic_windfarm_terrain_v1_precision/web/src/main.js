import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const MODEL_URL = './models/B_windfarm_terrain_low_ktx2.glb';
const MOBILE = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const canvas = document.querySelector('#scene');
const viewport = document.querySelector('#viewport');
const hotspotLayer = document.querySelector('#hotspots');
const loaderElement = document.querySelector('#loader');
const partList = document.querySelector('#part-list');

const metrics = window.__APP_METRICS = {
  ready: false, error: null, deviceProfile: MOBILE ? 'mobile' : 'desktop', modelBytes: 0,
  loadMs: 0, triangles: 0, drawCalls: 0, geometryBytes: 0, textureBytes: 0,
  estimatedVRAMMB: 0, parts: 0, hotspots: 0, rotors: 0, wireframe: false,
  fps: 0, fpsSamples: 0, gpuRenderer: 'unknown',
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02090a);
scene.fog = new THREE.FogExp2(0x02090a, 0.026);
const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 100);
const defaultCamera = MOBILE ? new THREE.Vector3(0, 8.7, 13.6) : new THREE.Vector3(10.6, 8.3, 12.8);
camera.position.copy(defaultCamera);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
const debugInfo = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
if (debugInfo) metrics.gpuRenderer = renderer.getContext().getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.065; controls.minDistance = 6; controls.maxDistance = 26;
controls.minPolarAngle = 0.32; controls.maxPolarAngle = 1.42; controls.target.set(0, 0.45, 0);
controls.autoRotate = true; controls.autoRotateSpeed = 0.38;
scene.add(new THREE.HemisphereLight(0xb6fff4, 0x071611, 2.05));
const key = new THREE.DirectionalLight(0xf0fff7, 3.25); key.position.set(-6, 10, 7); scene.add(key);
const rim = new THREE.PointLight(0x00dcd4, 7, 30, 2); rim.position.set(7, 6, -5); scene.add(rim);
const grid = new THREE.GridHelper(32, 50, 0x087a79, 0x063638); grid.position.y = -0.42;
grid.material.transparent = true; grid.material.opacity = 0.24; scene.add(grid);

const modelPivot = new THREE.Group(); modelPivot.name = 'MODEL_AUTO_CENTER_SCALE'; scene.add(modelPivot);
const wireGroup = new THREE.Group(); wireGroup.name = 'RUNTIME__HOLOGRAPHIC_WIREFRAME'; wireGroup.visible = false;
const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(2, 2);
const parts = []; const hotspots = []; const rotors = [];
let selectedPart = null; let hoverPart = null; let fpsStart = performance.now(); let fpsFrames = 0;

function partFromHit(object) { let current = object; while (current && !current.name.startsWith('PART__')) current = current.parent; return current; }
function setPointer(event) { const rect = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; }
function setPartVisual(part, state) {
  if (!part) return;
  part.traverse((child) => {
    if (!child.isMesh || !child.material?.emissive) return;
    if (state === 'selected') { child.material.emissive.setHex(0x10d8ca); child.material.emissiveIntensity = 0.48; }
    else if (state === 'hover') { child.material.emissive.setHex(0x087e7b); child.material.emissiveIntensity = 0.28; }
    else { child.material.emissive.copy(child.material.userData.baseEmissive); child.material.emissiveIntensity = child.material.userData.baseEmissiveIntensity; }
  });
}
function updateDetail(part) {
  const data = part?.userData ?? {};
  const power = Number(data.power_kw ?? 0);
  document.querySelector('#detail-name').textContent = data.display_name ?? part?.name ?? '请选择资产';
  document.querySelector('#detail-value').textContent = power ? `${power} kW` : (data.water_level_m ? `${Number(data.water_level_m).toFixed(2)} m` : '--');
  document.querySelector('#detail-bar').style.width = `${Math.min(power / 20, 100)}%`;
  document.querySelector('#detail-id').textContent = part ? `${part.name} · ${data.status ?? data.part_type ?? 'READY'}` : 'PART__* / HOTSPOT__* 节点已就绪';
}
function selectPart(partOrName) {
  const next = typeof partOrName === 'string' ? parts.find((part) => part.name === partOrName) : partOrName;
  if (!next) return false;
  if (selectedPart && selectedPart !== next) setPartVisual(selectedPart, 'default');
  selectedPart = next; setPartVisual(next, 'selected'); updateDetail(next);
  document.querySelectorAll('[data-target]').forEach((element) => element.classList.toggle('active', element.dataset.target === next.name));
  return true;
}
window.selectPartByName = selectPart;

function buildUI() {
  const visibleParts = parts.filter((part) => part.name.startsWith('PART__TURBINE_') || part.name === 'PART__LAKE');
  visibleParts.forEach((part, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.target = part.name;
    const state = part.userData.status ?? (part.name === 'PART__LAKE' ? '水位正常' : 'READY');
    button.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span>${part.userData.display_name ?? part.name}<i>${state}</i>`;
    button.addEventListener('click', () => selectPart(part)); partList.append(button);
  });
  hotspots.forEach((hotspot) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hotspot'; button.dataset.target = hotspot.userData.target;
    const value = hotspot.userData.power_kw ? `${hotspot.userData.power_kw} kW` : hotspot.userData.status;
    button.innerHTML = `<b>${hotspot.userData.display_name}</b><span>${value}</span>`;
    button.addEventListener('click', (event) => { event.stopPropagation(); selectPart(hotspot.userData.target); });
    hotspot.userData.element = button; hotspotLayer.append(button);
  });
}
function attributeBytes(attribute) { return attribute?.array?.byteLength ?? 0; }
function collectMetrics(root) {
  const geometries = new Set(); const textures = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (!geometries.has(object.geometry)) {
      geometries.add(object.geometry); const count = object.geometry.index?.count ?? object.geometry.attributes.position.count;
      metrics.triangles += Math.floor(count / 3); metrics.geometryBytes += attributeBytes(object.geometry.index);
      Object.values(object.geometry.attributes).forEach((attribute) => { metrics.geometryBytes += attributeBytes(attribute); });
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); }));
  });
  textures.forEach((texture) => {
    if (texture.mipmaps?.length) texture.mipmaps.forEach((mip) => { metrics.textureBytes += mip.data?.byteLength ?? 0; });
    else metrics.textureBytes += texture.image?.data?.byteLength ?? ((texture.image?.width ?? 0) * (texture.image?.height ?? 0) * 4);
  });
  metrics.estimatedVRAMMB = Number(((metrics.geometryBytes + metrics.textureBytes) / 1048576).toFixed(2));
}
function configureModel(root) {
  root.traverse((object) => {
    if (object.name.startsWith('PART__')) parts.push(object);
    if (object.name.startsWith('HOTSPOT__')) hotspots.push(object);
    if (object.name.startsWith('ROTOR__')) rotors.push(object);
    if (object.isMesh) {
      object.material = object.material.clone(); object.material.userData.baseEmissive = object.material.emissive.clone();
      object.material.userData.baseEmissiveIntensity = object.material.emissiveIntensity; object.material.envMapIntensity = 0.75;
      if (object.name === 'PART__TERRAIN') {
        const wire = new THREE.LineSegments(new THREE.WireframeGeometry(object.geometry), new THREE.LineBasicMaterial({ color: 0x48fff1, transparent: true, opacity: 0.72, depthWrite: false }));
        wire.matrixAutoUpdate = false; wire.matrix.copy(object.matrix); wireGroup.add(wire);
      }
    }
  });
  const bounds = new THREE.Box3().setFromObject(root); const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
  root.position.copy(center).multiplyScalar(-1); const scale = 11.6 / Math.max(size.x, size.z); modelPivot.scale.setScalar(scale);
  modelPivot.add(root); root.add(wireGroup); collectMetrics(root);
  metrics.parts = parts.length; metrics.hotspots = hotspots.length; metrics.rotors = rotors.length; buildUI();
}
function formatBytes(bytes) { return bytes ? `${(bytes / 1048576).toFixed(2)} MB` : '--'; }
function updateMetricPanel() {
  document.querySelector('#m-size').textContent = formatBytes(metrics.modelBytes);
  document.querySelector('#m-tris').textContent = metrics.triangles.toLocaleString('zh-CN');
  document.querySelector('#m-draws').textContent = String(metrics.drawCalls || '--');
  document.querySelector('#m-vram').textContent = `${metrics.estimatedVRAMMB.toFixed(2)} MB`;
  document.querySelector('#m-fps').textContent = metrics.fps ? `${metrics.fps}` : '--';
}
async function resolveModelBytes() {
  const entry = performance.getEntriesByName(new URL(MODEL_URL, location.href).href).at(-1); if (entry?.encodedBodySize) return entry.encodedBodySize;
  try { const response = await fetch(MODEL_URL, { method: 'HEAD' }); return Number(response.headers.get('content-length')) || 0; } catch { return 0; }
}
const ktx2Loader = new KTX2Loader().setTranscoderPath('./basis/').detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader); const loadStart = performance.now();
gltfLoader.load(MODEL_URL, async (gltf) => {
  configureModel(gltf.scene); metrics.loadMs = Math.round(performance.now() - loadStart); metrics.modelBytes = await resolveModelBytes(); metrics.ready = true;
  loaderElement.classList.add('hidden'); updateMetricPanel(); selectPart('PART__TURBINE_01'); window.dispatchEvent(new CustomEvent('model-ready', { detail: metrics }));
}, undefined, (error) => { metrics.error = String(error?.message ?? error); loaderElement.innerHTML = `<strong>模型加载失败</strong><span>${metrics.error}</span>`; loaderElement.classList.add('error'); console.error(error); });

function updateHotspots() {
  const point = new THREE.Vector3(); const width = viewport.clientWidth; const height = viewport.clientHeight;
  hotspots.forEach((hotspot) => { const element = hotspot.userData.element; if (!element) return; hotspot.getWorldPosition(point); point.project(camera);
    element.hidden = !(point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.08 && Math.abs(point.y) < 1.08);
    element.style.transform = `translate3d(${(point.x * .5 + .5) * width}px, ${(-point.y * .5 + .5) * height}px, 0)`;
  });
}
function updateHover() { if (!metrics.ready) return; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(parts, true)[0]; const next = hit ? partFromHit(hit.object) : null;
  if (next === hoverPart) return; if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, 'default'); hoverPart = next;
  if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, 'hover'); canvas.classList.toggle('interactive', Boolean(hoverPart));
}
canvas.addEventListener('pointermove', (event) => { setPointer(event); updateHover(); });
canvas.addEventListener('pointerleave', () => { pointer.set(2, 2); if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, 'default'); hoverPart = null; canvas.classList.remove('interactive'); });
canvas.addEventListener('click', (event) => { setPointer(event); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(parts, true)[0]; if (hit) selectPart(partFromHit(hit.object)); });
document.querySelector('#reset-camera').addEventListener('click', () => { camera.position.copy(defaultCamera); controls.target.set(0, .45, 0); controls.update(); });
document.querySelector('#toggle-rotate').addEventListener('click', (event) => { controls.autoRotate = !controls.autoRotate; event.currentTarget.classList.toggle('active', controls.autoRotate); });
document.querySelector('#toggle-wire').addEventListener('click', (event) => { metrics.wireframe = !metrics.wireframe; wireGroup.visible = metrics.wireframe; event.currentTarget.classList.toggle('active', metrics.wireframe); });
function resize() { const width = viewport.clientWidth; const height = viewport.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(viewport); resize();
let lastFrame = performance.now();
function animate(now) { requestAnimationFrame(animate); const delta = Math.min((now - lastFrame) / 1000, .05); lastFrame = now; controls.update(delta);
  rotors.forEach((rotor) => { const rpm = Number(rotor.userData.rpm ?? 0); rotor.rotation.y += rpm * Math.PI * 2 / 60 * delta; });
  renderer.render(scene, camera); updateHotspots();
  if (metrics.ready) { fpsFrames += 1; const elapsed = now - fpsStart; if (elapsed >= 1000) { metrics.fps = Math.round(fpsFrames * 1000 / elapsed); metrics.fpsSamples += 1; metrics.drawCalls = renderer.info.render.calls; fpsFrames = 0; fpsStart = now; updateMetricPanel(); } } else fpsStart = now;
}
requestAnimationFrame(animate);
