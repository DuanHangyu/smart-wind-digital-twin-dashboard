"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Blending,
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Plane,
  PerspectiveCamera,
  Texture,
  Side,
  Vector3,
} from "three";
import type {
  AlarmRecord,
  OperationsSceneState,
  RuntimeStatus,
  TurbineDetail,
  TurbinePart,
  TurbineViewMode,
} from "../../types/dashboard";

type LoadState = "loading" | "ready" | "error" | "unsupported";

// P03 opens on the hub/nacelle inspection shot from the reference, rather
// than fitting the complete tower into the viewport.
const TURBINE_CAMERA_DESKTOP = [3.15, 1.4, 3.95] as const;
const TURBINE_CAMERA_TOUCH = [4, 2, 5] as const;
const TURBINE_CAMERA_TARGET = [0, -0.05, 0] as const;
const TURBINE_ROTOR_PRESENTATION_PHASE = Math.PI / 6;

type PartMesh = Mesh & {
  userData: {
    assembly_order?: number;
    display_name?: string;
    explode_vector?: [number, number, number];
    material_zone?: string;
    part_type?: string;
  };
};

type MaterialRuntime = {
  baseBlending: Blending;
  baseColor: Color;
  baseEmissive: Color;
  baseEmissiveIntensity: number;
  baseMetalness: number;
  baseOpacity: number;
  baseRoughness: number;
  baseSide: Side;
  material: MeshStandardMaterial;
  mutedColor: Color;
};

type PartRuntime = {
  basePosition: Vector3;
  edge: LineSegments;
  edgeMaterial: LineBasicMaterial;
  explodeOffset: Vector3;
  line: LineSegments;
  lineMaterial: LineBasicMaterial;
  materials: MaterialRuntime[];
  object: PartMesh;
};

type SceneController = {
  resetCamera: () => void;
  selectPart: (partId: string | null) => void;
  setMode: (mode: TurbineViewMode) => void;
};

const EXTERNAL_PARTS = new Set([
  "PART__BLADE_A",
  "PART__BLADE_B",
  "PART__BLADE_C",
  "PART__HUB",
  "PART__MAIN_SHAFT",
  "PART__NACELLE_SHELL",
  "PART__SPINNER",
  "PART__TOWER",
  "PART__YAW_BASE",
  "PART__YAW_GEAR",
]);

const HOLOGRAM_SHELL_PARTS = new Set([
  "PART__BLADE_A",
  "PART__BLADE_B",
  "PART__BLADE_C",
  "PART__HUB",
  "PART__NACELLE_SHELL",
  "PART__SPINNER",
  "PART__TOWER",
  "PART__YAW_BASE",
]);

const WIREFRAME_PARTS = new Set(HOLOGRAM_SHELL_PARTS);

const TURBINE_MODE_CAMERAS: Record<TurbineViewMode, {
  fov: number;
  relative: readonly [number, number, number];
  targetMix: number;
  targetOffset: readonly [number, number, number];
}> = {
  exterior: { fov: 29, relative: [3.5, 1.08, 4.36], targetMix: 0.2, targetOffset: [0, -0.06, 0] },
  transparent: { fov: 29, relative: [2.72, 0.82, 4.46], targetMix: 0.22, targetOffset: [0, -0.09, 0] },
  wireframe: { fov: 28, relative: [3.65, 0.86, 4.28], targetMix: 0.2, targetOffset: [0, -0.05, 0] },
  structure: { fov: 26, relative: [4.84, 0.73, 4.89], targetMix: 0.48, targetOffset: [0, -0.16, 0] },
};

const HOTSPOT_TARGETS = new Set([
  "PART__BRAKE_UNIT",
  "PART__GEARBOX",
  "PART__GENERATOR",
  "PART__HUB",
  "PART__MAIN_BEARING",
  "PART__MAIN_SHAFT",
  "PART__NACELLE_SHELL",
  "PART__TOWER",
  "PART__YAW_GEAR",
]);

const STRUCTURE_EXPLODE_OFFSETS: Record<string, readonly [number, number, number]> = {
  PART__BEDPLATE: [0, -0.2, -0.28],
  PART__BLADE_A: [0, 0, 0.62],
  PART__BLADE_B: [0, 0, 0.62],
  PART__BLADE_C: [0, 0, 0.62],
  PART__BRAKE_UNIT: [0.06, 0.02, -1.34],
  PART__GEARBOX: [0, 0, -0.58],
  PART__GENERATOR: [0, 0, -1.02],
  PART__HUB: [0, 0, 0.62],
  PART__MAIN_BEARING: [0, 0, -0.2],
  PART__MAIN_SHAFT: [0, 0, 0.24],
  PART__NACELLE_SHELL: [0, 0.16, -0.48],
  PART__SPINNER: [0, 0, 0.9],
  PART__TOWER: [0, -1.04, 0],
  PART__YAW_BASE: [0, -0.7, 0],
  PART__YAW_GEAR: [0, -0.4, 0],
};

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  abnormal: "温度异常",
  fault: "设备故障",
  normal: "状态正常",
  offline: "设备离线",
  running: "运行中",
  standby: "设备待机",
};

function webGlAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function modelPartFromHit(object: Object3D | null) {
  let current = object;
  while (current && !current.name.startsWith("PART__")) current = current.parent;
  return current as PartMesh | null;
}

function sensorText(part: TurbinePart | undefined, turbine: TurbineDetail) {
  if (!part) return "--";
  if (part.modelNodeName === "PART__GEARBOX") return `${turbine.gearboxTemperatureC?.toFixed(1) ?? "--"} °C`;
  if (part.modelNodeName === "PART__GENERATOR") return `${turbine.generatorTemperatureC?.toFixed(1) ?? "--"} °C`;
  if (part.modelNodeName === "PART__MAIN_BEARING") return `${((turbine.gearboxTemperatureC ?? 46) + 7.8).toFixed(1)} °C`;
  if (part.modelNodeName === "PART__MAIN_SHAFT") return "2.1 mm/s";
  return STATUS_LABEL[part.status];
}

export function TurbineTwinScene({
  alarms,
  onPartSelect,
  parts,
  state,
  turbine,
}: {
  alarms: AlarmRecord[];
  onPartSelect: (partId: string | null) => void;
  parts: TurbinePart[];
  state: OperationsSceneState;
  turbine: TurbineDetail;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const controllerRef = useRef<SceneController | null>(null);
  const stateRef = useRef(state);
  const partsRef = useRef(parts);
  const onPartSelectRef = useRef(onPartSelect);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [progress, setProgress] = useState(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { partsRef.current = parts; }, [parts]);
  useEffect(() => { onPartSelectRef.current = onPartSelect; }, [onPartSelect]);

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
    let controlsInteracting = false;
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
        scene.fog = new THREE.FogExp2(0x02090b, 0.012);
        const camera: PerspectiveCamera = new THREE.PerspectiveCamera(39, 1, 0.03, 100);
        const coarsePointer = matchMedia("(pointer: coarse)").matches;
        const defaultCamera = new THREE.Vector3(...(coarsePointer ? TURBINE_CAMERA_TOUCH : TURBINE_CAMERA_DESKTOP));
        const defaultTarget = new THREE.Vector3(...TURBINE_CAMERA_TARGET);
        const cameraGoal = defaultCamera.clone();
        const targetGoal = defaultTarget.clone();
        camera.position.copy(defaultCamera);

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: !coarsePointer,
          canvas,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, coarsePointer ? 1.25 : 1.8));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.localClippingEnabled = true;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.02;

        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.065;
        controls.minDistance = 3.2;
        controls.maxDistance = 23;
        controls.minPolarAngle = 0.28;
        controls.maxPolarAngle = 1.55;
        controls.target.copy(defaultTarget);
        controls.autoRotate = false;

        const pauseCruise = () => {
          controlsInteracting = true;
        };
        const resumeCruise = () => {
          cameraGoal.copy(camera.position);
          if (controls) targetGoal.copy(controls.target);
          controlsInteracting = false;
        };
        controls.addEventListener("start", pauseCruise);
        controls.addEventListener("end", resumeCruise);
        cleanups.push(() => {
          controls?.removeEventListener("start", pauseCruise);
          controls?.removeEventListener("end", resumeCruise);
        });

        scene.add(new THREE.HemisphereLight(0xb9ffff, 0x071010, 1.55));
        const key = new THREE.DirectionalLight(0xe8ffff, 2.65);
        key.position.set(-4, 8, 7);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x16e8df, 3.75);
        rim.position.set(6, 4, -5);
        scene.add(rim);
        const fill = new THREE.DirectionalLight(0x477dff, 0.95);
        fill.position.set(-6, 2, -3);
        scene.add(fill);

        const pivot = new THREE.Group();
        pivot.name = "MODEL_AUTO_CENTER_SCALE";
        pivot.rotation.y = -0.55;
        scene.add(pivot);

        const partRuntimes: PartRuntime[] = [];
        const partByName = new Map<string, PartRuntime>();
        const hotspotByTarget = new Map<string, Object3D>();
        const rawHotspots: Object3D[] = [];
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2(2, 2);
        const projected = new THREE.Vector3();
        const cyanColor = new THREE.Color(0x39d7d3);
        const cyanEmissive = new THREE.Color(0x087c78);
        const exteriorColor = new THREE.Color(0xc5d2d2);
        const wireColor = new THREE.Color(0x16d8d2);
        const selectedColor = new THREE.Color(0x0affec);
        const hoverColor = new THREE.Color(0x087e7b);
        const faultColor = new THREE.Color(0xff463d);
        const warningColor = new THREE.Color(0xf4c542);
        const blenderVectorToThree = (value: unknown) => {
          const source = Array.isArray(value) ? value : [0, 0, 0];
          return new THREE.Vector3(Number(source[0] ?? 0), Number(source[2] ?? 0), -Number(source[1] ?? 0));
        };
        let rotor: Object3D | null = null;
        let rotorAxis = new THREE.Vector3(0, 0, -1);
        let externalShaftClipPlanes: Plane[] | null = null;
        let selectedRuntime: PartRuntime | null = null;
        let hoveredRuntime: PartRuntime | null = null;
        let pointerDown = { x: 0, y: 0 };
        const hubFocus = defaultTarget.clone();
        const nacelleFocus = defaultTarget.clone();
        let focusReady = false;

        const setModeCamera = (mode: TurbineViewMode) => {
          const preset = TURBINE_MODE_CAMERAS[mode];
          if (focusReady) targetGoal.copy(hubFocus).lerp(nacelleFocus, preset.targetMix);
          else targetGoal.copy(defaultTarget).setY(1.12);
          targetGoal.add(new THREE.Vector3(...preset.targetOffset));
          const touchScale = coarsePointer ? 1.12 : 1;
          cameraGoal.set(...preset.relative).multiplyScalar(touchScale).add(targetGoal);
          camera.fov = preset.fov;
          camera.updateProjectionMatrix();
          camera.position.copy(cameraGoal);
          controls?.target.copy(targetGoal);
          controls?.update();
        };
        const businessPartForNode = (nodeName: string) => partsRef.current.find((part) => part.modelNodeName === nodeName);
        const selectPart = (partId: string | null, notify = false) => {
          const businessPart = partId ? partsRef.current.find((part) => part.id === partId) : null;
          const nextRuntime = businessPart ? partByName.get(businessPart.modelNodeName) ?? null : null;
          if (nextRuntime) {
            selectedRuntime = nextRuntime;
            const selectedName = nextRuntime.object.name;
            const shouldRefocus = !selectedName.startsWith("PART__BLADE_")
              && selectedName !== "PART__TOWER"
              && selectedName !== "PART__NACELLE_SHELL";
            scene.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(nextRuntime.object);
            if (shouldRefocus && !bounds.isEmpty()) {
              const center = bounds.getCenter(new THREE.Vector3());
              const size = bounds.getSize(new THREE.Vector3());
              const focusDistance = THREE.MathUtils.clamp(
                size.length() * 2.35,
                stateRef.current.viewMode === "structure" ? 3.65 : 3.15,
                stateRef.current.viewMode === "structure" ? 4.35 : 3.85,
              );
              targetGoal.copy(center);
              cameraGoal.copy(defaultCamera).normalize().multiplyScalar(focusDistance).add(center);
            }
          } else {
            selectedRuntime = null;
            setModeCamera(stateRef.current.viewMode);
          }
          if (notify) onPartSelectRef.current(businessPart?.id ?? null);
        };

        ktx2Loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
        const loader = new GLTFLoader().setKTX2Loader(ktx2Loader);
        loader.load(
          "/models/turbine.glb",
          (gltf) => {
            if (disposed) return;
            const root = gltf.scene;
            root.traverse((object) => {
              if (object.name.startsWith("HOTSPOT__")) rawHotspots.push(object);
              if (object.name.startsWith("ROTOR__")) {
                rotor = object;
                const sourceAxis = object.userData.rotation_axis;
                rotorAxis = sourceAxis === "X"
                  ? new THREE.Vector3(1, 0, 0)
                  : sourceAxis === "Z"
                    ? new THREE.Vector3(0, 1, 0)
                    : new THREE.Vector3(0, 0, -1);
              }
              const mesh = object as PartMesh;
              if (!mesh.isMesh || !mesh.name.startsWith("PART__")) return;
              const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              const clonedMaterials = sourceMaterials.map((entry) => {
                const material = entry.clone() as MeshStandardMaterial;
                material.transparent = true;
                return material;
              });
              mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0];
              const materials = clonedMaterials.map((material) => ({
                baseBlending: material.blending,
                baseColor: material.color.clone(),
                baseEmissive: material.emissive.clone(),
                baseEmissiveIntensity: material.emissiveIntensity,
                baseMetalness: material.metalness,
                baseOpacity: material.opacity,
                baseRoughness: material.roughness,
                baseSide: material.side,
                material,
                mutedColor: material.color.clone().lerp(new THREE.Color(0x4f8589), 0.24),
              }));
              const lineMaterial = new THREE.LineBasicMaterial({
                color: 0x16d9d3,
                depthWrite: false,
                opacity: 0,
                transparent: true,
              });
              const line = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), lineMaterial);
              line.name = `FX__WIRE__${mesh.name}`;
              line.renderOrder = 18;
              line.visible = false;
              mesh.add(line);
              const edgeMaterial = new THREE.LineBasicMaterial({
                color: 0x36f7ee,
                depthTest: false,
                depthWrite: false,
                opacity: 0,
                transparent: true,
              });
              const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 24), edgeMaterial);
              edge.name = `FX__EDGE__${mesh.name}`;
              edge.renderOrder = 19;
              edge.visible = false;
              mesh.add(edge);
              const runtime: PartRuntime = {
                basePosition: mesh.position.clone(),
                edge,
                edgeMaterial,
                explodeOffset: STRUCTURE_EXPLODE_OFFSETS[mesh.name]
                  ? new THREE.Vector3(...STRUCTURE_EXPLODE_OFFSETS[mesh.name])
                  : blenderVectorToThree(mesh.userData.explode_vector),
                line,
                lineMaterial,
                materials,
                object: mesh,
              };
              partRuntimes.push(runtime);
              partByName.set(mesh.name, runtime);
            });

            const bounds = new THREE.Box3().setFromObject(root);
            const center = bounds.getCenter(new THREE.Vector3());
            const size = bounds.getSize(new THREE.Vector3());
            root.position.copy(center).multiplyScalar(-1);
            const scale = 9.6 / Math.max(size.x, size.y, size.z);
            pivot.scale.setScalar(scale);
            pivot.add(root);
            scene.updateMatrixWorld(true);

            // Blender's source rotor empty was exported at the turbine root. Rebuild it
            // from the hub's actual vertex centroid after every ancestor matrix is current.
            const sourceRotor = rotor;
            const hubRuntime = partByName.get("PART__HUB");
            if (sourceRotor && sourceRotor.parent && hubRuntime) {
              const rotorParent = sourceRotor.parent;
              const hubPositions = hubRuntime.object.geometry.getAttribute("position");
              const hubCenterWorld = new THREE.Vector3();
              const hubVertex = new THREE.Vector3();
              for (let index = 0; index < hubPositions.count; index += 1) {
                hubCenterWorld.add(hubVertex.fromBufferAttribute(hubPositions, index));
              }
              hubCenterWorld
                .multiplyScalar(1 / Math.max(1, hubPositions.count))
                .applyMatrix4(hubRuntime.object.matrixWorld);
              const hubCenterLocal = rotorParent.worldToLocal(hubCenterWorld.clone());
              const runtimeRotor = new THREE.Group();
              runtimeRotor.name = "RUNTIME__ROTOR_PIVOT";
              runtimeRotor.position.copy(hubCenterLocal);
              runtimeRotor.userData = { ...sourceRotor.userData, pivot_source: "PART__HUB_VERTEX_CENTROID" };
              rotorParent.add(runtimeRotor);
              sourceRotor.children.slice().forEach((child) => runtimeRotor.attach(child));
              runtimeRotor.rotateOnAxis(rotorAxis, TURBINE_ROTOR_PRESENTATION_PHASE);
              rotorParent.remove(sourceRotor);
              rotor = runtimeRotor;
              partRuntimes.forEach((runtime) => {
                if (runtime.object.parent === runtimeRotor) runtime.basePosition.copy(runtime.object.position);
              });
              scene.updateMatrixWorld(true);
            }

            const resolvedHub = partByName.get("PART__HUB");
            const resolvedNacelle = partByName.get("PART__NACELLE_SHELL");
            if (resolvedHub && resolvedNacelle) {
              new THREE.Box3().setFromObject(resolvedHub.object).getCenter(hubFocus);
              new THREE.Box3().setFromObject(resolvedNacelle.object).getCenter(nacelleFocus);
              focusReady = true;
            }

            const shellRuntime = partByName.get("PART__NACELLE_SHELL");
            if (shellRuntime) {
              const shellBoundsWorld = new THREE.Box3().setFromObject(shellRuntime.object);
              const shaftRevealStartZ = shellBoundsWorld.max.z - 0.08 * scale;
              externalShaftClipPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -shaftRevealStartZ)];
            }

            rawHotspots.forEach((hotspot) => {
              const target = hotspot.userData.target as string | undefined;
              const runtime = target ? partByName.get(target) : null;
              if (!target || !runtime) return;
              runtime.object.attach(hotspot);
              hotspotByTarget.set(target, hotspot);
            });

            setModeCamera(stateRef.current.viewMode);
            selectPart(stateRef.current.selectedPartId);
            controllerRef.current = {
              resetCamera() {
                setModeCamera(stateRef.current.viewMode);
                camera.position.copy(cameraGoal);
                controls?.target.copy(defaultTarget).setY(targetGoal.y);
              },
              selectPart(partId) { selectPart(partId); },
              setMode: setModeCamera,
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

        const setPointer = (event: PointerEvent | MouseEvent) => {
          const rect = canvas.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        };
        const hitPart = () => {
          raycaster.setFromCamera(pointer, camera);
          const hits = raycaster.intersectObjects(partRuntimes.map((runtime) => runtime.object), true);
          const runtimes = hits
            .map((hit) => modelPartFromHit(hit.object))
            .filter((part): part is PartMesh => Boolean(part))
            .map((part) => partByName.get(part.name) ?? null)
            .filter((runtime): runtime is PartRuntime => Boolean(runtime));
          if (stateRef.current.viewMode === "transparent" || stateRef.current.viewMode === "structure") {
            return runtimes.find((runtime) => !EXTERNAL_PARTS.has(runtime.object.name) && runtime.object.name !== "PART__BEDPLATE")
              ?? runtimes.find((runtime) => !EXTERNAL_PARTS.has(runtime.object.name))
              ?? runtimes[0]
              ?? null;
          }
          return runtimes[0] ?? null;
        };
        const handlePointerDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
        const handlePointerMove = (event: PointerEvent) => {
          setPointer(event);
          hoveredRuntime = hitPart();
          canvas.classList.toggle("interactive", Boolean(hoveredRuntime));
        };
        const handlePointerLeave = () => {
          pointer.set(2, 2);
          hoveredRuntime = null;
          canvas.classList.remove("interactive");
        };
        const handleClick = (event: MouseEvent) => {
          if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return;
          setPointer(event);
          const runtime = hitPart();
          const businessPart = runtime ? businessPartForNode(runtime.object.name) : null;
          selectPart(businessPart?.id ?? null, true);
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

        const opacityForMode = (partName: string, mode: TurbineViewMode) => {
          const external = EXTERNAL_PARTS.has(partName);
          if (mode === "exterior") return external ? 1 : 0;
          if (mode === "wireframe") return WIREFRAME_PARTS.has(partName) ? 0.025 : partName === "PART__BEDPLATE" ? 0.66 : 0.82;
          if (mode === "transparent") {
            if (!HOLOGRAM_SHELL_PARTS.has(partName)) return partName === "PART__BEDPLATE" ? 0.72 : 0.84;
            if (partName === "PART__NACELLE_SHELL") return 0.46;
            if (partName === "PART__TOWER") return 0.28;
            return 0.39;
          }
          if (partName === "PART__NACELLE_SHELL") return 0;
          if (partName.startsWith("PART__BLADE_")) return 0.24;
          if (partName === "PART__HUB" || partName === "PART__SPINNER") return 0.3;
          if (partName === "PART__TOWER" || partName === "PART__YAW_BASE") return 0.28;
          return 1;
        };

        let lastFrame = performance.now();
        const animate = (now: number) => {
          if (disposed || !renderer) return;
          animationFrame = window.requestAnimationFrame(animate);
          const delta = Math.min((now - lastFrame) / 1000, 0.05);
          lastFrame = now;
          const mode = stateRef.current.viewMode;
          const animationEnabled = stateRef.current.animationEnabled;
          if (rotor && animationEnabled && mode !== "structure") {
            const rpm = Number(rotor.userData.rpm ?? 8.5);
            rotor.rotateOnAxis(rotorAxis, rpm * Math.PI * 2 / 60 * delta);
          }

          const materialBlend = 1 - Math.exp(-delta * 7.2);
          const positionBlend = 1 - Math.exp(-delta * 6.2);
          partRuntimes.forEach((runtime) => {
            const partName = runtime.object.name;
            const businessPart = businessPartForNode(partName);
            const targetOpacity = opacityForMode(partName, mode);
            const explodeFactor = mode === "structure" ? 1 : 0;
            const targetPosition = runtime.basePosition.clone().addScaledVector(runtime.explodeOffset, explodeFactor);
            runtime.object.position.lerp(targetPosition, positionBlend);
            if (targetOpacity > 0.01) runtime.object.visible = true;

            const isSelected = Boolean(businessPart && businessPart.id === stateRef.current.selectedPartId);
            const isHovered = runtime === hoveredRuntime;
            runtime.materials.forEach((entry) => {
              const material = entry.material;
              const nextClippingPlanes = mode === "exterior" && partName === "PART__MAIN_SHAFT"
                ? externalShaftClipPlanes
                : null;
              if (material.clippingPlanes !== nextClippingPlanes) {
                material.clippingPlanes = nextClippingPlanes;
                material.needsUpdate = true;
              }
              const isExternal = EXTERNAL_PARTS.has(partName);
              const hologramShell = HOLOGRAM_SHELL_PARTS.has(partName)
                && (mode === "transparent" || mode === "wireframe" || mode === "structure");
              const tintExternal = isExternal && (mode === "transparent" || (mode === "structure" && targetOpacity < 0.5));
              const targetColor = mode === "wireframe"
                ? WIREFRAME_PARTS.has(partName) ? wireColor : entry.mutedColor
                : mode === "exterior" && isExternal
                  ? exteriorColor
                  : tintExternal
                    ? cyanColor
                    : mode === "transparent"
                      ? entry.mutedColor
                      : entry.baseColor;
              material.color.lerp(targetColor, materialBlend);
              material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity * entry.baseOpacity, 7.2, delta);
              const targetRoughness = mode === "exterior" && isExternal
                ? 0.54
                : hologramShell
                  ? 0.34
                  : mode === "transparent" || mode === "wireframe"
                    ? 0.58
                    : entry.baseRoughness;
              const targetMetalness = mode === "exterior" && isExternal ? 0.04 : hologramShell ? 0.02 : mode === "transparent" || mode === "wireframe" ? 0.08 : entry.baseMetalness;
              material.roughness = THREE.MathUtils.damp(material.roughness, targetRoughness, 7.2, delta);
              material.metalness = THREE.MathUtils.damp(material.metalness, targetMetalness, 7.2, delta);
              const targetBlending = hologramShell && mode === "wireframe"
                ? THREE.AdditiveBlending
                : hologramShell
                  ? THREE.NormalBlending
                  : entry.baseBlending;
              const targetSide = hologramShell ? THREE.DoubleSide : entry.baseSide;
              if (material.blending !== targetBlending || material.side !== targetSide) {
                material.blending = targetBlending;
                material.side = targetSide;
                material.needsUpdate = true;
              }
              material.depthWrite = !hologramShell && material.opacity > 0.82 && mode !== "wireframe";
              const statusColor = businessPart?.status === "fault"
                ? faultColor
                : businessPart?.status === "abnormal"
                  ? warningColor
                  : entry.baseEmissive;
              const emissiveTarget = isSelected ? selectedColor : isHovered ? hoverColor : hologramShell ? cyanEmissive : statusColor;
              material.emissive.lerp(emissiveTarget, materialBlend);
              const targetIntensity = isSelected
                ? 0.92
                : isHovered
                  ? 0.46
                  : hologramShell
                    ? mode === "wireframe" ? 0.72 : 0.42
                    : businessPart?.status === "fault" || businessPart?.status === "abnormal"
                      ? 0.2
                      : mode === "transparent" || mode === "wireframe"
                        ? entry.baseEmissiveIntensity * 0.45
                        : entry.baseEmissiveIntensity;
              material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, targetIntensity, 8.2, delta);
            });

            const targetLineOpacity = mode === "wireframe"
              ? WIREFRAME_PARTS.has(partName)
                ? partName.startsWith("PART__BLADE_") || partName === "PART__HUB" ? 0.62 : 0.38
                : 0.025
              : mode === "transparent" && HOLOGRAM_SHELL_PARTS.has(partName)
                ? partName === "PART__NACELLE_SHELL" ? 0.16 : 0.1
                : mode === "exterior" && EXTERNAL_PARTS.has(partName)
                  ? 0.08
                  : isSelected ? 0.22 : 0;
            const targetEdgeOpacity = mode === "wireframe"
              ? WIREFRAME_PARTS.has(partName) ? 0.92 : 0.06
              : mode === "transparent" && HOLOGRAM_SHELL_PARTS.has(partName)
                ? 0.22
                : mode === "structure" && HOLOGRAM_SHELL_PARTS.has(partName) && targetOpacity > 0
                  ? 0.16
                  : 0;
            if (targetLineOpacity > 0.01) runtime.line.visible = true;
            runtime.lineMaterial.opacity = THREE.MathUtils.damp(runtime.lineMaterial.opacity, targetLineOpacity, 8, delta);
            if (targetLineOpacity === 0 && runtime.lineMaterial.opacity < 0.01) runtime.line.visible = false;
            if (targetEdgeOpacity > 0.01) runtime.edge.visible = true;
            runtime.edgeMaterial.opacity = THREE.MathUtils.damp(runtime.edgeMaterial.opacity, targetEdgeOpacity, 8, delta);
            if (targetEdgeOpacity === 0 && runtime.edgeMaterial.opacity < 0.01) runtime.edge.visible = false;
            if (targetOpacity === 0 && runtime.materials.every((entry) => entry.material.opacity < 0.012)) runtime.object.visible = false;
          });

          if (!controlsInteracting) {
            const cameraBlend = 1 - Math.exp(-delta * 5.6);
            camera.position.lerp(cameraGoal, cameraBlend);
            controls?.target.lerp(targetGoal, cameraBlend);
          }
          controls?.update(delta);
          renderer.render(scene, camera);

          hotspotByTarget.forEach((hotspot, target) => {
            const element = labelRefs.current[target];
            const runtime = partByName.get(target);
            if (!element || !runtime) return;
            hotspot.getWorldPosition(projected);
            projected.project(camera);
            const inView = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.06 && Math.abs(projected.y) < 1.06;
            const allowedByMode = mode !== "exterior" || EXTERNAL_PARTS.has(target);
            element.hidden = !inView || !allowedByMode || !runtime.object.visible;
            if (!element.hidden) element.style.transform = `translate3d(${(projected.x * 0.5 + 0.5) * host.clientWidth}px, ${(-projected.y * 0.5 + 0.5) * host.clientHeight}px, 0) translate(-50%, -50%)`;
          });

          const detail = detailRef.current;
          if (detail && selectedRuntime && selectedRuntime.object.visible) {
            const anchor = hotspotByTarget.get(selectedRuntime.object.name);
            if (anchor) anchor.getWorldPosition(projected);
            else new THREE.Box3().setFromObject(selectedRuntime.object).getCenter(projected);
            projected.project(camera);
            const visible = projected.z > -1 && projected.z < 1;
            detail.hidden = !visible;
            if (visible) {
              const x = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * host.clientWidth + 42, 12, host.clientWidth - 334);
              const y = THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * host.clientHeight - 48, 76, host.clientHeight - 190);
              detail.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }
          } else if (detail) detail.hidden = true;
        };
        animationFrame = window.requestAnimationFrame(animate);

        cleanups.push(() => {
          const textures = new Set<Texture>();
          scene.traverse((object) => {
            const mesh = object as Mesh;
            if (!mesh.isMesh && object.type !== "LineSegments") return;
            mesh.geometry?.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.filter(Boolean).forEach((material) => {
              Object.values(material).forEach((value) => { if ((value as Texture)?.isTexture) textures.add(value as Texture); });
              material.dispose();
            });
          });
          textures.forEach((texture) => texture.dispose());
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

  useEffect(() => { controllerRef.current?.selectPart(state.selectedPartId); }, [state.selectedPartId]);
  useEffect(() => { controllerRef.current?.setMode(state.viewMode); }, [state.viewMode]);

  const hotspotParts = useMemo(() => parts.filter((part) => HOTSPOT_TARGETS.has(part.modelNodeName)), [parts]);
  const selectedPart = parts.find((part) => part.id === state.selectedPartId);
  const selectedAlarm = selectedPart
    ? alarms.find((alarm) => alarm.partIds?.includes(selectedPart.modelNodeName) && alarm.status === "pending")
    : undefined;

  return (
    <div className={`turbine-twin-scene mode-${state.viewMode}`} ref={hostRef}>
      <canvas aria-label="可交互可拆解风机数字孪生" ref={canvasRef} />
      <div className="turbine-hotspot-layer" aria-label="风机部件热点">
        {hotspotParts.map((part) => (
          <button
            aria-pressed={state.selectedPartId === part.id}
            className={`${part.status} ${state.selectedPartId === part.id ? "active" : ""}`}
            key={part.id}
            onClick={() => onPartSelect(part.id)}
            ref={(element) => { labelRefs.current[part.modelNodeName] = element; }}
            type="button"
          >
            <i /><span>{part.name}</span><small>{STATUS_LABEL[part.status]}</small>
          </button>
        ))}
      </div>
      <div className={`turbine-part-card ${selectedPart?.status ?? "normal"}`} hidden={!selectedPart} ref={detailRef}>
        {selectedPart ? (
          <>
            <button aria-label="关闭部件详情" onClick={() => onPartSelect(null)} type="button">×</button>
            <header><i /><div><strong>{selectedPart.name}</strong><small>{selectedPart.modelNodeName}</small></div></header>
            <p className={selectedAlarm ? "alarm" : "normal"}>{selectedAlarm?.message ?? "当前部件未发现未处理故障"}</p>
            <dl>
              <div><dt>所属风机</dt><dd>{turbine.code}</dd></div>
              <div><dt>运行状态</dt><dd>{STATUS_LABEL[selectedPart.status]}</dd></div>
              <div><dt>实时传感</dt><dd>{sensorText(selectedPart, turbine)}</dd></div>
            </dl>
          </>
        ) : null}
      </div>
      {loadState === "loading" ? <div className="map-loader"><i style={{ "--progress": `${progress}%` } as CSSProperties} /><strong>可拆解风机模型加载中</strong><span>{progress}%</span></div> : null}
      {loadState === "error" || loadState === "unsupported" ? (
        <div className="map-fallback">
          <Image alt="可拆解风机静态备选图" fill src="/scenes/turbine.png" unoptimized />
          <div><strong>{loadState === "unsupported" ? "浏览器不支持 WebGL" : "三维场景加载失败"}</strong><span>已切换为静态备选图</span></div>
        </div>
      ) : null}
      {loadState === "ready" ? <button className="map-camera-reset" onClick={() => controllerRef.current?.resetCamera()} type="button">复位视角</button> : null}
    </div>
  );
}
