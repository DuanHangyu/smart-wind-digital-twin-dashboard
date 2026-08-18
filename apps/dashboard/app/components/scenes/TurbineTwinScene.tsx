"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Plane,
  PerspectiveCamera,
  Texture,
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
  baseColor: Color;
  baseEmissive: Color;
  baseEmissiveIntensity: number;
  baseMetalness: number;
  baseOpacity: number;
  baseRoughness: number;
  material: MeshStandardMaterial;
};

type PartRuntime = {
  basePosition: Vector3;
  explodeOffset: Vector3;
  line: LineSegments;
  lineMaterial: LineBasicMaterial;
  materials: MaterialRuntime[];
  object: PartMesh;
};

type SceneController = {
  resetCamera: () => void;
  selectPart: (partId: string | null) => void;
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
        scene.fog = new THREE.FogExp2(0x02090b, 0.027);
        const camera: PerspectiveCamera = new THREE.PerspectiveCamera(39, 1, 0.03, 100);
        const coarsePointer = matchMedia("(pointer: coarse)").matches;
        const defaultCamera = coarsePointer ? new THREE.Vector3(8.2, 4.8, 12.2) : new THREE.Vector3(9.4, 5.1, 11.8);
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
        renderer.toneMappingExposure = 1.18;

        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.065;
        controls.minDistance = 5;
        controls.maxDistance = 23;
        controls.minPolarAngle = 0.28;
        controls.maxPolarAngle = 1.55;
        controls.target.set(0, 0.2, 0);
        controls.autoRotate = stateRef.current.animationEnabled;
        controls.autoRotateSpeed = 0.34;

        const pauseCruise = () => {
          controlsInteracting = true;
          if (controls) controls.autoRotate = false;
        };
        const resumeCruise = () => {
          controlsInteracting = false;
          if (controls) controls.autoRotate = stateRef.current.animationEnabled;
        };
        controls.addEventListener("start", pauseCruise);
        controls.addEventListener("end", resumeCruise);
        cleanups.push(() => {
          controls?.removeEventListener("start", pauseCruise);
          controls?.removeEventListener("end", resumeCruise);
        });

        scene.add(new THREE.HemisphereLight(0xb9ffff, 0x071010, 2.25));
        const key = new THREE.DirectionalLight(0xe8ffff, 4.0);
        key.position.set(-4, 8, 7);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x16e8df, 4.2);
        rim.position.set(6, 4, -5);
        scene.add(rim);
        const fill = new THREE.DirectionalLight(0x477dff, 1.5);
        fill.position.set(-6, 2, -3);
        scene.add(fill);

        const grid = new THREE.GridHelper(20, 42, 0x087f82, 0x0a2d30);
        const gridMaterial = grid.material as import("three").Material;
        gridMaterial.transparent = true;
        gridMaterial.opacity = 0.25;
        scene.add(grid);
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(3.3, 3.34, 96),
          new THREE.MeshBasicMaterial({ color: 0x14b8b5, opacity: 0.28, side: THREE.DoubleSide, transparent: true }),
        );
        halo.rotation.x = -Math.PI / 2;
        scene.add(halo);

        const pivot = new THREE.Group();
        pivot.name = "MODEL_AUTO_CENTER_SCALE";
        scene.add(pivot);

        const partRuntimes: PartRuntime[] = [];
        const partByName = new Map<string, PartRuntime>();
        const hotspotByTarget = new Map<string, Object3D>();
        const rawHotspots: Object3D[] = [];
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2(2, 2);
        const projected = new THREE.Vector3();
        const cyanColor = new THREE.Color(0x39d7d3);
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

        const businessPartForNode = (nodeName: string) => partsRef.current.find((part) => part.modelNodeName === nodeName);
        const selectPart = (partId: string | null, notify = false) => {
          const businessPart = partId ? partsRef.current.find((part) => part.id === partId) : null;
          selectedRuntime = businessPart ? partByName.get(businessPart.modelNodeName) ?? null : null;
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
                baseColor: material.color.clone(),
                baseEmissive: material.emissive.clone(),
                baseEmissiveIntensity: material.emissiveIntensity,
                baseMetalness: material.metalness,
                baseOpacity: material.opacity,
                baseRoughness: material.roughness,
                material,
              }));
              const lineMaterial = new THREE.LineBasicMaterial({
                color: 0x46fff3,
                depthWrite: false,
                opacity: 0,
                transparent: true,
              });
              const line = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), lineMaterial);
              line.name = `FX__WIRE__${mesh.name}`;
              line.renderOrder = 18;
              line.visible = false;
              mesh.add(line);
              const runtime: PartRuntime = {
                basePosition: mesh.position.clone(),
                explodeOffset: blenderVectorToThree(mesh.userData.explode_vector),
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
            const scale = 8.15 / Math.max(size.x, size.y, size.z);
            pivot.scale.setScalar(scale);
            pivot.add(root);
            grid.position.y = -size.y * scale * 0.5 - 0.06;
            halo.position.y = grid.position.y + 0.012;
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
              rotorParent.remove(sourceRotor);
              rotor = runtimeRotor;
              partRuntimes.forEach((runtime) => {
                if (runtime.object.parent === runtimeRotor) runtime.basePosition.copy(runtime.object.position);
              });
              scene.updateMatrixWorld(true);
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

            selectPart(stateRef.current.selectedPartId);
            controllerRef.current = {
              resetCamera() {
                camera.position.copy(defaultCamera);
                controls?.target.set(0, 0.2, 0);
                controls?.update();
              },
              selectPart(partId) { selectPart(partId); },
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
          const hit = raycaster.intersectObjects(partRuntimes.map((runtime) => runtime.object), true)[0];
          const part = modelPartFromHit(hit?.object ?? null);
          return part ? partByName.get(part.name) ?? null : null;
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
          if (mode === "wireframe") return 0.045;
          if (mode === "transparent") {
            if (!external) return 1;
            if (partName === "PART__NACELLE_SHELL") return 0.18;
            if (partName === "PART__TOWER") return 0.22;
            return 0.34;
          }
          if (partName === "PART__NACELLE_SHELL") return 0.16;
          if (partName === "PART__TOWER" || partName === "PART__YAW_BASE") return 0.32;
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
          if (controls) controls.autoRotate = animationEnabled && !controlsInteracting;
          if (rotor && animationEnabled) {
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
              const tintExternal = EXTERNAL_PARTS.has(partName) && (mode === "transparent" || mode === "wireframe" || (mode === "structure" && targetOpacity < 0.5));
              material.color.lerp(tintExternal ? cyanColor : entry.baseColor, materialBlend);
              material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity * entry.baseOpacity, 7.2, delta);
              material.roughness = THREE.MathUtils.damp(material.roughness, tintExternal ? 0.16 : entry.baseRoughness, 7.2, delta);
              material.metalness = THREE.MathUtils.damp(material.metalness, tintExternal ? 0.08 : entry.baseMetalness, 7.2, delta);
              material.depthWrite = material.opacity > 0.82 && mode !== "wireframe";
              const statusColor = businessPart?.status === "fault"
                ? faultColor
                : businessPart?.status === "abnormal"
                  ? warningColor
                  : entry.baseEmissive;
              const emissiveTarget = isSelected ? selectedColor : isHovered ? hoverColor : statusColor;
              material.emissive.lerp(emissiveTarget, materialBlend);
              const targetIntensity = isSelected ? 0.92 : isHovered ? 0.46 : businessPart?.status === "fault" || businessPart?.status === "abnormal" ? 0.24 : entry.baseEmissiveIntensity;
              material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, targetIntensity, 8.2, delta);
            });

            const targetLineOpacity = mode === "wireframe" ? 0.78 : isSelected ? 0.22 : 0;
            if (targetLineOpacity > 0.01) runtime.line.visible = true;
            runtime.lineMaterial.opacity = THREE.MathUtils.damp(runtime.lineMaterial.opacity, targetLineOpacity, 8, delta);
            if (targetLineOpacity === 0 && runtime.lineMaterial.opacity < 0.01) runtime.line.visible = false;
            if (targetOpacity === 0 && runtime.materials.every((entry) => entry.material.opacity < 0.012)) runtime.object.visible = false;
          });

          controls?.update(delta);
          halo.rotation.z += animationEnabled ? delta * 0.08 : 0;
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
            const anchor = hotspotByTarget.get(selectedRuntime.object.name) ?? selectedRuntime.object;
            anchor.getWorldPosition(projected);
            projected.project(camera);
            const visible = projected.z > -1 && projected.z < 1;
            detail.hidden = !visible;
            if (visible) {
              const x = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * host.clientWidth + 36, 12, host.clientWidth - 246);
              const y = THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * host.clientHeight - 74, 46, host.clientHeight - 164);
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
