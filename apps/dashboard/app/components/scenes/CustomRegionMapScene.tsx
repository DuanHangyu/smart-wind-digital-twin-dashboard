"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Texture,
} from "three";
import type { RegionRecord, StatisticsSceneState } from "../../types/dashboard";

type LoadState = "loading" | "ready" | "error" | "unsupported";

// Reference-directed opening shot: a lower exhibition angle compresses the
// top surface and lets the luminous extruded sides carry the composition.
const MAP_CAMERA_POSITION = [0, 7.45, 11.8] as const;
const MAP_CAMERA_TARGET = [0, -0.12, 0] as const;

type SceneController = {
  selectRegion: (code: string) => void;
  hoverRegion: (code: string | null) => void;
  setAutoRotate: (enabled: boolean) => void;
  setTurbinesVisible: (visible: boolean) => void;
  resetCamera: () => void;
};

type RegionObject = Group & {
  userData: {
    baseY: number;
    targetY: number;
    region_id?: string;
    display_name?: string;
  };
};

function getRegionCode(object: Object3D | null) {
  let current = object;
  while (current && !current.name.startsWith("PART__REGION_")) current = current.parent;
  return current?.userData.region_id as string | undefined;
}

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

export function CustomRegionMapScene({
  regions,
  state,
  hoveredRegionCode,
  onRegionSelect,
  onRegionHover,
}: {
  regions: RegionRecord[];
  state: StatisticsSceneState;
  hoveredRegionCode: string | null;
  onRegionSelect: (code: string) => void;
  onRegionHover: (code: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const controllerRef = useRef<SceneController | null>(null);
  const sceneStateRef = useRef(state);
  const selectCallbackRef = useRef(onRegionSelect);
  const hoverCallbackRef = useRef(onRegionHover);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [progress, setProgress] = useState(0);

  useEffect(() => { sceneStateRef.current = state; }, [state]);
  useEffect(() => { selectCallbackRef.current = onRegionSelect; }, [onRegionSelect]);
  useEffect(() => { hoverCallbackRef.current = onRegionHover; }, [onRegionHover]);

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
        scene.fog = new THREE.FogExp2(0x02090b, 0.027);
        const camera: PerspectiveCamera = new THREE.PerspectiveCamera(33, 1, 0.05, 100);
        const defaultCamera = new THREE.Vector3(...MAP_CAMERA_POSITION);
        const defaultTarget = new THREE.Vector3(...MAP_CAMERA_TARGET);
        camera.position.copy(defaultCamera);

        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: !matchMedia("(pointer: coarse)").matches,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia("(pointer: coarse)").matches ? 1.35 : 1.8));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;

        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.065;
        controls.minDistance = 8.2;
        controls.maxDistance = 20;
        controls.minPolarAngle = 0.42;
        controls.maxPolarAngle = 1.38;
        controls.target.copy(defaultTarget);
        // Region cycling and turbine movement are data animations. Keeping the
        // camera independent preserves the reference-directed opening shot.
        controls.autoRotate = false;

        scene.add(new THREE.HemisphereLight(0x73f7f0, 0x01090c, 0.64));
        const keyLight = new THREE.DirectionalLight(0xc8ffff, 1.22);
        keyLight.position.set(-5, 9, 6);
        scene.add(keyLight);
        const rimLight = new THREE.PointLight(0x00f4e6, 6.5, 32, 2);
        rimLight.position.set(5.5, 4.2, -3.5);
        scene.add(rimLight);

        const pivot = new THREE.Group();
        pivot.name = "MODEL_AUTO_CENTER_SCALE";
        scene.add(pivot);

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2(2, 2);
        const parts: RegionObject[] = [];
        const partByCode = new Map<string, RegionObject>();
        const hotspots = new Map<string, Object3D>();
        const hologramMaterials: MeshStandardMaterial[] = [];
        let selectedPart: RegionObject | null = null;
        let hoverPart: RegionObject | null = null;
        let turbineGroup: Group | null = null;
        let turbineAnimationEnabled = sceneStateRef.current.autoHighlightEnabled;
        const turbineRotors: Object3D[] = [];
        let pointerDown = { x: 0, y: 0 };

        const setPointer = (event: PointerEvent) => {
          const rect = canvas.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        };

        const enhanceRegionMaterial = (material: MeshStandardMaterial, isOutline: boolean, regionVariation: number) => {
          material.metalness = isOutline ? 0.01 : 0.04;
          material.roughness = isOutline ? 0.16 : 0.38;
          material.color.setHex(isOutline ? 0xb8fff9 : 0x119c95).offsetHSL(0, 0, regionVariation);
          material.emissive.setHex(isOutline ? 0x5afff4 : 0x00aaa3);
          material.emissiveIntensity = isOutline ? 2.35 : 0.72 + regionVariation;
          material.userData.selectionLevel = 0;
          material.userData.regionVariation = regionVariation;

          if (isOutline) {
            material.transparent = true;
            material.opacity = 0.96;
            material.depthWrite = false;
            return;
          }

          material.onBeforeCompile = (shader) => {
            shader.uniforms.uHologramTime = { value: 0 };
            shader.uniforms.uSelectionLevel = { value: material.userData.selectionLevel as number };
            shader.uniforms.uRegionVariation = { value: material.userData.regionVariation as number };
            material.userData.hologramShader = shader;
            shader.vertexShader = shader.vertexShader
              .replace(
                "#include <common>",
                "#include <common>\nvarying vec3 vRegionPosition;\nvarying vec3 vRegionNormal;",
              )
              .replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\nvRegionPosition = position;\nvRegionNormal = normal;",
              );
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <common>",
                "#include <common>\nvarying vec3 vRegionPosition;\nvarying vec3 vRegionNormal;\nuniform float uHologramTime;\nuniform float uSelectionLevel;\nuniform float uRegionVariation;",
              )
              .replace(
                "#include <emissivemap_fragment>",
                `#include <emissivemap_fragment>
                float topMask = smoothstep(0.54, 0.92, abs(vRegionNormal.y));
                float sideMask = 1.0 - topMask;
                vec2 dotCell = abs(fract(vRegionPosition.xz * 31.0) - 0.5);
                float dotMask = 1.0 - smoothstep(0.035, 0.112, length(dotCell));
                float scanPhase = fract((vRegionPosition.x + vRegionPosition.z) * 0.12 - uHologramTime * 0.075);
                float scanBand = 1.0 - smoothstep(0.0, 0.075, abs(scanPhase - 0.5));
                float sideStripe = pow(1.0 - abs(sin((vRegionPosition.x + vRegionPosition.z) * 17.0)), 13.0);
                float sideHeight = clamp(vRegionPosition.y * 3.0 + 0.5, 0.0, 1.0);
                float bottomGlow = pow(1.0 - sideHeight, 1.75);
                totalEmissiveRadiance += topMask * vec3(0.0, 0.085 + uRegionVariation, 0.078 + uRegionVariation);
                totalEmissiveRadiance += topMask * dotMask * vec3(0.045, 0.42, 0.375);
                totalEmissiveRadiance += topMask * scanBand * vec3(0.02, 0.16, 0.145);
                totalEmissiveRadiance += topMask * uSelectionLevel * vec3(0.025, 0.25, 0.22);
                totalEmissiveRadiance += sideMask * vec3(0.0, 0.045, 0.075);
                totalEmissiveRadiance += sideMask * sideStripe * vec3(0.0, 0.36, 0.48);
                totalEmissiveRadiance += sideMask * bottomGlow * vec3(0.0, 0.34, 0.46);
                totalEmissiveRadiance += sideMask * uSelectionLevel * vec3(0.01, 0.18, 0.22);`,
              )
              .replace(
                "#include <color_fragment>",
                `#include <color_fragment>
                float surfaceTopMask = smoothstep(0.54, 0.92, abs(vRegionNormal.y));
                diffuseColor.rgb = mix(
                  diffuseColor.rgb * vec3(0.12, 0.5, 0.64),
                  diffuseColor.rgb * vec3(0.45, 1.08, 1.0) + uSelectionLevel * vec3(0.14, 0.32, 0.3),
                  surfaceTopMask
                );`,
              );
          };
          material.customProgramCacheKey = () => "p01-hologram-surface-v2";
          hologramMaterials.push(material);
        };

        const setMaterialState = (part: RegionObject, visual: "default" | "hover" | "selected") => {
          part.userData.targetY = part.userData.baseY + (visual === "selected" ? 0.035 : visual === "hover" ? 0.016 : 0);
          part.traverse((child) => {
            const mesh = child as Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((entry) => {
              const material = entry as MeshStandardMaterial;
              if (!material.emissive) return;
              const selectionLevel = visual === "selected" ? 1 : visual === "hover" ? 0.42 : 0;
              material.userData.selectionLevel = selectionLevel;
              const shader = material.userData.hologramShader as { uniforms?: { uSelectionLevel?: { value: number } } } | undefined;
              if (shader?.uniforms?.uSelectionLevel) shader.uniforms.uSelectionLevel.value = selectionLevel;
              if (visual === "selected") {
                material.color.setHex(child.name.startsWith("FX__OUTLINE_") ? 0xe8fffd : 0x32cfc7);
                material.emissive.setHex(child.name.startsWith("FX__OUTLINE_") ? 0x8ffff8 : 0x0bded5);
                material.emissiveIntensity = child.name.startsWith("FX__OUTLINE_") ? 3.25 : 1.26;
              } else if (visual === "hover") {
                material.color.copy(material.userData.baseColor).lerp(new THREE.Color(0x7efff6), 0.3);
                material.emissive.setHex(child.name.startsWith("FX__OUTLINE_") ? 0x79fff6 : 0x0de0d6);
                material.emissiveIntensity = child.name.startsWith("FX__OUTLINE_") ? 2.75 : 1.18;
              } else {
                material.color.copy(material.userData.baseColor);
                material.emissive.copy(material.userData.baseEmissive);
                material.emissiveIntensity = material.userData.baseEmissiveIntensity;
              }
            });
          });
        };

        const selectRegion = (code: string) => {
          const next = partByCode.get(code);
          if (!next || next === selectedPart) return;
          if (selectedPart) setMaterialState(selectedPart, "default");
          selectedPart = next;
          setMaterialState(next, "selected");
        };

        const hoverRegion = (code: string | null) => {
          const next = code ? partByCode.get(code) ?? null : null;
          if (next === hoverPart) return;
          if (hoverPart && hoverPart !== selectedPart) setMaterialState(hoverPart, "default");
          hoverPart = next;
          if (hoverPart && hoverPart !== selectedPart) setMaterialState(hoverPart, "hover");
          canvas.classList.toggle("interactive", Boolean(hoverPart));
        };

        const createTurbine = () => {
          const marker = new THREE.Group();
          const material = new THREE.MeshBasicMaterial({
            color: 0xc8fffb,
            depthWrite: false,
            opacity: 0.92,
            side: THREE.DoubleSide,
            transparent: true,
          });
          const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.055, 16), material);
          base.position.y = 0.028;
          marker.add(base);
          const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.082, 0.82, 10), material);
          tower.position.y = 0.44;
          marker.add(tower);
          const nacelle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.13), material);
          nacelle.position.set(0.08, 0.88, -0.035);
          marker.add(nacelle);
          const rotor = new THREE.Group();
          rotor.position.set(-0.075, 0.88, 0.045);
          marker.add(rotor);
          const hub = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), material);
          rotor.add(hub);
          turbineRotors.push(rotor);
          const bladeShape = new THREE.Shape();
          bladeShape.moveTo(-0.038, 0.04);
          bladeShape.bezierCurveTo(-0.062, 0.16, -0.052, 0.42, -0.025, 0.62);
          bladeShape.lineTo(0.018, 0.62);
          bladeShape.bezierCurveTo(0.034, 0.4, 0.038, 0.16, 0.038, 0.04);
          bladeShape.closePath();
          const bladeGeometry = new THREE.ShapeGeometry(bladeShape, 5);
          for (let index = 0; index < 3; index += 1) {
            const blade = new THREE.Mesh(bladeGeometry, material);
            blade.rotation.z = (Math.PI * 2 * index) / 3;
            rotor.add(blade);
          }
          const halo = new THREE.Mesh(
            new THREE.RingGeometry(0.15, 0.235, 32),
            new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, color: 0x3affee, depthWrite: false, opacity: 0.62, side: THREE.DoubleSide, transparent: true }),
          );
          halo.rotation.x = -Math.PI / 2;
          halo.position.y = 0.015;
          marker.add(halo);
          const anchorBeam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.045, 0.3, 10),
            new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, color: 0x38fff1, depthWrite: false, opacity: 0.35, transparent: true }),
          );
          anchorBeam.position.y = 0.15;
          marker.add(anchorBeam);
          marker.scale.setScalar(0.82);
          marker.userData.isTurbineMarker = true;
          return marker;
        };

        ktx2Loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
        const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader);
        gltfLoader.load(
          "/models/custom-map.glb",
          (gltf) => {
            if (disposed) return;
            const root = gltf.scene;
            root.traverse((object) => {
              if (object.name.startsWith("PART__REGION_")) {
                const part = object as RegionObject;
                part.userData.baseY = part.position.y;
                part.userData.targetY = part.position.y;
                parts.push(part);
                if (part.userData.region_id) partByCode.set(part.userData.region_id, part);
              }
              if (object.name.startsWith("HOTSPOT__REGION_")) {
                const code = object.userData.region_id as string | undefined;
                if (code) hotspots.set(code, object);
              }
              const mesh = object as Mesh;
              if (!mesh.isMesh) return;
              const regionCode = getRegionCode(object) ?? "00";
              const regionVariation = ((Number(regionCode) || 0) % 5) * 0.012;
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              const cloned = materials.map((entry) => {
                const material = entry.clone() as MeshStandardMaterial;
                enhanceRegionMaterial(material, object.name.startsWith("FX__OUTLINE_"), regionVariation);
                if (material.emissive) {
                  material.userData.baseColor = material.color.clone();
                  material.userData.baseEmissive = material.emissive.clone();
                  material.userData.baseEmissiveIntensity = material.emissiveIntensity;
                }
                return material;
              });
              mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
            });

            const bounds = new THREE.Box3().setFromObject(root);
            const center = bounds.getCenter(new THREE.Vector3());
            const size = bounds.getSize(new THREE.Vector3());
            const scale = 10.4 / Math.max(size.x, size.z);
            root.position.copy(center).multiplyScalar(-1);
            pivot.scale.set(scale, scale * 1.45, scale);
            pivot.add(root);

            turbineGroup = new THREE.Group();
            turbineGroup.name = "LAYER__TURBINES";
            ["01", "04", "08", "13"].forEach((code) => {
              const hotspot = hotspots.get(code);
              if (!hotspot) return;
              const marker = createTurbine();
              marker.position.copy(hotspot.position);
              marker.position.y = 0.86;
              turbineGroup?.add(marker);
            });
            root.add(turbineGroup);
            turbineGroup.visible = sceneStateRef.current.turbineLayerVisible;

            selectRegion(sceneStateRef.current.selectedRegionCode);
            controllerRef.current = {
              selectRegion,
              hoverRegion,
              setAutoRotate(enabled) { turbineAnimationEnabled = enabled; },
              setTurbinesVisible(visible) { if (turbineGroup) turbineGroup.visible = visible; },
              resetCamera() { camera.position.copy(defaultCamera); controls?.target.copy(defaultTarget); controls?.update(); },
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
          const code = getRegionCode(hit?.object ?? null);
          const next = code ? partByCode.get(code) ?? null : null;
          if (next === hoverPart) return;
          hoverRegion(code ?? null);
          hoverCallbackRef.current(code ?? null);
        };

        const handlePointerDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
        const handlePointerMove = (event: PointerEvent) => { setPointer(event); updateHover(); };
        const handlePointerLeave = () => {
          pointer.set(2, 2);
          hoverRegion(null);
          hoverCallbackRef.current(null);
        };
        const handleClick = (event: MouseEvent) => {
          if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return;
          setPointer(event as PointerEvent);
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(parts, true)[0];
          const code = getRegionCode(hit?.object ?? null);
          if (code) { selectRegion(code); selectCallbackRef.current(code); }
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
        const animate = () => {
          if (disposed || !renderer) return;
          animationFrame = window.requestAnimationFrame(animate);
          parts.forEach((part) => { part.position.y += (part.userData.targetY - part.position.y) * 0.14; });
          if (turbineAnimationEnabled) turbineRotors.forEach((rotor) => { rotor.rotation.z -= 0.012; });
          const hologramTime = performance.now() * 0.001;
          hologramMaterials.forEach((material) => {
            const shader = material.userData.hologramShader as { uniforms?: { uHologramTime?: { value: number } } } | undefined;
            if (shader?.uniforms?.uHologramTime) shader.uniforms.uHologramTime.value = hologramTime;
          });
          controls?.update();
          renderer.render(scene, camera);

          hotspots.forEach((hotspot, code) => {
            const element = labelRefs.current[code];
            if (!element) return;
            hotspot.getWorldPosition(projected);
            projected.project(camera);
            const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08;
            element.hidden = !visible;
            element.style.transform = `translate3d(${(projected.x * 0.5 + 0.5) * host.clientWidth}px, ${(-projected.y * 0.5 + 0.5) * host.clientHeight}px, 0) translate(-50%, -50%)`;
          });
        };
        animationFrame = window.requestAnimationFrame(animate);

        cleanups.push(() => {
          scene.traverse((object) => {
            const mesh = object as Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => {
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

  useEffect(() => { controllerRef.current?.selectRegion(state.selectedRegionCode); }, [state.selectedRegionCode]);
  useEffect(() => { controllerRef.current?.hoverRegion(hoveredRegionCode); }, [hoveredRegionCode]);
  useEffect(() => { controllerRef.current?.setAutoRotate(state.autoHighlightEnabled && !hoveredRegionCode); }, [hoveredRegionCode, state.autoHighlightEnabled]);
  useEffect(() => { controllerRef.current?.setTurbinesVisible(state.turbineLayerVisible); }, [state.turbineLayerVisible]);

  const selected = hoveredRegionCode ?? state.selectedRegionCode;
  return (
    <div className={`custom-map-scene ${state.landmarkLayerVisible ? "labels-visible" : "labels-hidden"}`} ref={hostRef}>
      <div aria-hidden="true" className="map-hologram-field"><i /><i /><span /></div>
      <canvas aria-label="可交互自定义区域三维地图" ref={canvasRef} />
      <div className="map-hotspot-layer" aria-label="区域热点">
        {regions.map((region) => (
          <button
            aria-pressed={selected === region.regionCode}
            className={selected === region.regionCode ? "active" : ""}
            key={region.regionCode}
            onClick={() => onRegionSelect(region.regionCode)}
            onMouseEnter={() => onRegionHover(region.regionCode)}
            onMouseLeave={() => onRegionHover(null)}
            ref={(element) => { labelRefs.current[region.regionCode] = element; }}
            type="button"
          >
            <i /><span>{region.regionName}</span><small>{region.percentage}%</small>
          </button>
        ))}
      </div>
      {loadState === "loading" ? <div className="map-loader"><i style={{ "--progress": `${progress}%` } as CSSProperties} /><strong>自定义区域模型加载中</strong><span>{progress}%</span></div> : null}
      {loadState === "error" || loadState === "unsupported" ? (
        <div className="map-fallback">
          <Image alt="自定义区域地图静态备选图" fill src="/scenes/custom-map.png" unoptimized />
          <div><strong>{loadState === "unsupported" ? "浏览器不支持 WebGL" : "三维场景加载失败"}</strong><span>已切换为静态备选图</span></div>
        </div>
      ) : null}
      {loadState === "ready" ? <button className="map-camera-reset" onClick={() => controllerRef.current?.resetCamera()} type="button">复位视角</button> : null}
    </div>
  );
}
