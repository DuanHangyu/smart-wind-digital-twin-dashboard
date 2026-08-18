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
          name="自定义区域运行态势"
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

function DashboardHeader({ meta, status, updatedAt }: { meta: DashboardMeta; status: DataStatus; updatedAt: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 1000);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);
  const dateText = now ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(now) : "----/--/-- 周--";
  const timeText = now ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now) : "--:--:--";
  return (
    <header className="dashboard-header">
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
        <nav className="bottom-navigation" aria-label="一级页面导航">
          {navigation.map((item) => <button aria-current={activePage === item.id ? "page" : undefined} className={activePage === item.id ? "active" : ""} key={item.id} onClick={() => switchPage(item.id)} type="button"><small>{item.code}</small><span>{item.label}</span></button>)}
        </nav>
        <div className="page-indicator" aria-live="polite"><span>ACTIVE VIEW</span><strong>{activeLabel}</strong></div>
      </div>
    </div>
  );
}
