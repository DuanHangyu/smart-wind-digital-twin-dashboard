"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Texture,
  Vector3,
} from "three";
import type { TurbineRecord, WindfarmSceneState } from "../../types/dashboard";

type LoadState = "loading" | "ready" | "error" | "unsupported";
type VisualState = "default" | "hover" | "selected";
type CameraPreset = "overview" | "max" | "focus-turbine";

// The overview reproduces the target composition: lake in the foreground,
// three turbines across the middle distance, and enough air above the ridges.
const WINDFARM_CAMERA_OVERVIEW_DESKTOP = [-1.1, 5.55, 7.25] as const;
const WINDFARM_CAMERA_OVERVIEW_TOUCH = [-1.05, 5.75, 7.75] as const;
const WINDFARM_CAMERA_OVERVIEW_TARGET = [0, -0.48, 0] as const;
const WINDFARM_CAMERA_MAX_DESKTOP = [0, 3.4, 5.45] as const;
const WINDFARM_CAMERA_MAX_TOUCH = [0, 3.55, 5.75] as const;
const WINDFARM_CAMERA_MAX_TARGET = [0, 0.78, 0] as const;

const TURBINE_LINKS = [
  { modelCode: "01", turbineId: "T-A04", target: "PART__TURBINE_01" },
  { modelCode: "02", turbineId: "T-A01", target: "PART__TURBINE_02" },
  { modelCode: "03", turbineId: "T-A02", target: "PART__TURBINE_03" },
] as const;

type SceneController = {
  selectTurbine: (turbineId: string | null) => void;
  hoverTarget: (target: string | null) => void;
  setProjectionEnabled: (enabled: boolean) => void;
  setWaterVisible: (visible: boolean) => void;
  setCameraPreset: (preset: Exclude<CameraPreset, "focus-turbine">) => void;
  resetCamera: () => void;
};

type InteractivePart = Object3D & {
  userData: {
    display_name?: string;
    power_kw?: number;
    targetY?: number;
  };
};

const STATUS_LABEL = {
  normal: "正常",
  running: "运行中",
  standby: "待机",
  offline: "离线",
  fault: "故障",
  abnormal: "异常",
} as const;

function webGlAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function partFromHit(object: Object3D | null) {
  let current = object;
  while (current && !current.name.startsWith("PART__")) current = current.parent;
  if (!current || (!current.name.startsWith("PART__TURBINE_") && current.name !== "PART__LAKE")) return null;
  return current as InteractivePart;
}

function turbineIdFromTarget(target: string) {
  return TURBINE_LINKS.find((item) => item.target === target)?.turbineId ?? null;
}

function targetFromTurbineId(turbineId: string | null) {
  return TURBINE_LINKS.find((item) => item.turbineId === turbineId)?.target ?? null;
}

export function WindFarmTerrainScene({
  turbines,
  state,
  onTurbineSelect,
}: {
  turbines: TurbineRecord[];
  state: WindfarmSceneState;
  onTurbineSelect: (turbineId: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const stateRef = useRef(state);
  const turbinesRef = useRef(turbines);
  const selectCallbackRef = useRef(onTurbineSelect);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [progress, setProgress] = useState(0);
  const [cameraPreset, setCameraPresetState] = useState<CameraPreset>("overview");

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { turbinesRef.current = turbines; }, [turbines]);
  useEffect(() => { selectCallbackRef.current = onTurbineSelect; }, [onTurbineSelect]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    if (!webGlAvailable()) {
      const frame = window.requestAnimationFrame(() => setLoadState("unsupported"));
      return () => window.cancelAnimationFrame(frame);
    }

    let disposed = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: import("three").WebGLRenderer | null = null;
    let controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls | null = null;
    let ktx2Loader: import("three/examples/jsm/loaders/KTX2Loader.js").KTX2Loader | null = null;
    const cleanups: Array<() => void> = [];

    const initialize = async () => {
      try {
        const [THREE, { GLTFLoader }, { KTX2Loader }, { OrbitControls }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/loaders/KTX2Loader.js"),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ]);
        if (disposed) return;

        const scene = new THREE.Scene();
        const fog = new THREE.FogExp2(0xc6d0cb, 0.045);
        scene.fog = fog;
        const camera: PerspectiveCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
        const coarsePointer = matchMedia("(pointer: coarse)").matches;
        const defaultCamera = new THREE.Vector3(...(
          coarsePointer ? WINDFARM_CAMERA_OVERVIEW_TOUCH : WINDFARM_CAMERA_OVERVIEW_DESKTOP
        ));
        const defaultTarget = new THREE.Vector3(...WINDFARM_CAMERA_OVERVIEW_TARGET);
        const cameraGoal = defaultCamera.clone();
        const targetGoal = defaultTarget.clone();
        camera.position.copy(defaultCamera);

        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: !coarsePointer,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, coarsePointer ? 1.25 : 1.8));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.02;

        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.065;
        controls.minDistance = 5.1;
        controls.maxDistance = 26;
        controls.minPolarAngle = 0.32;
        controls.maxPolarAngle = 1.42;
        controls.target.copy(defaultTarget);
        controls.autoRotate = false;

        const preserveManualCamera = () => {
          cameraGoal.copy(camera.position);
          if (controls) targetGoal.copy(controls.target);
          setCameraPresetState("overview");
        };
        controls.addEventListener("start", preserveManualCamera);
        cleanups.push(() => {
          controls?.removeEventListener("start", preserveManualCamera);
        });

        scene.add(new THREE.HemisphereLight(0xe9eee9, 0x1c2c22, 1.55));
        const keyLight = new THREE.DirectionalLight(0xf6f5ed, 1.65);
        keyLight.position.set(-6, 10, 7);
        scene.add(keyLight);
        const rimLight = new THREE.PointLight(0x78cfc0, 0.48, 30, 2);
        rimLight.position.set(7, 6, -5);
        scene.add(rimLight);

        const grid = new THREE.GridHelper(32, 50, 0x087a79, 0x063638);
        grid.position.y = -0.42;
        const gridMaterial = grid.material as Material;
        gridMaterial.transparent = true;
        gridMaterial.opacity = 0.12;
        scene.add(grid);

        const pivot = new THREE.Group();
        pivot.name = "MODEL_AUTO_CENTER_SCALE";
        scene.add(pivot);
        const wireGroup = new THREE.Group();
        wireGroup.name = "RUNTIME__HOLOGRAPHIC_WIREFRAME";
        wireGroup.visible = stateRef.current.projectionEnabled;

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2(2, 2);
        const parts: InteractivePart[] = [];
        const partByTarget = new Map<string, InteractivePart>();
        const hotspots = new Map<string, Object3D>();
        const rotors = new Map<string, { axis: Vector3; object: Object3D }>();
        const projectionAccentMaterials = new Set<MeshStandardMaterial>();
        const blenderAxisToGltf = (axis: unknown) => {
          // Blender exports Z-up coordinates to glTF's Y-up system:
          // source +X -> glTF +X, source +Y -> glTF -Z, source +Z -> glTF +Y.
          if (axis === "X") return new THREE.Vector3(1, 0, 0);
          if (axis === "Y") return new THREE.Vector3(0, 0, -1);
          if (axis === "Z") return new THREE.Vector3(0, 1, 0);
          return new THREE.Vector3(0, 0, -1);
        };
        let lakePart: InteractivePart | null = null;
        const baseMeshes: Mesh[] = [];
        const terrainMeshes: Mesh[] = [];
        const originalTerrainMaterials = new Map<Mesh, Material | Material[]>();
        const wireLines: import("three").LineSegments[] = [];
        let projectionTerrainMaterial: MeshStandardMaterial | null = null;
        let projectionShader: { uniforms: { uProjectionTime: { value: number } } } | null = null;
        let projectionActive = stateRef.current.projectionEnabled;
        let selectedPart: InteractivePart | null = null;
        let hoverPart: InteractivePart | null = null;
        let pointerDown = { x: 0, y: 0 };

        const setCameraPreset = (preset: Exclude<CameraPreset, "focus-turbine">) => {
          const position = preset === "max"
            ? (coarsePointer ? WINDFARM_CAMERA_MAX_TOUCH : WINDFARM_CAMERA_MAX_DESKTOP)
            : (coarsePointer ? WINDFARM_CAMERA_OVERVIEW_TOUCH : WINDFARM_CAMERA_OVERVIEW_DESKTOP);
          const target = preset === "max" ? WINDFARM_CAMERA_MAX_TARGET : WINDFARM_CAMERA_OVERVIEW_TARGET;
          cameraGoal.set(...position);
          targetGoal.set(...target);
          setCameraPresetState(preset);
        };

        const focusSelectedTurbine = (_target: string) => {
          void _target;
          // The reference keeps the entire wind farm in frame while the anchored
          // information card opens. Selection must not turn into a camera zoom.
          setCameraPreset("overview");
        };

        const setPointer = (event: PointerEvent | MouseEvent) => {
          const rect = canvas.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        };

        const setPartVisual = (part: InteractivePart, visual: VisualState) => {
          part.traverse((child) => {
            const mesh = child as Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((entry) => {
              const material = entry as MeshStandardMaterial;
              if (!material.emissive) return;
              if (visual === "selected") {
                material.emissive.setHex(part.name === "PART__LAKE" ? 0x00b8ff : 0x10d8ca);
                material.emissiveIntensity = part.name === "PART__LAKE" ? 0.36 : 0.14;
              } else if (visual === "hover") {
                material.emissive.setHex(0x087e7b);
                material.emissiveIntensity = 0.24;
              } else if (projectionActive && part.name !== "PART__LAKE") {
                material.emissive.setHex(0x00bdb6);
                material.emissiveIntensity = 0.58;
              } else {
                material.emissive.copy(material.userData.baseEmissive);
                material.emissiveIntensity = material.userData.baseEmissiveIntensity;
              }
            });
          });
        };

        const selectTarget = (target: string | null) => {
          const next = target ? partByTarget.get(target) ?? null : null;
          if (next === selectedPart) {
            if (target?.startsWith("PART__TURBINE_")) focusSelectedTurbine(target);
            return;
          }
          if (selectedPart) setPartVisual(selectedPart, "default");
          selectedPart = next;
          if (selectedPart) {
            setPartVisual(selectedPart, "selected");
            if (selectedPart.name.startsWith("PART__TURBINE_")) focusSelectedTurbine(selectedPart.name);
          } else {
            setCameraPreset("overview");
          }
        };

        const hoverTarget = (target: string | null) => {
          const next = target ? partByTarget.get(target) ?? null : null;
          if (next === hoverPart) return;
          if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, "default");
          hoverPart = next;
          if (hoverPart && hoverPart !== selectedPart) setPartVisual(hoverPart, "hover");
          canvas.classList.toggle("interactive", Boolean(hoverPart));
        };

        ktx2Loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
        const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader);
        gltfLoader.load(
          "/models/windfarm.glb",
          (gltf) => {
            if (disposed) return;
            const root = gltf.scene;
            const belongsToPart = (object: Object3D, partName: string) => {
              let current: Object3D | null = object;
              while (current) {
                if (current.name === partName) return true;
                current = current.parent;
              }
              return false;
            };
            root.traverse((object) => {
              if (object.name.startsWith("PART__TURBINE_") || object.name === "PART__LAKE") {
                const part = object as InteractivePart;
                parts.push(part);
                partByTarget.set(part.name, part);
                if (part.name === "PART__LAKE") lakePart = part;
              }
              if (object.name.startsWith("HOTSPOT__")) {
                const target = object.userData.target as string | undefined;
                if (target) hotspots.set(target, object);
              }
              if (object.name.startsWith("ROTOR__TURBINE_")) {
                rotors.set(object.name.slice(-2), {
                  axis: blenderAxisToGltf(object.userData.rotor_axis),
                  object,
                });
              }
              const mesh = object as Mesh;
              if (!mesh.isMesh) return;
              const isTerrainMesh = belongsToPart(object, "PART__TERRAIN");
              const isBaseMesh = belongsToPart(object, "PART__BASE");
              const isLakeMesh = belongsToPart(object, "PART__LAKE");
              const isTurbineMesh = TURBINE_LINKS.some((link) => belongsToPart(object, link.target));
              if (isTerrainMesh) terrainMeshes.push(mesh);
              if (isBaseMesh) baseMeshes.push(mesh);
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              const cloned = materials.map((entry) => {
                const material = entry.clone() as MeshStandardMaterial;
                if (isTerrainMesh) {
                  material.color.setHex(0x91a879);
                  material.metalness = 0;
                  material.roughness = 0.98;
                  material.emissive.setHex(0x0a130c);
                  material.emissiveIntensity = 0.055;
                } else if (isLakeMesh) {
                  material.color.setHex(0x71888d);
                  material.metalness = 0.04;
                  material.roughness = 0.56;
                  material.emissive.setHex(0x071314);
                  material.emissiveIntensity = 0.04;
                } else if (isTurbineMesh) {
                  material.color.multiplyScalar(0.82);
                  material.metalness = Math.min(material.metalness, 0.08);
                  material.roughness = Math.max(material.roughness, 0.82);
                  material.emissive.multiplyScalar(0.34);
                  material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.08);
                } else if (material.color) {
                  material.color.multiplyScalar(0.96);
                  material.roughness = Math.max(material.roughness, 0.66);
                }
                if (material.emissive) {
                  material.userData.baseEmissive = material.emissive.clone();
                  material.userData.baseEmissiveIntensity = material.emissiveIntensity;
                  material.userData.baseColor = material.color.clone();
                  material.userData.baseOpacity = material.opacity;
                  material.userData.baseTransparent = material.transparent;
                  if (isTurbineMesh) projectionAccentMaterials.add(material);
                }
                return material;
              });
              mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
            });

            if (terrainMeshes.length) {
              projectionTerrainMaterial = new THREE.MeshStandardMaterial({
                blending: THREE.NormalBlending,
                color: 0x000405,
                depthWrite: true,
                emissive: 0x003f3d,
                emissiveIntensity: 0.12,
                metalness: 0,
                opacity: 0.12,
                roughness: 0.78,
                side: THREE.DoubleSide,
                transparent: true,
                wireframe: false,
              });
              projectionTerrainMaterial.onBeforeCompile = (shader) => {
                shader.uniforms.uProjectionTime = { value: 0 };
                projectionShader = shader as typeof projectionShader;
                shader.vertexShader = shader.vertexShader
                  .replace("#include <common>", "#include <common>\nvarying vec3 vProjectionPosition;")
                  .replace("#include <begin_vertex>", "#include <begin_vertex>\nvProjectionPosition = position;");
                shader.fragmentShader = shader.fragmentShader
                  .replace(
                    "#include <common>",
                    "#include <common>\nvarying vec3 vProjectionPosition;\nuniform float uProjectionTime;",
                  )
                  .replace(
                    "#include <emissivemap_fragment>",
                    `#include <emissivemap_fragment>
                    float scanWave = pow(max(0.0, sin(vProjectionPosition.y * 18.0 - uProjectionTime * 1.35)), 18.0);
                    float ridgeFresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
                    totalEmissiveRadiance += vec3(0.0, 0.28, 0.27) * (scanWave * 0.34 + ridgeFresnel * 0.12);`,
                  );
              };
              terrainMeshes.forEach((mesh) => {
                originalTerrainMaterials.set(mesh, mesh.material);
                // The target uses a continuous triangular topology. Rendering the terrain's
                // real edge network at low alpha is both more faithful and avoids stripe artifacts.
                const hologramWireGeometry = new THREE.WireframeGeometry(mesh.geometry);
                const lines = new THREE.LineSegments(
                  hologramWireGeometry,
                  new THREE.LineBasicMaterial({
                    blending: THREE.AdditiveBlending,
                    color: 0x2cfff3,
                    depthTest: true,
                    depthWrite: false,
                    opacity: 0.66,
                    transparent: true,
                  }),
                );
                lines.renderOrder = 5;
                lines.visible = stateRef.current.projectionEnabled;
                mesh.add(lines);
                wireLines.push(lines);
              });
              root.add(wireGroup);
            }

            const bounds = new THREE.Box3().setFromObject(root);
            const center = bounds.getCenter(new THREE.Vector3());
            const size = bounds.getSize(new THREE.Vector3());
            root.position.copy(center).multiplyScalar(-1);
            pivot.scale.setScalar(12.4 / Math.max(size.x, size.z));
            pivot.add(root);

            const applyProjectionLook = (enabled: boolean) => {
              projectionActive = enabled;
              wireGroup.visible = enabled;
              grid.visible = !enabled;
              fog.color.setHex(enabled ? 0x000708 : 0xc6d0cb);
              fog.density = enabled ? 0.018 : 0.045;
              if (renderer) renderer.toneMappingExposure = enabled ? 1.08 : 1.02;
              wireLines.forEach((lines) => { lines.visible = enabled; });
              baseMeshes.forEach((mesh) => { mesh.visible = !enabled; });
              terrainMeshes.forEach((mesh) => {
                const original = originalTerrainMaterials.get(mesh);
                if (original && projectionTerrainMaterial) mesh.material = enabled ? projectionTerrainMaterial : original;
              });
              projectionAccentMaterials.forEach((material) => {
                if (enabled) {
                  material.color.setHex(0x42d8cf);
                  material.emissive.setHex(0x00bdb6);
                  material.emissiveIntensity = 0.58;
                  material.opacity = 0.76;
                  material.transparent = true;
                } else {
                  material.color.copy(material.userData.baseColor);
                  material.emissive.copy(material.userData.baseEmissive);
                  material.emissiveIntensity = material.userData.baseEmissiveIntensity;
                  material.opacity = material.userData.baseOpacity;
                  material.transparent = material.userData.baseTransparent;
                }
                material.needsUpdate = true;
              });
              if (lakePart) lakePart.visible = !enabled && stateRef.current.waterVisible;
              if (selectedPart) setPartVisual(selectedPart, "selected");
            };

            if (lakePart) lakePart.visible = stateRef.current.waterVisible;
            applyProjectionLook(stateRef.current.projectionEnabled);
            selectTarget(targetFromTurbineId(stateRef.current.selectedTurbineId));
            controllerRef.current = {
              selectTurbine(turbineId) { selectTarget(targetFromTurbineId(turbineId)); },
              hoverTarget,
              setProjectionEnabled: applyProjectionLook,
              setWaterVisible(visible) {
                if (lakePart) lakePart.visible = visible && !projectionActive;
                const label = labelRefs.current.PART__LAKE;
                if (label) label.hidden = !visible || projectionActive;
              },
              setCameraPreset,
              resetCamera() {
                setCameraPreset("overview");
              },
            };
            setProgress(100);
            setLoadState("ready");
          },
          (event) => {
            if (disposed || !event.total) return;
            setProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
          },
          () => { if (!disposed) setLoadState("error"); },
        );

        const updateHover = () => {
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(parts, true)[0];
          hoverTarget(partFromHit(hit?.object ?? null)?.name ?? null);
        };
        const handlePointerDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
        const handlePointerMove = (event: PointerEvent) => { setPointer(event); updateHover(); };
        const handlePointerLeave = () => { pointer.set(2, 2); hoverTarget(null); };
        const handleClick = (event: MouseEvent) => {
          if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return;
          setPointer(event);
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(parts, true)[0];
          const part = partFromHit(hit?.object ?? null);
          if (!part) {
            selectTarget(null);
            selectCallbackRef.current(null);
            return;
          }
          if (part.name.startsWith("PART__TURBINE_")) {
            selectTarget(part.name);
            selectCallbackRef.current(turbineIdFromTarget(part.name));
          } else {
            selectTarget(null);
            selectCallbackRef.current(null);
          }
        };
        canvas.addEventListener("pointerdown", handlePointerDown);
        canvas.addEventListener("pointermove", handlePointerMove);
        canvas.addEventListener("pointerleave", handlePointerLeave);
        canvas.addEventListener("click", handleClick);
        cleanups.push(() => {
          canvas.removeEventListener("pointerdown", handlePointerDown);
          canvas.removeEventListener("pointermove", handlePointerMove);
          canvas.removeEventListener("pointerleave", handlePointerLeave);
          canvas.removeEventListener("click", handleClick);
        });

        const resize = () => {
          if (!renderer) return;
          const width = host.clientWidth;
          const height = host.clientHeight;
          renderer.setSize(width, height, false);
          camera.aspect = width / Math.max(1, height);
          camera.updateProjectionMatrix();
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        resize();

        const projected = new THREE.Vector3();
        let lastFrame = performance.now();
        const animate = (now: number) => {
          if (disposed || !renderer) return;
          animationFrame = window.requestAnimationFrame(animate);
          const delta = Math.min((now - lastFrame) / 1000, 0.05);
          lastFrame = now;
          rotors.forEach(({ axis, object: rotor }, modelCode) => {
            const turbineId = TURBINE_LINKS.find((item) => item.modelCode === modelCode)?.turbineId;
            const turbine = turbinesRef.current.find((item) => item.id === turbineId);
            if (!turbine || turbine.status === "offline") return;
            const sourceRpm = Number(rotor.userData.rpm ?? 0);
            rotor.rotateOnAxis(axis, sourceRpm * Math.PI * 2 / 60 * delta);
          });
          if (projectionShader) projectionShader.uniforms.uProjectionTime.value = now / 1000;
          const cameraEase = 1 - Math.exp(-delta * 4.8);
          camera.position.lerp(cameraGoal, cameraEase);
          controls?.target.lerp(targetGoal, cameraEase);
          controls?.update(delta);
          renderer.render(scene, camera);

          hotspots.forEach((hotspot, target) => {
            const element = labelRefs.current[target];
            if (!element) return;
            hotspot.getWorldPosition(projected);
            projected.project(camera);
            const inView = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08;
            const visible = !projectionActive && inView && (
              target !== "PART__LAKE"
              || (stateRef.current.waterVisible && !projectionActive)
            );
            element.hidden = !visible;
            if (visible) element.style.transform = `translate3d(${(projected.x * 0.5 + 0.5) * host.clientWidth}px, ${(-projected.y * 0.5 + 0.5) * host.clientHeight}px, 0) translate(-50%, -50%)`;
          });

          const selectedTarget = targetFromTurbineId(stateRef.current.selectedTurbineId);
          const selectedHotspot = selectedTarget ? hotspots.get(selectedTarget) : null;
          const detail = detailRef.current;
          if (detail && selectedHotspot) {
            selectedHotspot.getWorldPosition(projected);
            projected.project(camera);
            const visible = projected.z > -1 && projected.z < 1;
            detail.hidden = !visible;
            if (visible) {
              const detailWidth = Math.min(350, host.clientWidth - 28);
              const detailHeight = Math.min(detail.offsetHeight || 176, host.clientHeight - 28);
              const preferredX = (projected.x * 0.5 + 0.5) * host.clientWidth + 92;
              const preferredY = (-projected.y * 0.5 + 0.5) * host.clientHeight + 88;
              const detailX = Math.min(Math.max(14, preferredX), host.clientWidth - detailWidth - 14);
              const detailY = Math.min(Math.max(14, preferredY), host.clientHeight - detailHeight - 14);
              detail.style.width = `${detailWidth}px`;
              detail.style.transform = `translate3d(${detailX}px, ${detailY}px, 0)`;
            }
          } else if (detail) detail.hidden = true;
        };
        animationFrame = window.requestAnimationFrame(animate);

        cleanups.push(() => {
          scene.traverse((object) => {
            const mesh = object as Mesh;
            if (!mesh.isMesh && !object.type.includes("Line")) return;
            const renderable = object as Mesh;
            renderable.geometry?.dispose();
            const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
            materials.filter(Boolean).forEach((material) => {
              Object.values(material).forEach((value) => { if ((value as Texture)?.isTexture) (value as Texture).dispose(); });
              material.dispose();
            });
          });
        });
      } catch {
        if (!disposed) setLoadState("error");
      }
    };

    initialize();
    return () => {
      disposed = true;
      controllerRef.current = null;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      controls?.dispose();
      ktx2Loader?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
    };
  }, []);

  useEffect(() => { controllerRef.current?.selectTurbine(state.selectedTurbineId); }, [state.selectedTurbineId]);
  useEffect(() => { controllerRef.current?.setProjectionEnabled(state.projectionEnabled); }, [state.projectionEnabled]);
  useEffect(() => { controllerRef.current?.setWaterVisible(state.waterVisible); }, [state.waterVisible]);

  const linkedTurbines = useMemo(
    () => TURBINE_LINKS.map((link) => ({ link, turbine: turbines.find((item) => item.id === link.turbineId) })).filter((item) => item.turbine),
    [turbines],
  );
  const selectedTurbine = turbines.find((item) => item.id === state.selectedTurbineId) ?? null;

  return (
    <div className={`windfarm-terrain-scene ${state.projectionEnabled ? "projection-enabled" : ""}`} ref={hostRef}>
      <canvas aria-label="可交互艺术化风场地形" ref={canvasRef} />
      <div className="windfarm-hotspot-layer" aria-label="风机与湖泊热点">
        {linkedTurbines.map(({ link, turbine }) => turbine ? (
          <button
            aria-pressed={state.selectedTurbineId === turbine.id}
            className={`${turbine.status} ${state.selectedTurbineId === turbine.id ? "active" : ""}`}
            key={link.target}
            onClick={() => onTurbineSelect(turbine.id)}
            onMouseEnter={() => controllerRef.current?.hoverTarget(link.target)}
            onMouseLeave={() => controllerRef.current?.hoverTarget(null)}
            ref={(element) => { labelRefs.current[link.target] = element; }}
            type="button"
          >
            <i /><span>{turbine.name}</span><small>{STATUS_LABEL[turbine.status]} · {turbine.powerKW === null ? "--" : `${Math.round(turbine.powerKW)} kW`}</small>
          </button>
        ) : null)}
        <button
          className="lake-hotspot"
          onClick={() => onTurbineSelect(null)}
          onMouseEnter={() => controllerRef.current?.hoverTarget("PART__LAKE")}
          onMouseLeave={() => controllerRef.current?.hoverTarget(null)}
          ref={(element) => { labelRefs.current.PART__LAKE = element; }}
          type="button"
        >
          <i /><span>山地湖泊</span><small>水位正常 · 0.20 m</small>
        </button>
      </div>
      <div className={`windfarm-anchor-card ${selectedTurbine?.status ?? ""}`} hidden={!selectedTurbine} ref={detailRef}>
        {selectedTurbine ? (
          <>
            <button aria-label="关闭风机详情" onClick={() => onTurbineSelect(null)} type="button">×</button>
            <header><i className={selectedTurbine.status} /><strong>风机信息</strong><small>{selectedTurbine.code}</small></header>
            <dl>
              <div><dt>风机名称</dt><dd>{selectedTurbine.name}</dd></div>
              <div><dt>风机状态</dt><dd>{STATUS_LABEL[selectedTurbine.status]}</dd></div>
              <div className="metric"><dt>风速</dt><dd>{selectedTurbine.windSpeedMS === null ? "--" : `${selectedTurbine.windSpeedMS.toFixed(1)} m/s`}</dd></div>
              <div className="metric"><dt>功率</dt><dd>{selectedTurbine.powerKW === null ? "--" : `${Math.round(selectedTurbine.powerKW)} kW`}</dd></div>
            </dl>
          </>
        ) : null}
      </div>
      {loadState === "loading" ? <div className="map-loader"><i style={{ "--progress": `${progress}%` } as CSSProperties} /><strong>艺术化风场模型加载中</strong><span>{progress}%</span></div> : null}
      {loadState === "error" || loadState === "unsupported" ? (
        <div className="map-fallback">
          <Image alt="艺术化风场地形静态备选图" fill src="/scenes/windfarm.png" unoptimized />
          <div><strong>{loadState === "unsupported" ? "浏览器不支持 WebGL" : "三维场景加载失败"}</strong><span>已切换为静态备选图</span></div>
        </div>
      ) : null}
      {loadState === "ready" ? (
        <div className="windfarm-camera-actions">
          <button className="map-camera-reset" onClick={() => controllerRef.current?.resetCamera()} type="button">全景视角</button>
          <button
            aria-pressed={cameraPreset === "max"}
            className={`map-camera-reset ${cameraPreset === "max" ? "active" : ""}`}
            onClick={() => controllerRef.current?.setCameraPreset(cameraPreset === "max" ? "overview" : "max")}
            type="button"
          >
            {cameraPreset === "max" ? "恢复全景" : "最大视图"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
