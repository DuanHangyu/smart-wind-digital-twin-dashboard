"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlarmList,
  DataStatusBadge,
  EnvironmentPanel,
  EquipmentStatusTable,
  RankingList,
  RealtimeMetricsBar,
  SegmentedBarChart,
  StatusDonut,
  SummaryPanel,
  TrendChart,
} from "./components/dashboard/Telemetry";
import { CustomRegionMapScene } from "./components/scenes/CustomRegionMapScene";
import { TurbineTwinScene } from "./components/scenes/TurbineTwinScene";
import { WindFarmTerrainScene } from "./components/scenes/WindFarmTerrainScene";
import { useMockDashboard } from "./hooks/useMockDashboard";
import { useTweenNumber } from "./hooks/useTweenNumber";
import type {
  DashboardMeta,
  DashboardSnapshot,
  DashboardUiState,
  DataStatus,
  OperationsSceneState,
  PageId,
  StatisticsSceneState,
  TurbineViewMode,
  WindfarmSceneState,
} from "./types/dashboard";

const DESIGN_WIDTH = 2560;
const DESIGN_HEIGHT = 1080;
const WINDFARM_MODEL_TURBINE_IDS = ["T-A01", "T-A02", "T-A04"];

const navigation: Array<{ id: PageId; label: string; code: string }> = [
  { id: "windfarm", label: "风场管理", code: "P02" },
  { id: "statistics", label: "统计视图", code: "P01" },
  { id: "operations", label: "运维管理", code: "P03" },
];

function BottomHudArtwork() {
  return (
    <svg aria-hidden="true" className="bottom-hud-artwork" focusable="false" preserveAspectRatio="none" viewBox="0 0 2560 60">
      <defs>
        <linearGradient id="bottom-rail-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#00dcd5" stopOpacity="0.08" />
          <stop offset="0.14" stopColor="#00dcd5" stopOpacity="0.42" />
          <stop offset="0.84" stopColor="#00dcd5" stopOpacity="0.28" />
          <stop offset="1" stopColor="#00dcd5" stopOpacity="0.58" />
        </linearGradient>
        <pattern height="8" id="bottom-rail-ticks" patternUnits="userSpaceOnUse" width="9">
          <rect fill="#25e5dc" height="8" width="3" />
        </pattern>
      </defs>
      <g className="bottom-hud-rail-art">
        <path className="bottom-hud-line bottom-hud-line-primary" d="M0 38 H900 L938 18 H955" />
        <path className="bottom-hud-line bottom-hud-line-secondary" d="M45 51 H895 L930 37 H950" />
        <path className="bottom-hud-line bottom-hud-line-faint" d="M0 55 H868" />
        <path className="bottom-hud-line bottom-hud-line-shoulder" d="M900 38 L934 25 H950" />
        <path className="bottom-hud-line bottom-hud-line-accent" d="M644 25 H704 M754 25 H814" />
        <path className="bottom-hud-line bottom-hud-line-dots" d="M205 30 H260" />
        <rect className="bottom-hud-ticks" fill="url(#bottom-rail-ticks)" height="8" width="62" x="315" y="26" />
        <rect className="bottom-hud-node" height="9" width="10" x="732" y="28" />
        <path className="bottom-hud-end" d="M2 37 10 29h7l-8 8m12 0 8-8h7l-8 8m12 0 8-8h7l-8 8m12 0 8-8h7l-8 8" />
      </g>
      <g className="bottom-hud-rail-art" transform="translate(2560 0) scale(-1 1)">
        <path className="bottom-hud-line bottom-hud-line-primary" d="M0 38 H900 L938 18 H955" />
        <path className="bottom-hud-line bottom-hud-line-secondary" d="M45 51 H895 L930 37 H950" />
        <path className="bottom-hud-line bottom-hud-line-faint" d="M0 55 H868" />
        <path className="bottom-hud-line bottom-hud-line-shoulder" d="M900 38 L934 25 H950" />
        <path className="bottom-hud-line bottom-hud-line-accent" d="M644 25 H704 M754 25 H814" />
        <path className="bottom-hud-line bottom-hud-line-dots" d="M205 30 H260" />
        <rect className="bottom-hud-ticks" fill="url(#bottom-rail-ticks)" height="8" width="62" x="315" y="26" />
        <rect className="bottom-hud-node" height="9" width="10" x="732" y="28" />
        <path className="bottom-hud-end" d="M2 37 10 29h7l-8 8m12 0 8-8h7l-8 8m12 0 8-8h7l-8 8m12 0 8-8h7l-8 8" />
      </g>
      <path className="bottom-hud-center-line" d="M900 52 H1020 M1540 52 H1660" />
      <path className="bottom-hud-center-cap" d="M918 34 938 5 H1622 L1642 34" />
    </svg>
  );
}

const initialUiState: DashboardUiState = {
  statistics: {
    turbineLayerVisible: true,
    landmarkLayerVisible: true,
    autoHighlightEnabled: true,
    selectedRegionCode: "01",
  },
  windfarm: {
    waterVisible: true,
    projectionEnabled: false,
    circuitVisible: false,
    selectedTurbineId: null,
  },
  operations: {
    viewMode: "transparent",
    animationEnabled: true,
    selectedPartId: null,
  },
};

function SceneMetric({ value, unit }: { value: number | null; unit: string }) {
  const tweened = useTweenNumber(value);
  return <><b>{tweened === null ? "--" : tweened.toFixed(2)}</b> <small>{unit}</small></>;
}

function LayerControls({
  page,
  statistics,
  windfarm,
  operations,
  onStatisticsChange,
  onWindfarmChange,
  onOperationsChange,
}: {
  page: PageId;
  statistics: StatisticsSceneState;
  windfarm: WindfarmSceneState;
  operations: OperationsSceneState;
  onStatisticsChange: (next: Partial<StatisticsSceneState>) => void;
  onWindfarmChange: (next: Partial<WindfarmSceneState>) => void;
  onOperationsChange: (next: Partial<OperationsSceneState>) => void;
}) {
  if (page === "statistics") {
    const controls = [
      ["风机", statistics.turbineLayerVisible, () => onStatisticsChange({ turbineLayerVisible: !statistics.turbineLayerVisible })],
      ["地标", statistics.landmarkLayerVisible, () => onStatisticsChange({ landmarkLayerVisible: !statistics.landmarkLayerVisible })],
      ["动画", statistics.autoHighlightEnabled, () => onStatisticsChange({ autoHighlightEnabled: !statistics.autoHighlightEnabled })],
    ] as const;
    return (
      <div className="layer-controls statistics" aria-label="统计场景控制">
        {controls.map(([label, active, action]) => <button aria-pressed={active} className={active ? "active" : ""} key={label} onClick={action} type="button"><span>{label}</span></button>)}
      </div>
    );
  }

  if (page === "windfarm") {
    return (
      <div className="layer-controls windfarm" aria-label="风场场景控制">
        <button aria-pressed={windfarm.waterVisible} className={windfarm.waterVisible ? "active" : ""} onClick={() => onWindfarmChange({ waterVisible: !windfarm.waterVisible })} type="button"><span>水面</span></button>
        <button aria-pressed={windfarm.projectionEnabled} className={windfarm.projectionEnabled ? "active" : ""} onClick={() => onWindfarmChange({ projectionEnabled: !windfarm.projectionEnabled })} type="button"><span>投影</span></button>
        <button aria-pressed={false} disabled type="button"><span>电路</span><small>待配置</small></button>
      </div>
    );
  }

  const modes: Array<[string, TurbineViewMode]> = [
    ["外部", "exterior"], ["透视", "transparent"], ["线框", "wireframe"], ["结构", "structure"],
  ];
  return (
    <div className="layer-controls operations" aria-label="风机显示模式">
      {modes.map(([label, mode]) => (
        <button aria-pressed={operations.viewMode === mode} className={operations.viewMode === mode ? "active" : ""} key={mode} onClick={() => onOperationsChange({ selectedPartId: null, viewMode: mode })} type="button"><span>{label}</span></button>
      ))}
      <button aria-pressed={operations.animationEnabled} className={operations.animationEnabled ? "active" : ""} onClick={() => onOperationsChange({ animationEnabled: !operations.animationEnabled })} type="button"><span>动画</span></button>
    </div>
  );
}

function SceneViewport({
  page,
  name,
  metric,
  unit,
  image,
  scene,
  status,
  className = "",
  controls,
  sceneBadge = "W2 LIVE MOCK",
  sceneProgress = "W3–W5 接入三维交互",
  children,
}: {
  page: PageId;
  name: string;
  metric: number | null;
  unit: string;
  image?: string;
  scene?: ReactNode;
  status: DataStatus;
  className?: string;
  controls: ReactNode;
  sceneBadge?: string;
  sceneProgress?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`scene-viewport scene-${page} ${className}`} data-status={status}>
      <div className="scene-grid" /><div className="scene-scan" />
      {page === "statistics" || page === "operations" ? (
        <>
          <div aria-hidden="true" className="map-panel-titlebar"><i /><strong>{page === "operations" ? "风机详情" : "3d地图"}</strong><span /></div>
          <div aria-hidden="true" className="map-panel-inner-frame"><i /><i /><i /><i /></div>
        </>
      ) : null}
      <header className="scene-header">
        <div><span className="scene-index">●</span><strong>{name}</strong></div>
        <p>总发电量 <SceneMetric value={metric} unit={unit} /></p>
      </header>
      <p className="scene-disclaimer">内含模型为技术展示效果，非现实场景及工业效果</p>
      {scene ?? (
        <div className="scene-image-wrap">
          <div className="scene-orbit orbit-outer" /><div className="scene-orbit orbit-inner" />
          <Image src={image ?? "/scenes/custom-map.png"} alt={`${name}静态场景预览`} width={1200} height={820} unoptimized />
          <div className="scene-glow" />
        </div>
      )}
      {controls}
      {children}
      <div className="scene-placeholder-badge"><span>{sceneBadge}</span><strong>1 Hz 数据驱动 · {sceneProgress}</strong></div>
    </section>
  );
}

type PageProps = {
  data: DashboardSnapshot;
  ui: DashboardUiState;
  controls: (page: PageId) => ReactNode;
};

function StatisticsPage({
  data,
  ui,
  controls,
  hoveredRegionCode,
  onRegionHover,
  onRegionSelect,
}: PageProps & {
  hoveredRegionCode: string | null;
  onRegionHover: (code: string | null) => void;
  onRegionSelect: (code: string) => void;
}) {
  const effectiveRegionCode = hoveredRegionCode ?? ui.statistics.selectedRegionCode;
  const selectedRegion = data.regions.find((item) => item.regionCode === effectiveRegionCode) ?? data.regions[0];
  const classes = [
    ui.statistics.turbineLayerVisible ? "" : "turbines-hidden",
    ui.statistics.landmarkLayerVisible ? "" : "landmarks-hidden",
    ui.statistics.autoHighlightEnabled ? "auto-highlight" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className="page-layout page-statistics">
      <aside className="column column-left">
        <SummaryPanel summary={data.summary} status={data.dataStatus} />
        <SegmentedBarChart data={data.monthlyPower} status={data.dataStatus} />
        <StatusDonut summary={data.summary} status={data.dataStatus} />
      </aside>
      <main className="center-column">
        <SceneViewport
          className={classes}
          controls={controls("statistics")}
          metric={data.summary.totalGenerationKWh}
          name="自定义区域"
          page="statistics"
          scene={<CustomRegionMapScene hoveredRegionCode={hoveredRegionCode} onRegionHover={onRegionHover} onRegionSelect={onRegionSelect} regions={data.regions} state={ui.statistics} />}
          sceneBadge="W3 REAL GLB"
          sceneProgress="14 区真实节点联动"
          status={data.dataStatus}
          unit="kWh"
        >
          <div className="map-status"><span>{selectedRegion?.regionName ?? "--"}</span><small>当前区域 · {selectedRegion ? `${selectedRegion.percentage}%` : "--"}</small></div>
          <div className="region-cycle-status"><i /><span>{ui.statistics.autoHighlightEnabled ? "区域自动轮播中" : "区域轮播已暂停"}</span><small>{ui.statistics.selectedRegionCode}/14</small></div>
        </SceneViewport>
      </main>
      <aside className="column column-right">
        <RankingList regions={data.regions} status={data.dataStatus} />
        <TrendChart data={data.generationTrend} status={data.dataStatus} />
        <AlarmList alarms={data.alarms} status={data.dataStatus} />
      </aside>
    </div>
  );
}

function WindfarmPage({
  data,
  ui,
  controls,
  onTurbineSelect,
}: PageProps & { onTurbineSelect: (turbineId: string | null) => void }) {
  const classes = [ui.windfarm.projectionEnabled ? "projection-mode" : "", ui.windfarm.waterVisible ? "" : "water-hidden"].filter(Boolean).join(" ");
  return (
    <div className="page-layout page-windfarm">
      <aside className="column column-left">
        <EnvironmentPanel data={data.environment} status={data.dataStatus} />
        <TrendChart data={data.generationTrend} status={data.dataStatus} title="风电历史功率" />
        <RankingList regions={data.regions} status={data.dataStatus} />
      </aside>
      <main className="center-column">
        <SceneViewport
          className={classes}
          controls={controls("windfarm")}
          metric={data.summary.totalGenerationKWh}
          name="主风场 A"
          page="windfarm"
          scene={<WindFarmTerrainScene onTurbineSelect={onTurbineSelect} state={ui.windfarm} turbines={data.turbines} />}
          sceneBadge="W4 REAL GLB"
          sceneProgress="地形、湖泊与风机真实联动"
          status={data.dataStatus}
          unit="kWh"
        >
          {!ui.windfarm.waterVisible ? <div className="scene-state-toast">湖面图层已隐藏</div> : null}
        </SceneViewport>
      </main>
      <aside className="column column-right">
        <EquipmentStatusTable
          linkedTurbineIds={WINDFARM_MODEL_TURBINE_IDS}
          onTurbineSelect={onTurbineSelect}
          selectedTurbineId={ui.windfarm.selectedTurbineId}
          status={data.dataStatus}
          turbines={data.turbines}
        />
        <SegmentedBarChart data={data.monthlyPower} status={data.dataStatus} title="设备发电详情" />
      </aside>
    </div>
  );
}

function OperationsPage({
  data,
  ui,
  controls,
  onPartSelect,
}: PageProps & { onPartSelect: (partId: string | null) => void }) {
  return (
    <div className="page-layout page-operations">
      <aside className="column column-left">
        <SummaryPanel summary={data.summary} status={data.dataStatus} />
        <SegmentedBarChart data={data.monthlyPower} status={data.dataStatus} />
        <StatusDonut summary={data.summary} status={data.dataStatus} />
      </aside>
      <main className="center-column">
        <SceneViewport
          className={`mode-${ui.operations.viewMode} ${ui.operations.animationEnabled ? "animation-on" : "animation-off"}`}
          controls={controls("operations")}
          metric={data.turbine.totalGenerationKWh}
          name={data.turbine.name}
          page="operations"
          scene={<TurbineTwinScene alarms={data.alarms} onPartSelect={onPartSelect} parts={data.parts} state={ui.operations} turbine={data.turbine} />}
          sceneBadge="W5 REAL GLB"
          sceneProgress="四模式、拆解与零件故障联动"
          status={data.dataStatus}
          unit="kWh"
        >
          <div className="mode-status"><span>{({ exterior: "外部实体", transparent: "透视结构", wireframe: "全息线框", structure: "结构拆解" } as const)[ui.operations.viewMode]}</span><small>{ui.operations.animationEnabled ? "动画运行中" : "动画已暂停"}</small></div>
          <RealtimeMetricsBar turbine={data.turbine} />
        </SceneViewport>
      </main>
      <aside className="column column-right">
        <RankingList regions={data.regions} status={data.dataStatus} />
        <TrendChart data={data.generationTrend} status={data.dataStatus} />
        <AlarmList alarms={data.alarms} status={data.dataStatus} />
      </aside>
    </div>
  );
}

function HeaderHudGeometry() {
  return (
    <svg className="header-hud" viewBox="0 0 2560 90" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="header-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#020b0d" />
          <stop offset="0.54" stopColor="#01090b" />
          <stop offset="1" stopColor="#010607" />
        </linearGradient>
        <linearGradient id="header-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#087f7c" stopOpacity="0.05" />
          <stop offset="0.32" stopColor="#0ec4bd" stopOpacity="0.34" />
          <stop offset="0.72" stopColor="#16d7d0" stopOpacity="0.52" />
          <stop offset="1" stopColor="#08a29e" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="header-energy" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#086c6a" stopOpacity="0.2" />
          <stop offset="0.52" stopColor="#32fff4" stopOpacity="0.94" />
          <stop offset="1" stopColor="#087c78" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="header-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b5f60" stopOpacity="0.28" />
          <stop offset="1" stopColor="#021315" stopOpacity="0.03" />
        </linearGradient>
        <filter id="header-glow" x="-40%" y="-80%" width="180%" height="260%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <g id="header-side-geometry">
          <path d="M17 14H636l8 7h315l16 15" fill="none" stroke="#0b5555" strokeWidth="1" strokeDasharray="2 6" opacity=".56" />
          <path d="M0 20h625l10 8h340l17 17" fill="none" stroke="url(#header-line)" strokeWidth="1" opacity=".55" />
          <path d="M0 51h754l16 9h190l28-21" fill="none" stroke="#087c7b" strokeWidth="1.25" opacity=".62" />
          <path d="M0 55h751l17 9h202" fill="none" stroke="#073f40" strokeWidth="1" opacity=".65" />
          <path d="M0 58h744l14 7h202" fill="none" stroke="#052b2d" strokeWidth="1" opacity=".7" />
          <path d="M33 31l9 8h7l-9-8zm14 0 9 8h7l-9-8zm14 0 9 8h7l-9-8z" fill="#0fb8b2" opacity=".82" />
          <path d="M548 37v8m7-8v8m7-8v8m7-8v8m7-8v8m7-8v8m7-8v8m7-8v8" stroke="#0b8d89" strokeWidth="3" opacity=".72" />
          <path d="M648 25h27m5 0h65" stroke="#0aa29d" strokeWidth="4" opacity=".72" />
          <path d="M650 27h93" stroke="#092e30" strokeWidth="1" opacity=".8" />
          <rect x="917" y="39" width="11" height="10" fill="#0b8d89" opacity=".73" />
          <path d="M968 16h38l13 14" fill="none" stroke="#096463" strokeWidth="2" opacity=".48" />
        </g>
        <g id="header-center-bracket">
          <path d="M1013 3l15 13 5 24 17 29 31 5h97" fill="none" stroke="#0a6666" strokeWidth="2" opacity=".72" />
          <path d="M1025 14l13 10 7 24 14 14h98" fill="none" stroke="#16d8d1" strokeWidth="3" opacity=".82" filter="url(#header-glow)" />
          <path d="M1035 22l14 8 9 21 17 7h62l9 7h-76l-21-11-12-24z" fill="#0b9a97" opacity=".2" />
          <path d="M1038 25l13 6 8 18 15 6" fill="none" stroke="#38fff5" strokeWidth="4" opacity=".7" filter="url(#header-glow)" />
          <path d="M1063 40h28l9 10h-29z" fill="#13c4be" opacity=".64" filter="url(#header-glow)" />
          <path d="M1019 10l8 4-2 10-8-4zm13 24l8 4 3 13-8-4z" fill="#19d5cf" opacity=".75" />
        </g>
      </defs>
      <rect width="2560" height="90" fill="url(#header-bg)" />
      <path d="M0 86H2560" stroke="#075251" strokeWidth="1" opacity=".48" />
      <use href="#header-side-geometry" />
      <use href="#header-side-geometry" transform="translate(2560 0) scale(-1 1)" />

      <path d="M992 0h576l-18 14-4 27-17 29-28 7h-442l-28-7-17-29-4-27z" fill="url(#header-panel)" opacity=".72" />
      <path d="M995 0h570l-17 15-5 27-17 27-30 7h-432l-30-7-17-27-5-27z" fill="none" stroke="#0a494a" strokeWidth="2" opacity=".82" />
      <path d="M1006 0l17 15 5 27 17 25 27 6h416l27-6 17-25 5-27 17-15" fill="none" stroke="#0c7776" strokeWidth="1.5" opacity=".8" />
      <path d="M1024 1l12 14 5 25 17 20 26 6h392l26-6 17-20 5-25 12-14" fill="none" stroke="#0f5f5f" strokeWidth="1" opacity=".7" />
      <use href="#header-center-bracket" />
      <use href="#header-center-bracket" transform="translate(2560 0) scale(-1 1)" />

      <path d="M1084 66h102l9 7h-121z" fill="#0d8582" opacity=".6" filter="url(#header-glow)" />
      <path d="M1197 65h57l7 8h-72z" fill="#17c9c3" opacity=".86" filter="url(#header-glow)" />
      <path d="M1265 64h30l5 9h-40z" fill="#36fff5" opacity=".98" filter="url(#header-glow)" />
      <path d="M1306 65h57l8 8h-72z" fill="#17c9c3" opacity=".86" filter="url(#header-glow)" />
      <path d="M1374 66h102l10 7h-121z" fill="#0d8582" opacity=".6" filter="url(#header-glow)" />
      <path d="M1075 77h410" stroke="url(#header-energy)" strokeWidth="1.5" opacity=".65" />
      <rect x="1118" y="57" width="54" height="3" fill="#0b7774" opacity=".6" />
      <rect x="1388" y="57" width="54" height="3" fill="#0b7774" opacity=".6" />
    </svg>
  );
}

function DashboardHeader({ meta, status, updatedAt }: { meta: DashboardMeta; status: DataStatus; updatedAt: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 1000);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);
  const dateText = now
    ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()]}`
    : "----/--/-- 星期-";
  const timeText = now ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now) : "--:--:--";
  return (
    <header className="dashboard-header">
      <HeaderHudGeometry />
      <div className="header-side weather-block"><span>WEATHER</span><strong>天气：{meta.weather}</strong><i className="weather-symbol" aria-hidden="true">◌</i><DataStatusBadge status={status} updatedAt={updatedAt} /></div>
      <div className="header-title"><i className="title-wing title-wing-left" /><div><h1>{meta.projectName}</h1><p>VISUALIZATION DEMO</p></div><i className="title-wing title-wing-right" /></div>
      <div className="header-side datetime-block"><span>{dateText}</span><strong>{timeText}</strong></div>
    </header>
  );
}

export default function Home() {
  const data = useMockDashboard();
  const [activePage, setActivePage] = useState<PageId>("statistics");
  const [scale, setScale] = useState(1);
  const [ui, setUi] = useState<DashboardUiState>(initialUiState);
  const [hoveredRegionCode, setHoveredRegionCode] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedPage = window.localStorage.getItem("wind-twin-active-page") as PageId | null;
      if (storedPage && navigation.some((item) => item.id === storedPage)) setActivePage(storedPage);
      const storedUi = window.localStorage.getItem("wind-twin-ui-state");
      if (storedUi) {
        try { setUi((current) => ({ ...current, ...JSON.parse(storedUi) })); } catch { window.localStorage.removeItem("wind-twin-ui-state"); }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const updateScale = () => setScale(Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT));
    const frame = window.requestAnimationFrame(updateScale);
    window.addEventListener("resize", updateScale);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", updateScale); };
  }, []);

  useEffect(() => {
    if (activePage !== "statistics" || !ui.statistics.autoHighlightEnabled || hoveredRegionCode) return;
    const timer = window.setInterval(() => {
      setUi((current) => {
        const index = data.regions.findIndex((item) => item.regionCode === current.statistics.selectedRegionCode);
        const next = data.regions[(index + 1) % data.regions.length];
        return next ? { ...current, statistics: { ...current.statistics, selectedRegionCode: next.regionCode } } : current;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [activePage, data.regions, hoveredRegionCode, ui.statistics.autoHighlightEnabled]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const current = navigation.findIndex((item) => item.id === activePage);
      const next = navigation[(current + (event.key === "ArrowRight" ? 1 : -1) + navigation.length) % navigation.length];
      setActivePage(next.id);
      window.localStorage.setItem("wind-twin-active-page", next.id);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activePage]);

  const updateUi = <K extends keyof DashboardUiState>(page: K, next: Partial<DashboardUiState[K]>) => {
    setUi((current) => {
      const updated = { ...current, [page]: { ...current[page], ...next } };
      window.localStorage.setItem("wind-twin-ui-state", JSON.stringify(updated));
      return updated;
    });
  };

  const controls = (page: PageId) => (
    <LayerControls
      operations={ui.operations}
      page={page}
      statistics={ui.statistics}
      windfarm={ui.windfarm}
      onOperationsChange={(next) => updateUi("operations", next)}
      onStatisticsChange={(next) => updateUi("statistics", next)}
      onWindfarmChange={(next) => updateUi("windfarm", next)}
    />
  );

  const switchPage = (page: PageId) => { setActivePage(page); window.localStorage.setItem("wind-twin-active-page", page); };
  const activeLabel = useMemo(() => navigation.find((item) => item.id === activePage)?.label ?? "统计视图", [activePage]);
  const screenStyle = { transform: `translate(-50%, -50%) scale(${scale})` } satisfies CSSProperties;

  return (
    <div className="screen-root">
      <div className="dashboard" data-active-page={activePage} style={screenStyle}>
        <DashboardHeader meta={data.meta} status={data.dataStatus} updatedAt={data.lastUpdatedAt} />
        <div className="global-line global-line-left" /><div className="global-line global-line-right" />
        <div className="page-stage" key={activePage}>
          {activePage === "statistics" ? (
            <StatisticsPage
              controls={controls}
              data={data}
              hoveredRegionCode={hoveredRegionCode}
              onRegionHover={setHoveredRegionCode}
              onRegionSelect={(code) => updateUi("statistics", { selectedRegionCode: code })}
              ui={ui}
            />
          ) : null}
          {activePage === "windfarm" ? <WindfarmPage controls={controls} data={data} onTurbineSelect={(turbineId) => updateUi("windfarm", { selectedTurbineId: turbineId })} ui={ui} /> : null}
          {activePage === "operations" ? <OperationsPage controls={controls} data={data} onPartSelect={(partId) => updateUi("operations", { selectedPartId: partId })} ui={ui} /> : null}
        </div>
        <footer className="bottom-hud-shell">
          <BottomHudArtwork />
          <nav className="bottom-navigation" aria-label="一级页面导航">
            {navigation.map((item) => <button aria-current={activePage === item.id ? "page" : undefined} className={activePage === item.id ? "active" : ""} key={item.id} onClick={() => switchPage(item.id)} type="button"><small>{item.code}</small><span>{item.label}</span></button>)}
          </nav>
        </footer>
        <div className="page-indicator" aria-live="polite"><span>ACTIVE VIEW</span><strong>{activeLabel}</strong></div>
      </div>
    </div>
  );
}
