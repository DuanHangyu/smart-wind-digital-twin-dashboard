import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const MODEL_URL = './models/A_custom_map_low_ktx2.glb';
const MOBILE = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const canvas = document.querySelector('#scene');
const viewport = document.querySelector('#viewport');
const hotspotLayer = document.querySelector('#hotspots');
const loaderElement = document.querySelector('#loader');
const regionList = document.querySelector('#region-list');

const metrics = window.__APP_METRICS = {
  ready: false,
  error: null,
  deviceProfile: MOBILE ? 'mobile' : 'desktop',
  modelBytes: 0,
  loadMs: 0,
  triangles: 0,
  drawCalls: 0,
  geometryBytes: 0,
  textureBytes: 0,
  estimatedVRAMMB: 0,
  parts: 0,
  hotspots: 0,
  fps: 0,
  fpsSamples: 0,
  gpuRenderer: 'unknown',
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02090b);
scene.fog = new THREE.FogExp2(0x02090b, 0.032);

const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
const defaultCamera = MOBILE
  ? new THREE.Vector3(0, 8.9, 12.4)
  : new THREE.Vector3(0, 7.3, 11.4);
camera.position.copy(defaultCamera);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !MOBILE,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.35 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
const debugRendererInfo = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
if (debugRendererInfo) {
  metrics.gpuRenderer = renderer.getContext().getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL);
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 7;
controls.maxDistance = 23;
controls.minPolarAngle = 0.42;
controls.maxPolarAngle = 1.36;
controls.target.set(0, 0.2, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.45;

scene.add(new THREE.HemisphereLight(0x8ffcff, 0x03151a, 2.1));
const keyLight = new THREE.DirectionalLight(0xd9ffff, 4.4);
keyLight.position.set(-5, 9, 6);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x00d9ff, 18, 30, 2);
rimLight.position.set(6, 5, -4);
scene.add(rimLight);

const grid = new THREE.GridHelper(30, 48, 0x075f68, 0x053036);
grid.position.y = -0.46;
grid.material.transparent = true;
grid.material.opacity = 0.28;
scene.add(grid);

const modelPivot = new THREE.Group();
modelPivot.name = 'MODEL_AUTO_CENTER_SCALE';
scene.add(modelPivot);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(2, 2);
const parts = [];
const hotspots = [];
let selectedPart = null;
let hoverPart = null;
let modelScale = 1;
let fpsStart = performance.now();
let fpsFrames = 0;

const setPointer = (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
};

function partFromHit(object) {
  let current = object;
  while (current && !current.name.startsWith('PART__')) current = current.parent;
  return current;
}

function setPartVisual(part, state) {
  if (!part) return;
  const lift = state === 'selected' ? 0.24 : state === 'hover' ? 0.09 : 0;
  part.position.y = part.userData.baseY + lift;
  part.traverse((child) => {
    if (!child.isMesh) return;
    const material = child.material;
    if (state === 'selected') {
      material.emissive.setHex(0x00d9ff);
      material.emissiveIntensity = 0.78;
    } else if (state === 'hover') {
      material.emissive.setHex(0x00a9bd);
      material.emissiveIntensity = 0.5;
    } else {
      material.emissive.copy(material.userData.baseEmissive);
      material.emissiveIntensity = material.userData.baseEmissiveIntensity;
    }
  });
}

function updateDetail(part) {
  const data = part?.userData ?? {};
  const value = Number(data.data_value ?? 0);
  document.querySelector('#detail-name').textContent = data.display_name ?? part?.name ?? '请选择区域';
  document.querySelector('#detail-value').textContent = value ? `${value}%` : '--';
  document.querySelector('#detail-bar').style.width = `${value}%`;
  document.querySelector('#detail-id').textContent = part
    ? `${part.name} · ${data.hotspot ?? 'HOTSPOT READY'}`
    : 'HOTSPOT / PART 节点均已就绪';
}

function selectPart(partOrName) {
  const next = typeof partOrName === 'string'
    ? parts.find((part) => part.name === partOrName)
    : partOrName;
  if (!next) return false;
  if (selectedPart && selectedPart !== next) setPartVisual(selectedPart, 'default');
  selectedPart = next;
  setPartVisual(selectedPart, 'selected');
  updateDetail(selectedPart);
  document.querySelectorAll('[data-target]').forEach((element) => {
    element.classList.toggle('active', element.dataset.target === selectedPart.name);
  });
  return true;
}
window.selectPartByName = selectPart;

function buildRegionUI() {
  const fragment = document.createDocumentFragment();
  parts.forEach((part) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.target = part.name;
    button.innerHTML = `<span>${part.userData.region_id}</span>${part.userData.display_name}<i>${part.userData.data_value}</i>`;
    button.addEventListener('click', () => selectPart(part));
    fragment.append(button);
  });
  regionList.append(fragment);

  hotspots.forEach((hotspot) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hotspot';
    button.dataset.target = hotspot.userData.target;
    button.innerHTML = `<b>${hotspot.userData.display_name}</b><span>${hotspot.userData.data_value}</span>`;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      selectPart(hotspot.userData.target);
    });
    hotspot.userData.element = button;
    hotspotLayer.append(button);
  });
}

function bytesForAttribute(attribute) {
  return attribute?.array?.byteLength ?? 0;
}

function collectAssetMetrics(root) {
  const geometries = new Set();
  const textures = new Set();
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    if (!geometries.has(geometry)) {
      geometries.add(geometry);
      const count = geometry.index?.count ?? geometry.attributes.position.count;
      triangles += Math.floor(count / 3);
      metrics.geometryBytes += bytesForAttribute(geometry.index);
      Object.values(geometry.attributes).forEach((attribute) => {
        metrics.geometryBytes += bytesForAttribute(attribute);
      });
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
    });
  });
  textures.forEach((texture) => {
    if (texture.mipmaps?.length) {
      texture.mipmaps.forEach((mipmap) => { metrics.textureBytes += mipmap.data?.byteLength ?? 0; });
    } else {
      const image = texture.image;
      metrics.textureBytes += image?.data?.byteLength ?? ((image?.width ?? 0) * (image?.height ?? 0) * 4);
    }
  });
  metrics.triangles = triangles;
  metrics.estimatedVRAMMB = Number(((metrics.geometryBytes + metrics.textureBytes) / 1048576).toFixed(2));
}

function configureModel(root) {
  root.traverse((object) => {
    if (object.name.startsWith('PART__')) {
      object.userData.baseY = object.position.y;
      parts.push(object);
    }
    if (object.name.startsWith('HOTSPOT__')) hotspots.push(object);
    if (object.isMesh) {
      object.material = object.material.clone();
      object.material.userData.baseEmissive = object.material.emissive.clone();
      object.material.userData.baseEmissiveIntensity = object.material.emissiveIntensity;
      object.material.envMapIntensity = 0.85;
    }
  });

  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  modelScale = 10.5 / Math.max(size.x, size.z);
  root.position.copy(center).multiplyScalar(-1);
  modelPivot.scale.setScalar(modelScale);
  modelPivot.add(root);
  if (MOBILE) {
    const scaledRadius = 0.5 * Math.hypot(size.x * modelScale, size.y * modelScale, size.z * modelScale);
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect);
    const fitDistance = (scaledRadius / Math.sin(Math.min(halfVerticalFov, halfHorizontalFov))) * 0.96;
    defaultCamera.normalize().multiplyScalar(fitDistance);
    camera.position.copy(defaultCamera);
    controls.minDistance = fitDistance * 0.36;
    controls.maxDistance = fitDistance * 1.7;
    controls.update();
  }
  collectAssetMetrics(root);
  metrics.parts = parts.length;
  metrics.hotspots = hotspots.length;
  buildRegionUI();
}

function formatBytes(bytes) {
  return bytes ? `${(bytes / 1048576).toFixed(2)} MB` : '--';
}

function updateMetricPanel() {
  document.querySelector('#m-size').textContent = formatBytes(metrics.modelBytes);
  document.querySelector('#m-tris').textContent = metrics.triangles.toLocaleString('zh-CN');
  document.querySelector('#m-draws').textContent = String(metrics.drawCalls || '--');
  document.querySelector('#m-vram').textContent = `${metrics.estimatedVRAMMB.toFixed(2)} MB`;
  document.querySelector('#m-fps').textContent = metrics.fps ? `${metrics.fps}` : '--';
}

async function resolveModelBytes() {
  const entry = performance.getEntriesByName(new URL(MODEL_URL, location.href).href).at(-1);
  if (entry?.encodedBodySize) return entry.encodedBodySize;
  try {
    const response = await fetch(MODEL_URL, { method: 'HEAD' });
    return Number(response.headers.get('content-length')) || 0;
  } catch {
    return 0;
  }
}

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('./basis/')
  .detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader);
const loadStartedAt = performance.now();

gltfLoader.load(
  MODEL_URL,
  async (gltf) => {
    configureModel(gltf.scene);
    metrics.loadMs = Math.round(performance.now() - loadStartedAt);
    metrics.modelBytes = await resolveModelBytes();
    metrics.ready = true;
    loaderElement.classList.add('hidden');
    updateMetricPanel();
    selectPart(parts[5] ?? parts[0]);
    window.dispatchEvent(new CustomEvent('model-ready', { detail: metrics }));
  },
  undefined,
  (error) => {
    metrics.error = String(error?.message ?? error);
    loaderElement.innerHTML = `<strong>模型加载失败</strong><span>${metrics.error}</span>`;
    loaderElement.classList.add('error');
    console.error(error);
  },
);

function updateHotspots() {
  const point = new THREE.Vector3();
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  hotspots.forEach((hotspot) => {
    const element = hotspot.userData.element;
    if (!element) return;
    hotspot.getWorldPosition(point);
    point.project(camera);
    const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.08 && Math.abs(point.y) < 1.08;
    element.hidden = !visible;
    element.style.transform = `translate3d(${(point.x * 0.5 + 0.5) * width}px, ${(-point.y * 0.5 + 0.5) * height}px, 0)`;
  });
}

function updateHover() {
  if (!metrics.ready) return;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(parts, true)[0];
  const next = hit ? partFromHit(hit.object) : null;
  if (next === hoverPart) return;
  if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, 'default');
  hoverPart = next;
  if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, 'hover');
  canvas.classList.toggle('interactive', Boolean(hoverPart));
}

canvas.addEventListener('pointermove', (event) => {
  setPointer(event);
  updateHover();
});
canvas.addEventListener('pointerleave', () => {
  pointer.set(2, 2);
  if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, 'default');
  hoverPart = null;
  canvas.classList.remove('interactive');
});
canvas.addEventListener('click', (event) => {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(parts, true)[0];
  if (hit) selectPart(partFromHit(hit.object));
});

document.querySelector('#reset-camera').addEventListener('click', () => {
  camera.position.copy(defaultCamera);
  controls.target.set(0, 0.2, 0);
  controls.update();
});
document.querySelector('#toggle-rotate').addEventListener('click', (event) => {
  controls.autoRotate = !controls.autoRotate;
  event.currentTarget.classList.toggle('active', controls.autoRotate);
});

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  controls.update(delta);
  renderer.render(scene, camera);
  updateHotspots();

  if (metrics.ready) {
    fpsFrames += 1;
    const elapsed = now - fpsStart;
    if (elapsed >= 1000) {
      metrics.fps = Math.round((fpsFrames * 1000) / elapsed);
      metrics.fpsSamples += 1;
      metrics.drawCalls = renderer.info.render.calls;
      fpsFrames = 0;
      fpsStart = now;
      updateMetricPanel();
    }
  } else {
    fpsStart = now;
  }
}
requestAnimationFrame(animate);
