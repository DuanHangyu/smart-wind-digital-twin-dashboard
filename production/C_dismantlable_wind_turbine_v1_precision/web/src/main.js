import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const MODEL_URL = '/models/C_dismantlable_turbine_low_ktx2.glb';
const canvas = document.querySelector('#viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02090b);
scene.fog = new THREE.FogExp2(0x02090b, .035);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, .01, 100);
camera.position.set(8.2, 5.8, 10.5);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(max-width:850px)').matches ? 1.45 : 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = false;

scene.add(new THREE.HemisphereLight(0xb9ffff, 0x071010, 2.3));
const key = new THREE.DirectionalLight(0xe8ffff, 4.1); key.position.set(-4, 8, 7); scene.add(key);
const rim = new THREE.DirectionalLight(0x16e8df, 4.4); rim.position.set(6, 4, -5); scene.add(rim);
const fill = new THREE.DirectionalLight(0x477dff, 1.7); fill.position.set(-6, 2, -3); scene.add(fill);

const grid = new THREE.GridHelper(18, 36, 0x087f82, 0x0a2d30);
grid.material.transparent = true; grid.material.opacity = .28; grid.position.y = -3.55; scene.add(grid);
const halo = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.24, 128), new THREE.MeshBasicMaterial({ color: 0x14b8b5, transparent: true, opacity: .3, side: THREE.DoubleSide }));
halo.rotation.x = -Math.PI / 2; halo.position.y = -3.53; scene.add(halo);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .065; controls.minDistance = 5; controls.maxDistance = 22;
controls.target.set(0, .2, 0); controls.update();

let assetRoot, shell, rotor, selected, selectedMaterial, wireframe = false, cutaway = false;
const parts = [], hotspots = [], basePositions = new Map(), originalMaterials = new Map();
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const clock = new THREE.Clock();
window.__APP_METRICS = { ready: false, error: null, parts: 0, hotspots: 0, rotors: 0, triangles: 0, drawCalls: 0, modelBytes: 0, estimatedVRAMMB: 0, loadMs: 0, fps: 0, fpsSamples: 0, wireframe: false, cutaway: false, explode: 0, selected: null, gpuRenderer: '' };
const startedAt = performance.now();

function blenderVectorToThree(value) { return new THREE.Vector3(value?.[0] || 0, value?.[2] || 0, -(value?.[1] || 0)); }
function fitAsset(root) {
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  root.position.sub(center); const scale = 7.0 / Math.max(size.x, size.y, size.z); root.scale.setScalar(scale);
  grid.position.y = -size.y * scale * .5 - .03; halo.position.y = grid.position.y + .01;
  controls.target.set(0, .15, 0); camera.position.set(7.9, 5.2, 10.2); controls.update();
}
function calculateMetrics(root, bytes) {
  let triangles = 0, textureBytes = 0;
  const textures = new Set();
  root.traverse(o => { if (!o.isMesh) return; const index = o.geometry.index; triangles += index ? index.count / 3 : o.geometry.attributes.position.count / 3;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { ['map','normalMap','aoMap','roughnessMap','metalnessMap'].forEach(k => { if (m?.[k]) textures.add(m[k]); }); }); });
  textures.forEach(t => { const w=t.image?.width||1024,h=t.image?.height||1024; textureBytes += w*h*1.34; });
  Object.assign(window.__APP_METRICS, { parts: parts.length, hotspots: hotspots.length, rotors: rotor ? 1 : 0, triangles: Math.round(triangles), modelBytes: bytes, estimatedVRAMMB: +(textureBytes/1048576 + triangles*48/1048576).toFixed(2) });
  document.querySelector('#stat-parts').textContent = parts.length; document.querySelector('#stat-tris').textContent = `${Math.round(triangles/1000)}K`; document.querySelector('#model-size').textContent = `${(bytes/1048576).toFixed(2)} MB`;
}
function buildPartList() {
  const host = document.querySelector('#part-list'); host.replaceChildren();
  [...parts].sort((a,b)=>(a.userData.assembly_order||0)-(b.userData.assembly_order||0)).forEach((part,index)=>{
    const button=document.createElement('button'); button.className='part-item'; button.dataset.part=part.name;
    button.innerHTML=`<i>${String(index+1).padStart(2,'0')}</i><span>${part.userData.display_name||part.name}</span><small>${part.userData.part_type||'part'}</small>`;
    button.addEventListener('click',()=>selectPart(part)); host.append(button);
  });
}
function addHotspotMarkers() {
  const geometry = new THREE.SphereGeometry(.045, 12, 8), material = new THREE.MeshBasicMaterial({color:0x65fff5,transparent:true,opacity:.9});
  hotspots.forEach(h=>{ const marker=new THREE.Mesh(geometry,material); marker.name=`MARKER__${h.name}`; marker.userData.hotspotTarget=h.userData.target; h.add(marker); });
}
function selectPart(part) {
  if (!part) return false;
  if (selected && selectedMaterial) selected.material = selectedMaterial;
  selected = part; selectedMaterial = part.material;
  const highlight = part.material.clone(); highlight.emissive = new THREE.Color(0x075f5f); highlight.emissiveIntensity = .8; part.material = highlight;
  document.querySelectorAll('.part-item').forEach(el=>el.classList.toggle('active',el.dataset.part===part.name));
  document.querySelector('#detail-name').textContent=part.userData.display_name||part.name;
  document.querySelector('#detail-node').textContent=part.name;
  document.querySelector('#detail-type').textContent=part.userData.part_type||'--';
  document.querySelector('#detail-material').textContent=part.userData.material_zone||'--';
  document.querySelector('#detail-order').textContent=part.userData.assembly_order??'--';
  document.querySelector('#part-glyph').textContent=(part.userData.display_name||'C').slice(0,1);
  window.__APP_METRICS.selected=part.name; return true;
}
window.selectPartByName = name => selectPart(parts.find(p=>p.name===name));
function setCutaway(enabled) {
  cutaway=enabled; window.__APP_METRICS.cutaway=enabled;
  if (shell) { if (enabled) { const source=originalMaterials.get(shell); const m=source.clone(); m.color.set(0x13b9bd); m.transparent=true; m.opacity=.20; m.depthWrite=false; m.roughness=.12; m.metalness=.10; m.side=THREE.DoubleSide; shell.material=m; }
    else shell.material=originalMaterials.get(shell); }
  document.querySelector('#mode-exterior').classList.toggle('active',!enabled); document.querySelector('#mode-cutaway').classList.toggle('active',enabled);
}
function setExplode(value) {
  const factor=Number(value); parts.forEach(part=>{ const base=basePositions.get(part); if(!base)return; part.position.copy(base).add(blenderVectorToThree(part.userData.explode_vector).multiplyScalar(factor)); });
  document.querySelector('#explode-range').value=String(factor); document.querySelector('#mode-explode').classList.toggle('active',factor>.01); window.__APP_METRICS.explode=factor;
}
function setWire(enabled){wireframe=enabled; parts.forEach(part=>{const mats=Array.isArray(part.material)?part.material:[part.material];mats.forEach(m=>m.wireframe=enabled);});document.querySelector('#toggle-wire').classList.toggle('active',enabled);window.__APP_METRICS.wireframe=enabled;}
function resetView(){setExplode(0);setCutaway(false);setWire(false);camera.position.set(7.9,5.2,10.2);controls.target.set(0,.15,0);controls.update();}

const ktx2=new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
const loader=new GLTFLoader().setKTX2Loader(ktx2);
fetch(MODEL_URL).then(r=>{if(!r.ok)throw new Error(`GLB HTTP ${r.status}`);const total=Number(r.headers.get('content-length'))||0;return r.arrayBuffer().then(b=>({b,total:total||b.byteLength}));}).then(({b,total})=>{
  document.querySelector('#loader-progress').textContent='100%'; loader.parse(b,'/',gltf=>{
    assetRoot=gltf.scene; scene.add(assetRoot); assetRoot.traverse(o=>{ if(o.name.startsWith('PART__')&&o.isMesh){parts.push(o);basePositions.set(o,o.position.clone());originalMaterials.set(o,o.material);} if(o.name.startsWith('HOTSPOT__'))hotspots.push(o);if(o.name.startsWith('ROTOR__'))rotor=o; });
    shell=parts.find(p=>p.name==='PART__NACELLE_SHELL'); fitAsset(assetRoot); addHotspotMarkers(); buildPartList(); calculateMetrics(assetRoot,total);
    window.__APP_METRICS.loadMs=Math.round(performance.now()-startedAt); window.__APP_METRICS.ready=true; document.querySelector('#loader').classList.add('hidden');
  },e=>fail(e));
}).catch(fail);
function fail(error){console.error(error);window.__APP_METRICS.error=String(error);const el=document.querySelector('#error');el.hidden=false;el.textContent=`模型加载失败：${error}`;document.querySelector('#loader').classList.add('hidden');}

document.querySelector('#mode-exterior').addEventListener('click',()=>setCutaway(false));
document.querySelector('#mode-cutaway').addEventListener('click',()=>setCutaway(true));
document.querySelector('#mode-explode').addEventListener('click',()=>setExplode(window.__APP_METRICS.explode>.01?0:1));
document.querySelector('#toggle-wire').addEventListener('click',()=>setWire(!wireframe));
document.querySelector('#reset-view').addEventListener('click',resetView);
document.querySelector('#explode-range').addEventListener('input',e=>setExplode(e.target.value));
canvas.addEventListener('pointerup',event=>{ const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(parts,true)[0];if(hit){let target=hit.object;while(target&&!parts.includes(target))target=target.parent;if(target)selectPart(target);}});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(max-width:850px)').matches?1.45:1.8));});

let frames=0,acc=0,lastFps=performance.now();
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);if(rotor)rotor.rotation.z+=dt*.12;controls.update();halo.rotation.z+=dt*.08;renderer.render(scene,camera);frames++;const now=performance.now();if(now-lastFps>=1000){const fps=frames*1000/(now-lastFps);acc+=fps;window.__APP_METRICS.fpsSamples++;window.__APP_METRICS.fps=+((acc/window.__APP_METRICS.fpsSamples).toFixed(1));window.__APP_METRICS.drawCalls=renderer.info.render.calls;document.querySelector('#stat-fps').textContent=Math.round(fps);frames=0;lastFps=now;}}
try{const gl=renderer.getContext();window.__APP_METRICS.gpuRenderer=gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);}catch{}
animate();
