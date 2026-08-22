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
type CameraPreset = "overview" | "max" | "custom" | "focus-turbine";
type CameraTuning = {
  azimuth: number;
  elevation: number;
  zoom: number;
};
type CameraSnapshot = {
  position: [number, number, number];
  target: [number, number, number];
  version: 1;
};

// The overview reproduces the target composition: lake in the foreground,
// three turbines across the middle distance, and enough air above the ridges.
const WINDFARM_CAMERA_OVERVIEW_DESKTOP = [-1.1, 5.55, 7.25] as const;
const WINDFARM_CAMERA_OVERVIEW_TOUCH = [-1.05, 5.75, 7.75] as const;
const WINDFARM_CAMERA_OVERVIEW_TARGET = [0, -0.48, 0] as const;
const WINDFARM_CAMERA_MAX_DESKTOP = [0, 3.4, 5.45] as const;
const WINDFARM_CAMERA_MAX_TOUCH = [0, 3.55, 5.75] as const;
const WINDFARM_CAMERA_MAX_TARGET = [0, 0.78, 0] as const;
const WINDFARM_CAMERA_STORAGE_KEY = "smart-wind:windfarm-initial-camera:v1";

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
  setCameraPreset: (preset: Exclude<CameraPreset, "focus-turbine" | "custom">) => void;
  setCameraTuning: (tuning: CameraTuning) => void;
  saveInitialCamera: () => boolean;
  restoreSavedCamera: () => boolean;
  restoreSystemCamera: () => void;
  resetCamera: () => void;
};

type InteractivePart = Object3D & {
  userData: {
    display_name?: string;
    power_kw?: number;
    projectionBaseScale?: Vector3;
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
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function isCameraSnapshot(value: unknown): value is CameraSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CameraSnapshot>;
  const validTuple = (tuple: unknown): tuple is [number, number, number] => (
    Array.isArray(tuple)
    && tuple.length === 3
    && tuple.every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) < 1000)
  );
  return candidate.version === 1 && validTuple(candidate.position) && validTuple(candidate.target);
}

function cameraTuningFromSnapshot(snapshot: CameraSnapshot, referenceDistance: number): CameraTuning {
  const offsetX = snapshot.position[0] - snapshot.target[0];
  const offsetY = snapshot.position[1] - snapshot.target[1];
  const offsetZ = snapshot.position[2] - snapshot.target[2];
  const distance = Math.max(0.001, Math.hypot(offsetX, offsetY, offsetZ));
  return {
    azimuth: Math.atan2(offsetX, offsetZ) * 180 / Math.PI,
    elevation: Math.asin(Math.min(1, Math.max(-1, offsetY / distance))) * 180 / Math.PI,
    zoom: referenceDistance / distance * 100,
  };
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

function projectionColorAtHeight(THREE: typeof import("three"), normalizedHeight: number) {
  const low = new THREE.Color(0x023b68);
  const middle = new THREE.Color(0x08aeb8);
  const high = new THREE.Color(0x8efff7);
  if (normalizedHeight < 0.58) return low.lerp(middle, normalizedHeight / 0.58);
  return middle.lerp(high, (normalizedHeight - 0.58) / 0.42);
}

function createHeightColoredWireframe(
  THREE: typeof import("three"),
  geometry: import("three").BufferGeometry,
) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const wireGeometry = new THREE.WireframeGeometry(geometry);
  if (!bounds) return wireGeometry;
  const position = wireGeometry.getAttribute("position");
  const heightRange = Math.max(1, bounds.max.y - bounds.min.y);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const normalizedHeight = THREE.MathUtils.clamp((position.getY(index) - bounds.min.y) / heightRange, 0, 1);
    const color = projectionColorAtHeight(THREE, normalizedHeight);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  wireGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return wireGeometry;
}

function createTerrainContourGeometry(
  THREE: typeof import("three"),
  geometry: import("three").BufferGeometry,
  levelCount: number,
  levelPhase = 0,
) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const position = geometry.getAttribute("position");
  if (!bounds || !position) return null;
  const heightRange = bounds.max.y - bounds.min.y;
  const horizontalRange = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  if (heightRange < Math.max(1, horizontalRange * 0.0012)) return null;

  const positions = position.array as ArrayLike<number>;
  const indices = geometry.index?.array as ArrayLike<number> | undefined;
  const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(position.count / 3);
  const contourPositions: number[] = [];
  const contourColors: number[] = [];
  const edgeEpsilon = Math.max(0.0001, heightRange * 0.000001);
  const surfaceLift = Math.max(0.002, heightRange * 0.0021);

  const vertex = (vertexIndex: number) => {
    const offset = vertexIndex * 3;
    return [positions[offset], positions[offset + 1], positions[offset + 2]] as const;
  };

  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const levelT = (levelIndex + 1 + levelPhase) / (levelCount + 1 + levelPhase * 2);
    const level = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, levelT);
    const levelColor = projectionColorAtHeight(THREE, levelT);
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const triangleOffset = triangleIndex * 3;
      const ia = indices ? indices[triangleOffset] : triangleOffset;
      const ib = indices ? indices[triangleOffset + 1] : triangleOffset + 1;
      const ic = indices ? indices[triangleOffset + 2] : triangleOffset + 2;
      const a = vertex(ia);
      const b = vertex(ib);
      const c = vertex(ic);
      const intersections: Array<[number, number, number]> = [];
      const intersectEdge = (start: readonly number[], end: readonly number[]) => {
        const startDelta = start[1] - level;
        const endDelta = end[1] - level;
        if (Math.abs(startDelta) <= edgeEpsilon && Math.abs(endDelta) <= edgeEpsilon) return;
        if ((startDelta > edgeEpsilon && endDelta > edgeEpsilon) || (startDelta < -edgeEpsilon && endDelta < -edgeEpsilon)) return;
        const denominator = startDelta - endDelta;
        const edgeT = Math.abs(denominator) <= edgeEpsilon ? 0 : THREE.MathUtils.clamp(startDelta / denominator, 0, 1);
        const point: [number, number, number] = [
          THREE.MathUtils.lerp(start[0], end[0], edgeT),
          level + surfaceLift,
          THREE.MathUtils.lerp(start[2], end[2], edgeT),
        ];
        const duplicate = intersections.some((candidate) => (
          Math.abs(candidate[0] - point[0]) <= edgeEpsilon
          && Math.abs(candidate[2] - point[2]) <= edgeEpsilon
        ));
        if (!duplicate) intersections.push(point);
      };
      intersectEdge(a, b);
      intersectEdge(b, c);
      intersectEdge(c, a);
      if (intersections.length !== 2) continue;
      intersections.forEach((point) => {
        contourPositions.push(point[0], point[1], point[2]);
        contourColors.push(levelColor.r, levelColor.g, levelColor.b);
      });
    }
  }

  if (!contourPositions.length) return null;
  const contourGeometry = new THREE.BufferGeometry();
  contourGeometry.setAttribute("position", new THREE.Float32BufferAttribute(contourPositions, 3));
  contourGeometry.setAttribute("color", new THREE.Float32BufferAttribute(contourColors, 3));
  contourGeometry.computeBoundingSphere();
  return contourGeometry;
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
  const [cameraEditorOpen, setCameraEditorOpen] = useState(false);
  const [cameraTuning, setCameraTuningState] = useState<CameraTuning>({ azimuth: -8.6, elevation: 39.5, zoom: 100 });
  const [hasSavedCamera, setHasSavedCamera] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("拖动场景或使用滑杆调整镜头");

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
        const systemDefaultCamera = new THREE.Vector3(...(
          coarsePointer ? WINDFARM_CAMERA_OVERVIEW_TOUCH : WINDFARM_CAMERA_OVERVIEW_DESKTOP
        ));
        const systemDefaultTarget = new THREE.Vector3(...WINDFARM_CAMERA_OVERVIEW_TARGET);
        const systemCameraSnapshot: CameraSnapshot = {
          position: systemDefaultCamera.toArray() as [number, number, number],
          target: systemDefaultTarget.toArray() as [number, number, number],
          version: 1,
        };
        const referenceDistance = systemDefaultCamera.distanceTo(systemDefaultTarget);
        let initialCameraSnapshot = systemCameraSnapshot;
        let savedCameraSnapshot: CameraSnapshot | null = null;
        try {
          const storedCamera = window.localStorage.getItem(WINDFARM_CAMERA_STORAGE_KEY);
          const parsedCamera: unknown = storedCamera ? JSON.parse(storedCamera) : null;
          if (isCameraSnapshot(parsedCamera)) {
            savedCameraSnapshot = parsedCamera;
            initialCameraSnapshot = parsedCamera;
          }
        } catch {
          savedCameraSnapshot = null;
        }
        const defaultCamera = new THREE.Vector3(...initialCameraSnapshot.position);
        const defaultTarget = new THREE.Vector3(...initialCameraSnapshot.target);
        const cameraGoal = defaultCamera.clone();
        const targetGoal = defaultTarget.clone();
        camera.position.copy(defaultCamera);
        setHasSavedCamera(Boolean(savedCameraSnapshot));
        setCameraTuningState(cameraTuningFromSnapshot(initialCameraSnapshot, referenceDistance));

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
        controls.enablePan = true;
        controls.enableRotate = true;
        controls.enableZoom = true;
        controls.dampingFactor = 0.065;
        controls.minDistance = 5.1;
        controls.maxDistance = 26;
        controls.minPolarAngle = 0.32;
        controls.maxPolarAngle = 1.42;
        controls.panSpeed = 0.72;
        controls.rotateSpeed = 0.56;
        controls.zoomSpeed = 0.82;
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
        controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
        controls.target.copy(defaultTarget);
        controls.autoRotate = false;

        let controlInteractionActive = false;
        let tuningSyncTimer = 0;
        const snapshotCurrentCamera = (): CameraSnapshot => ({
          position: camera.position.toArray() as [number, number, number],
          target: (controls?.target ?? targetGoal).toArray() as [number, number, number],
          version: 1,
        });
        const syncManualCamera = () => {
          cameraGoal.copy(camera.position);
          if (controls) targetGoal.copy(controls.target);
        };
        const syncTuningReadout = () => {
          window.clearTimeout(tuningSyncTimer);
          tuningSyncTimer = window.setTimeout(() => {
            setCameraTuningState(cameraTuningFromSnapshot(snapshotCurrentCamera(), referenceDistance));
          }, 90);
        };
        const handleControlStart = () => {
          controlInteractionActive = true;
          syncManualCamera();
          setCameraPresetState("custom");
          setCameraMessage("自定义视角尚未保存");
        };
        const handleControlChange = () => {
          syncManualCamera();
          syncTuningReadout();
        };
        const handleControlEnd = () => {
          controlInteractionActive = false;
          syncManualCamera();
          syncTuningReadout();
        };
        controls.addEventListener("start", handleControlStart);
        controls.addEventListener("change", handleControlChange);
        controls.addEventListener("end", handleControlEnd);
        cleanups.push(() => {
          window.clearTimeout(tuningSyncTimer);
          controls?.removeEventListener("start", handleControlStart);
          controls?.removeEventListener("change", handleControlChange);
          controls?.removeEventListener("end", handleControlEnd);
        });

        scene.add(new THREE.HemisphereLight(0xe9eee9, 0x1c2c22, 1.34));
        const keyLight = new THREE.DirectionalLight(0xf6f5ed, 1.84);
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
        const contourLines: import("three").LineSegments[] = [];
        const turbineWireLines: import("three").LineSegments[] = [];
        let projectionTerrainMaterial: Material | null = null;
        let projectionShader: { uniforms: { uProjectionTime: { value: number } } } | null = null;
        let projectionActive = stateRef.current.projectionEnabled;
        let selectedPart: InteractivePart | null = null;
        let hoverPart: InteractivePart | null = null;
        let pointerDown = { x: 0, y: 0 };

        const applyCameraSnapshot = (snapshot: CameraSnapshot, preset: CameraPreset = "custom") => {
          cameraGoal.set(...snapshot.position);
          targetGoal.set(...snapshot.target);
          camera.position.copy(cameraGoal);
          controls?.target.copy(targetGoal);
          controls?.update();
          setCameraTuningState(cameraTuningFromSnapshot(snapshot, referenceDistance));
          setCameraPresetState(preset);
        };

        const setCameraPreset = (preset: Exclude<CameraPreset, "focus-turbine" | "custom">) => {
          if (preset === "overview") {
            applyCameraSnapshot(initialCameraSnapshot, "overview");
            return;
          }
          const position = coarsePointer ? WINDFARM_CAMERA_MAX_TOUCH : WINDFARM_CAMERA_MAX_DESKTOP;
          applyCameraSnapshot({ position: [...position], target: [...WINDFARM_CAMERA_MAX_TARGET], version: 1 }, "max");
        };

        const applyCameraTuning = (tuning: CameraTuning) => {
          const nextTuning = {
            azimuth: THREE.MathUtils.clamp(tuning.azimuth, -180, 180),
            elevation: THREE.MathUtils.clamp(tuning.elevation, 10, 70),
            zoom: THREE.MathUtils.clamp(tuning.zoom, 50, 180),
          };
          const azimuth = THREE.MathUtils.degToRad(nextTuning.azimuth);
          const elevation = THREE.MathUtils.degToRad(nextTuning.elevation);
          const distance = THREE.MathUtils.clamp(referenceDistance / (nextTuning.zoom / 100), controls?.minDistance ?? 5.1, controls?.maxDistance ?? 26);
          const horizontalDistance = Math.cos(elevation) * distance;
          const target = controls?.target ?? targetGoal;
          const snapshot: CameraSnapshot = {
            position: [
              target.x + Math.sin(azimuth) * horizontalDistance,
              target.y + Math.sin(elevation) * distance,
              target.z + Math.cos(azimuth) * horizontalDistance,
            ],
            target: target.toArray() as [number, number, number],
            version: 1,
          };
          applyCameraSnapshot(snapshot, "custom");
          setCameraMessage("自定义视角尚未保存");
        };

        const focusSelectedTurbine = (_target: string) => {
          void _target;
          // The reference keeps the entire wind farm in frame while the anchored
          // information card opens. Selection must not override a user-authored camera.
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
                material.emissive.setHex(0x007f82);
                material.emissiveIntensity = 0.24;
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
            // Capture the authored asset bounds before adding projection-only
            // contour and ghost-shell children. Those layers intentionally sit
            // above the terrain and must not shift the model's auto-centering.
            const sourceBounds = new THREE.Box3().setFromObject(root);
            const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
            const sourceSize = sourceBounds.getSize(new THREE.Vector3());
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
                  material.roughness = 0.94;
                  material.emissive.setHex(0x0a130c);
                  material.emissiveIntensity = 0.03;
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
                  material.userData.baseDepthWrite = material.depthWrite;
                  material.userData.baseDepthTest = material.depthTest;
                  if (isTurbineMesh) projectionAccentMaterials.add(material);
                }
                return material;
              });
              mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
              if (isTurbineMesh) {
                const turbineWireGeometry = createHeightColoredWireframe(THREE, mesh.geometry);
                const turbineLines = new THREE.LineSegments(
                  turbineWireGeometry,
                  new THREE.LineBasicMaterial({
                    blending: THREE.AdditiveBlending,
                    color: 0x20cbc5,
                    depthTest: true,
                    depthWrite: false,
                    opacity: 0.46,
                    toneMapped: false,
                    transparent: true,
                  }),
                );
                turbineLines.name = "RUNTIME__TURBINE_PROJECTION_WIREFRAME";
                turbineLines.renderOrder = 9;
                turbineLines.visible = stateRef.current.projectionEnabled;
                mesh.add(turbineLines);
                turbineWireLines.push(turbineLines);
              }
            });

            if (terrainMeshes.length) {
              const terrainLocalBounds = new THREE.Box3();
              terrainMeshes.forEach((mesh) => {
                mesh.geometry.computeBoundingBox();
                if (mesh.geometry.boundingBox) terrainLocalBounds.union(mesh.geometry.boundingBox);
              });
              const projectionUniforms = THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                  uProjectionTime: { value: 0 },
                  uTerrainHeightMin: { value: terrainLocalBounds.min.y },
                  uTerrainHeightRange: { value: Math.max(1, terrainLocalBounds.max.y - terrainLocalBounds.min.y) },
                },
              ]);
              projectionTerrainMaterial = new THREE.ShaderMaterial({
                blending: THREE.NormalBlending,
                depthWrite: true,
                fog: true,
                side: THREE.DoubleSide,
                transparent: false,
                uniforms: projectionUniforms,
                vertexShader: `
                  varying vec3 vProjectionLocalPosition;
                  varying vec3 vProjectionLocalNormal;
                  varying vec3 vProjectionViewNormal;
                  varying vec3 vProjectionViewPosition;
                  #include <fog_pars_vertex>
                  void main() {
                    vProjectionLocalPosition = position;
                    vProjectionLocalNormal = normal;
                    vProjectionViewNormal = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vProjectionViewPosition = mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                  }
                `,
                fragmentShader: `
                  uniform float uProjectionTime;
                  uniform float uTerrainHeightMin;
                  uniform float uTerrainHeightRange;
                  varying vec3 vProjectionLocalPosition;
                  varying vec3 vProjectionLocalNormal;
                  varying vec3 vProjectionViewNormal;
                  varying vec3 vProjectionViewPosition;
                  #include <fog_pars_fragment>
                  void main() {
                    vec3 terrainNormal = normalize(vProjectionLocalNormal);
                    float normalizedHeight = clamp(
                      (vProjectionLocalPosition.y - uTerrainHeightMin) / uTerrainHeightRange,
                      0.0,
                      1.0
                    );
                    float upwardFacing = abs(terrainNormal.y);
                    float steepness = 1.0 - upwardFacing;
                    vec3 keyDirection = normalize(vec3(-0.46, 0.82, 0.34));
                    float directionalLight = clamp(dot(terrainNormal, keyDirection) * 0.5 + 0.5, 0.0, 1.0);
                    float heightLight = smoothstep(0.12, 0.92, normalizedHeight);
                    float slopeShadow = mix(0.42, 1.0, smoothstep(0.12, 0.88, upwardFacing));
                    float faceLight = mix(0.34, 1.0, directionalLight) * slopeShadow;

                    vec3 deepVolume = vec3(0.0006, 0.008, 0.022);
                    vec3 litVolume = vec3(0.002, 0.055, 0.082);
                    vec3 terrainColor = mix(
                      deepVolume,
                      litVolume,
                      clamp(faceLight * 0.72 + heightLight * 0.2, 0.0, 1.0)
                    );
                    terrainColor *= mix(0.58, 1.08, heightLight);

                    float fineScan = pow(max(0.0, sin(vProjectionLocalPosition.y * 0.0105 - uProjectionTime * 0.72)), 28.0);
                    float broadScan = pow(max(0.0, sin(vProjectionLocalPosition.y * 0.0032 + uProjectionTime * 0.24)), 38.0);
                    float crestLight = smoothstep(0.56, 0.95, normalizedHeight)
                      * smoothstep(0.16, 0.74, steepness);
                    vec3 viewDirection = normalize(-vProjectionViewPosition);
                    float rimLight = pow(1.0 - abs(dot(normalize(vProjectionViewNormal), viewDirection)), 3.2);
                    terrainColor += vec3(0.0, 0.19, 0.24) * (fineScan * 0.22 + broadScan * 0.19);
                    terrainColor += vec3(0.0, 0.11, 0.14) * crestLight;
                    terrainColor += vec3(0.0, 0.09, 0.13) * rimLight;

                    gl_FragColor = vec4(terrainColor, 1.0);
                    #include <fog_fragment>
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                  }
                `,
              });
              projectionShader = { uniforms: { uProjectionTime: projectionUniforms.uProjectionTime } };
              terrainMeshes.forEach((mesh) => {
                originalTerrainMaterials.set(mesh, mesh.material);
                const hologramWireGeometry = createHeightColoredWireframe(THREE, mesh.geometry);
                const lines = new THREE.LineSegments(
                  hologramWireGeometry,
                  new THREE.LineBasicMaterial({
                    blending: THREE.AdditiveBlending,
                    depthTest: true,
                    depthWrite: false,
                    opacity: 0.5,
                    toneMapped: false,
                    transparent: true,
                    vertexColors: true,
                  }),
                );
                lines.name = "RUNTIME__TERRAIN_DEPTH_WIREFRAME";
                lines.renderOrder = 5;
                lines.visible = stateRef.current.projectionEnabled;
                mesh.add(lines);
                wireLines.push(lines);

                [140, 360, 680].forEach((lift, layerIndex) => {
                  const shellLines = new THREE.LineSegments(
                    hologramWireGeometry.clone(),
                    new THREE.LineBasicMaterial({
                      blending: THREE.AdditiveBlending,
                      depthTest: true,
                      depthWrite: false,
                      opacity: [0.23, 0.13, 0.07][layerIndex],
                      toneMapped: false,
                      transparent: true,
                      vertexColors: true,
                    }),
                  );
                  shellLines.name = `RUNTIME__TERRAIN_GHOST_SHELL_${layerIndex + 1}`;
                  shellLines.position.y = lift;
                  shellLines.scale.setScalar(1 + (layerIndex + 1) * 0.0025);
                  shellLines.renderOrder = 4 - layerIndex;
                  shellLines.visible = stateRef.current.projectionEnabled;
                  mesh.add(shellLines);
                  wireLines.push(shellLines);
                });

                const structuralEdges = new THREE.LineSegments(
                  new THREE.EdgesGeometry(mesh.geometry, 4.5),
                  new THREE.LineBasicMaterial({
                    blending: THREE.NormalBlending,
                    color: 0x07516f,
                    depthTest: true,
                    depthWrite: false,
                    opacity: 0.7,
                    toneMapped: false,
                    transparent: true,
                  }),
                );
                structuralEdges.name = "RUNTIME__TERRAIN_STRUCTURAL_EDGES";
                structuralEdges.position.y = 5;
                structuralEdges.renderOrder = 5;
                structuralEdges.visible = stateRef.current.projectionEnabled;
                mesh.add(structuralEdges);
                wireLines.push(structuralEdges);

                const ridgeHighlights = new THREE.LineSegments(
                  new THREE.EdgesGeometry(mesh.geometry, 11.5),
                  new THREE.LineBasicMaterial({
                    blending: THREE.AdditiveBlending,
                    color: 0x4ffff2,
                    depthTest: true,
                    depthWrite: false,
                    opacity: 0.82,
                    toneMapped: false,
                    transparent: true,
                  }),
                );
                ridgeHighlights.name = "RUNTIME__TERRAIN_RIDGE_HIGHLIGHTS";
                ridgeHighlights.position.y = 9;
                ridgeHighlights.renderOrder = 7;
                ridgeHighlights.visible = stateRef.current.projectionEnabled;
                mesh.add(ridgeHighlights);
                wireLines.push(ridgeHighlights);

                const fineContourGeometry = createTerrainContourGeometry(THREE, mesh.geometry, 58, 0.35);
                if (fineContourGeometry) {
                  const fineContours = new THREE.LineSegments(
                    fineContourGeometry,
                    new THREE.LineBasicMaterial({
                      blending: THREE.AdditiveBlending,
                      depthTest: true,
                      depthWrite: false,
                      opacity: 0.5,
                      toneMapped: false,
                      transparent: true,
                      vertexColors: true,
                    }),
                  );
                  fineContours.name = "RUNTIME__TERRAIN_CONTOUR_FINE";
                  fineContours.renderOrder = 6;
                  fineContours.visible = stateRef.current.projectionEnabled;
                  mesh.add(fineContours);
                  contourLines.push(fineContours);
                }

                const majorContourGeometry = createTerrainContourGeometry(THREE, mesh.geometry, 16, 0.12);
                if (majorContourGeometry) {
                  const majorContours = new THREE.LineSegments(
                    majorContourGeometry,
                    new THREE.LineBasicMaterial({
                      blending: THREE.AdditiveBlending,
                      color: 0x68fff4,
                      depthTest: true,
                      depthWrite: false,
                      opacity: 0.82,
                      toneMapped: false,
                      transparent: true,
                      vertexColors: false,
                    }),
                  );
                  majorContours.name = "RUNTIME__TERRAIN_CONTOUR_MAJOR";
                  majorContours.renderOrder = 7;
                  majorContours.visible = stateRef.current.projectionEnabled;
                  mesh.add(majorContours);
                  contourLines.push(majorContours);
                }
              });
              root.add(wireGroup);
            }

            root.position.copy(sourceCenter).multiplyScalar(-1);
            pivot.scale.setScalar(12.4 / Math.max(sourceSize.x, sourceSize.z));
            pivot.add(root);

            const applyProjectionLook = (enabled: boolean) => {
              projectionActive = enabled;
              wireGroup.visible = enabled;
              grid.visible = !enabled;
              fog.color.setHex(enabled ? 0x000708 : 0xc6d0cb);
              fog.density = enabled ? 0.018 : 0.045;
              if (renderer) renderer.toneMappingExposure = enabled ? 1.08 : 1.02;
              wireLines.forEach((lines) => { lines.visible = enabled; });
              contourLines.forEach((lines) => { lines.visible = enabled; });
              turbineWireLines.forEach((lines) => { lines.visible = enabled; });
              baseMeshes.forEach((mesh) => { mesh.visible = !enabled; });
              terrainMeshes.forEach((mesh) => {
                const original = originalTerrainMaterials.get(mesh);
                if (original && projectionTerrainMaterial) mesh.material = enabled ? projectionTerrainMaterial : original;
              });
              projectionAccentMaterials.forEach((material) => {
                if (enabled) {
                  material.color.setHex(0x011419);
                  material.emissive.setHex(0x005c61);
                  material.emissiveIntensity = 0.08;
                  material.opacity = 0.025;
                  material.transparent = true;
                  material.depthWrite = false;
                } else {
                  material.color.copy(material.userData.baseColor);
                  material.emissive.copy(material.userData.baseEmissive);
                  material.emissiveIntensity = material.userData.baseEmissiveIntensity;
                  material.opacity = material.userData.baseOpacity;
                  material.transparent = material.userData.baseTransparent;
                  material.depthWrite = material.userData.baseDepthWrite;
                  material.depthTest = material.userData.baseDepthTest;
                }
                material.needsUpdate = true;
              });
              parts.forEach((part) => {
                if (!part.name.startsWith("PART__TURBINE_")) return;
                let baseScale = part.userData.projectionBaseScale as Vector3 | undefined;
                if (!baseScale) {
                  baseScale = part.scale.clone();
                  part.userData.projectionBaseScale = baseScale;
                }
                part.scale.copy(baseScale).multiplyScalar(enabled ? 0.76 : 1);
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
              setCameraTuning: applyCameraTuning,
              saveInitialCamera() {
                const snapshot = snapshotCurrentCamera();
                try {
                  window.localStorage.setItem(WINDFARM_CAMERA_STORAGE_KEY, JSON.stringify(snapshot));
                  savedCameraSnapshot = snapshot;
                  initialCameraSnapshot = snapshot;
                  setHasSavedCamera(true);
                  setCameraPresetState("overview");
                  setCameraMessage("已保存为初始视角，刷新页面仍然生效");
                  return true;
                } catch {
                  setCameraMessage("保存失败：浏览器禁止本地存储");
                  return false;
                }
              },
              restoreSavedCamera() {
                if (!savedCameraSnapshot) return false;
                initialCameraSnapshot = savedCameraSnapshot;
                applyCameraSnapshot(savedCameraSnapshot, "overview");
                setCameraMessage("已恢复保存的初始视角");
                return true;
              },
              restoreSystemCamera() {
                try { window.localStorage.removeItem(WINDFARM_CAMERA_STORAGE_KEY); } catch { /* Keep the runtime reset usable. */ }
                savedCameraSnapshot = null;
                initialCameraSnapshot = systemCameraSnapshot;
                setHasSavedCamera(false);
                applyCameraSnapshot(systemCameraSnapshot, "overview");
                setCameraMessage("已清除保存并恢复系统默认视角");
              },
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
          if (!controlInteractionActive) {
            const cameraEase = 1 - Math.exp(-delta * 4.8);
            camera.position.lerp(cameraGoal, cameraEase);
            controls?.target.lerp(targetGoal, cameraEase);
          }
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
      } catch (error) {
        console.error("Wind farm terrain scene initialization failed", error);
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
  const updateCameraTuning = (key: keyof CameraTuning, value: number) => {
    const next = { ...cameraTuning, [key]: value };
    setCameraTuningState(next);
    controllerRef.current?.setCameraTuning(next);
  };

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
        <>
          <div className="windfarm-camera-actions">
            <button className="map-camera-reset" onClick={() => controllerRef.current?.resetCamera()} type="button">初始视角</button>
            <button
              aria-pressed={cameraPreset === "max"}
              className={`map-camera-reset ${cameraPreset === "max" ? "active" : ""}`}
              onClick={() => controllerRef.current?.setCameraPreset(cameraPreset === "max" ? "overview" : "max")}
              type="button"
            >
              {cameraPreset === "max" ? "恢复初始" : "最大视图"}
            </button>
            <button
              aria-expanded={cameraEditorOpen}
              className={`map-camera-reset camera-edit-trigger ${cameraEditorOpen || cameraPreset === "custom" ? "active" : ""}`}
              onClick={() => setCameraEditorOpen((open) => !open)}
              type="button"
            >
              镜头调整
            </button>
          </div>
          {cameraEditorOpen ? (
            <section aria-label="风场初始镜头设置" className="windfarm-camera-editor">
              <header>
                <div><strong>自定义初始视角</strong><small>CAMERA CALIBRATION</small></div>
                <button aria-label="关闭镜头设置" onClick={() => setCameraEditorOpen(false)} type="button">×</button>
              </header>
              <label>
                <span>水平角</span><output>{cameraTuning.azimuth.toFixed(0)}°</output>
                <input
                  aria-label="水平旋转角度"
                  max="180"
                  min="-180"
                  onChange={(event) => updateCameraTuning("azimuth", Number(event.target.value))}
                  step="1"
                  type="range"
                  value={cameraTuning.azimuth}
                />
              </label>
              <label>
                <span>俯仰角</span><output>{cameraTuning.elevation.toFixed(0)}°</output>
                <input
                  aria-label="镜头俯仰角度"
                  max="70"
                  min="10"
                  onChange={(event) => updateCameraTuning("elevation", Number(event.target.value))}
                  step="1"
                  type="range"
                  value={cameraTuning.elevation}
                />
              </label>
              <label>
                <span>画面大小</span><output>{cameraTuning.zoom.toFixed(0)}%</output>
                <input
                  aria-label="模型画面大小"
                  max="180"
                  min="50"
                  onChange={(event) => updateCameraTuning("zoom", Number(event.target.value))}
                  step="1"
                  type="range"
                  value={cameraTuning.zoom}
                />
              </label>
              <p>左键旋转 · 滚轮缩放 · 右键平移；平移位置也会随初始视角保存。</p>
              <div className="windfarm-camera-save-actions">
                <button onClick={() => controllerRef.current?.saveInitialCamera()} type="button">保存为初始视角</button>
                <button disabled={!hasSavedCamera} onClick={() => controllerRef.current?.restoreSavedCamera()} type="button">载入已保存</button>
                <button onClick={() => controllerRef.current?.restoreSystemCamera()} type="button">清除并恢复默认</button>
              </div>
              <small className="windfarm-camera-message">{cameraMessage}</small>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
