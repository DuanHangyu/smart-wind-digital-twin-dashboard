"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type PageId = "windfarm" | "statistics" | "operations";

const DESIGN_WIDTH = 2560;
const DESIGN_HEIGHT = 1080;

const navigation: Array<{ id: PageId; label: string; code: string }> = [
  { id: "windfarm", label: "风场管理", code: "P02" },
  { id: "statistics", label: "统计视图", code: "P01" },
  { id: "operations", label: "运维管理", code: "P03" },
];

const months = [
  { label: "1月", a: 54, b: 72 },
  { label: "2月", a: 73, b: 87 },
  { label: "3月", a: 61, b: 98 },
  { label: "4月", a: 86, b: 108 },
  { label: "5月", a: 94, b: 114 },
];

const ranking = [
  ["北辰", 18],
  ["云岭", 16],
  ["西原", 12],
  ["苍川", 10],
  ["中岳", 9],
] as const;

function HudPanel({
  title,
  code,
  className = "",
  children,
}: {
  title: string;
  code?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`hud-panel ${className}`}>
      <div className="panel-corner panel-corner-tl" />
      <div className="panel-corner panel-corner-br" />
      <header className="panel-heading">
        <span className="panel-icon" aria-hidden="true">
          <i />
        </span>
        <h2>{title}</h2>
        {code ? <small>{code}</small> : null}
      </header>
      <div className="panel-accent" />
      <div className="panel-body">{children}</div>
    </section>
  );
}

function SummaryPanel() {
  const items = [
    ["风电机组", "99", "台", "机"],
    ["总装机容量", "77", "MW", "容"],
    ["月发电量", "118", "kWh", "电"],
    ["可利用率", "66", "%", "率"],
  ];
  return (
    <HudPanel title="风机详情" code="SUMMARY" className="summary-panel">
      <div className="summary-layout">
        <div className="turbine-orbit" aria-hidden="true">
          <div className="orbit-ring orbit-a" />
          <div className="orbit-ring orbit-b" />
          <div className="mini-turbine">
            <i className="mini-tower" />
            <i className="mini-hub" />
            <i className="mini-blade blade-one" />
            <i className="mini-blade blade-two" />
            <i className="mini-blade blade-three" />
          </div>
        </div>
        <div className="summary-grid">
          {items.map(([label, value, unit, glyph]) => (
            <article className="metric-card" key={label}>
              <span className="metric-glyph">{glyph}</span>
              <div>
                <p>{label}</p>
                <strong>{value}</strong>
                <small>{unit}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function SegmentedBars({ title = "双柱图" }: { title?: string }) {
  return (
    <HudPanel title={title} code="POWER / MONTH">
      <div className="bar-chart">
        <div className="bar-axis">
          <span>120</span>
          <span>80</span>
          <span>40</span>
          <span>0</span>
        </div>
        <div className="bar-groups">
          {months.map((month) => (
            <div className="bar-group" key={month.label}>
              <div className="bar-pair">
                <i className="segmented-bar cyan" style={{ height: `${month.a}%` }} />
                <i className="segmented-bar green" style={{ height: `${month.b}%` }} />
              </div>
              <span>{month.label}</span>
            </div>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function StatusDonut() {
  const states = [
    ["正常运行", "27", "cyan"],
    ["离线", "25", "white"],
    ["待机", "18", "green"],
    ["故障", "15", "yellow"],
  ];
  return (
    <HudPanel title="环图" code="EQUIPMENT STATUS">
      <div className="donut-layout">
        <div className="donut-chart">
          <div className="donut-inner">
            <strong>31.8%</strong>
            <span>正常比例</span>
          </div>
        </div>
        <div className="legend-list">
          {states.map(([label, value, color]) => (
            <div key={label}>
              <i className={`status-dot ${color}`} />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function RankingList() {
  return (
    <HudPanel title="条形排行" code="REGION RANKING">
      <div className="ranking-list">
        {ranking.map(([name, value], index) => (
          <div className="ranking-row" key={name}>
            <span className="top-tag">TOP{index + 1}</span>
            <b>{name}</b>
            <div className="ranking-track">
              <i style={{ width: `${Math.min(value * 4.4, 100)}%` }} />
            </div>
            <strong>{value}%</strong>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function TrendChart({ title = "折线图" }: { title?: string }) {
  const values = [7, 7, 10, 15, 19, 22, 25];
  const points = values.map((value, index) => ({
    x: 8 + index * 14,
    y: 82 - value * 2.45,
    value,
  }));
  return (
    <HudPanel title={title} code="GENERATION TREND">
      <div className="trend-chart">
        <div className="trend-grid" />
        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const dx = next.x - point.x;
          const dy = next.y - point.y;
          const width = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <i
              className="trend-segment"
              key={`${point.x}-${point.y}`}
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                width: `${width}%`,
                transform: `rotate(${angle}deg)`,
              }}
            />
          );
        })}
        {points.map((point, index) => (
          <span
            className="trend-point"
            key={point.x}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <b>{point.value}</b>
            <small>{index + 1}月</small>
          </span>
        ))}
      </div>
    </HudPanel>
  );
}

function AlarmList() {
  const alarms = [
    ["#001 设备预警", "风机 A03 齿轮箱温度异常", "待处理"],
    ["#002 设备预警", "风机 A01 振动指标恢复正常", "已处理"],
  ];
  return (
    <HudPanel title="设备预警" code="ALARM CENTER">
      <div className="alarm-list">
        {alarms.map(([title, body, status]) => (
          <article className={status === "已处理" ? "resolved" : ""} key={title}>
            <span className="warning-triangle">!</span>
            <div>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
            <em>{status}</em>
          </article>
        ))}
      </div>
    </HudPanel>
  );
}

function LayerControls({ page }: { page: PageId }) {
  const controls =
    page === "statistics"
      ? ["风机", "地标", "动画"]
      : page === "windfarm"
        ? ["水面", "投影", "电路"]
        : ["外部", "透视", "线框", "结构", "动画"];
  return (
    <div className={`layer-controls ${page}`} aria-label="场景控制">
      {controls.map((label, index) => (
        <button
          className={index === 1 && page === "windfarm" ? "" : index < 2 || label === "动画" ? "active" : ""}
          disabled={label === "电路"}
          key={label}
          type="button"
        >
          <span>{label}</span>
          {label === "电路" ? <small>待配置</small> : null}
        </button>
      ))}
    </div>
  );
}

function SceneViewport({
  page,
  name,
  metric,
  unit,
  image,
  children,
}: {
  page: PageId;
  name: string;
  metric: string;
  unit: string;
  image: string;
  children?: ReactNode;
}) {
  return (
    <section className={`scene-viewport scene-${page}`}>
      <div className="scene-grid" />
      <div className="scene-scan" />
      <header className="scene-header">
        <div>
          <span className="scene-index">●</span>
          <strong>{name}</strong>
        </div>
        <p>
          总发电量 <b>{metric}</b> <small>{unit}</small>
        </p>
      </header>
      <p className="scene-disclaimer">内含模型为技术展示效果，非现实场景及工业效果</p>
      <div className="scene-image-wrap">
        <div className="scene-orbit orbit-outer" />
        <div className="scene-orbit orbit-inner" />
        <Image
          src={image}
          alt={`${name}静态场景预览`}
          width={1200}
          height={820}
          priority={page === "statistics"}
          unoptimized
        />
        <div className="scene-glow" />
      </div>
      <LayerControls page={page} />
      {children}
      <div className="scene-placeholder-badge">
        <span>W1 STATIC SHELL</span>
        <strong>三维交互将在 W3–W5 接入</strong>
      </div>
    </section>
  );
}

function StatisticsPage() {
  return (
    <div className="page-layout page-statistics">
      <aside className="column column-left">
        <SummaryPanel />
        <SegmentedBars />
        <StatusDonut />
      </aside>
      <main className="center-column">
        <SceneViewport
          page="statistics"
          name="自定义区域运行态势"
          metric="1952.47"
          unit="kWh"
          image="/scenes/custom-map.png"
        >
          <div className="map-status">
            <span>14</span>
            <small>自定义区域</small>
          </div>
        </SceneViewport>
      </main>
      <aside className="column column-right">
        <RankingList />
        <TrendChart />
        <AlarmList />
      </aside>
    </div>
  );
}

function EnvironmentPanel() {
  const readings = [
    ["温度", "22°C"],
    ["湿度", "64%"],
    ["气压", "1008 hPa"],
    ["风速", "12 m/s"],
  ];
  return (
    <HudPanel title="风场环境情况" code="ENVIRONMENT" className="environment-panel">
      <div className="environment-layout">
        <div className="compass">
          <span>N</span><span>E</span><span>S</span><span>W</span>
          <i />
          <b>东南风</b>
        </div>
        <div className="environment-values">
          {readings.map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function EquipmentTable() {
  const rows = [
    ["A001", "东南方向", "正常运行", "normal"],
    ["A002", "东南方向", "正常运行", "normal"],
    ["A003", "西北方向", "设备待机", "standby"],
    ["A004", "中心山谷", "正常运行", "normal"],
    ["A005", "东北方向", "设备异常", "warning"],
    ["A006", "西南方向", "正常运行", "normal"],
  ];
  return (
    <HudPanel title="设备预警" code="TURBINE STATUS" className="equipment-table-panel">
      <div className="equipment-table">
        <div className="equipment-head"><span>风机编号</span><span>位置</span><span>运行状态</span></div>
        {rows.map(([code, position, status, tone]) => (
          <div className="equipment-row" key={code}>
            <span>{code}</span><span>{position}</span><span><i className={`status-dot ${tone}`} />{status}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function WindfarmPage() {
  return (
    <div className="page-layout page-windfarm">
      <aside className="column column-left">
        <EnvironmentPanel />
        <TrendChart title="风电历史功率" />
        <RankingList />
      </aside>
      <main className="center-column">
        <SceneViewport
          page="windfarm"
          name="主风场 A"
          metric="1502.00"
          unit="kWh"
          image="/scenes/windfarm.png"
        >
          <div className="turbine-points">
            <span className="point point-a">主风机 A <b>运行中</b></span>
            <span className="point point-b">主风机 B <b>待机</b></span>
            <span className="point point-d">主风机 D <b>运行中</b></span>
          </div>
        </SceneViewport>
      </main>
      <aside className="column column-right">
        <EquipmentTable />
        <SegmentedBars title="设备发电详情" />
      </aside>
    </div>
  );
}

function RealtimeBar() {
  const values = [
    ["环境温度", "20", "°C"],
    ["运行状态", "运行中", ""],
    ["实时风速", "12", "m/s"],
    ["齿轮箱温度", "46", "°C"],
    ["发电机温度", "52", "°C"],
  ];
  return (
    <div className="realtime-bar">
      {values.map(([label, value, unit]) => (
        <div key={label}><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>
      ))}
    </div>
  );
}

function OperationsPage() {
  return (
    <div className="page-layout page-operations">
      <aside className="column column-left">
        <SummaryPanel />
        <SegmentedBars />
        <StatusDonut />
      </aside>
      <main className="center-column">
        <SceneViewport
          page="operations"
          name="主风机 A"
          metric="1548.00"
          unit="kWh"
          image="/scenes/turbine.png"
        >
          <RealtimeBar />
        </SceneViewport>
      </main>
      <aside className="column column-right">
        <RankingList />
        <TrendChart />
        <AlarmList />
      </aside>
    </div>
  );
}

function DashboardHeader() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const dateText = now
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(now)
    : "----/--/-- 周--";
  const timeText = now
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)
    : "--:--:--";
  return (
    <header className="dashboard-header">
      <div className="header-side weather-block">
        <span>WEATHER</span>
        <strong>天气：多云转阴</strong>
        <i className="weather-symbol" aria-hidden="true">◌</i>
      </div>
      <div className="header-title">
        <i className="title-wing title-wing-left" />
        <div>
          <h1>智慧风电可视化大屏</h1>
          <p>VISUALIZATION DEMO</p>
        </div>
        <i className="title-wing title-wing-right" />
      </div>
      <div className="header-side datetime-block">
        <span>{dateText}</span>
        <strong>{timeText}</strong>
      </div>
    </header>
  );
}

export default function Home() {
  const [activePage, setActivePage] = useState<PageId>("statistics");
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const stored = window.localStorage.getItem("wind-twin-active-page") as PageId | null;
    const frame = window.requestAnimationFrame(() => {
      if (stored && navigation.some((item) => item.id === stored)) setActivePage(stored);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const current = navigation.findIndex((item) => item.id === activePage);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = navigation[(current + direction + navigation.length) % navigation.length];
      setActivePage(next.id);
      window.localStorage.setItem("wind-twin-active-page", next.id);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activePage]);

  const activeLabel = useMemo(
    () => navigation.find((item) => item.id === activePage)?.label ?? "统计视图",
    [activePage],
  );

  const screenStyle = {
    transform: `translate(-50%, -50%) scale(${scale})`,
  } satisfies CSSProperties;

  const switchPage = (page: PageId) => {
    setActivePage(page);
    window.localStorage.setItem("wind-twin-active-page", page);
  };

  return (
    <div className="screen-root">
      <div className="dashboard" style={screenStyle} data-active-page={activePage}>
        <DashboardHeader />
        <div className="global-line global-line-left" />
        <div className="global-line global-line-right" />
        <div className="page-stage" key={activePage}>
          {activePage === "statistics" ? <StatisticsPage /> : null}
          {activePage === "windfarm" ? <WindfarmPage /> : null}
          {activePage === "operations" ? <OperationsPage /> : null}
        </div>
        <nav className="bottom-navigation" aria-label="一级页面导航">
          {navigation.map((item) => (
            <button
              aria-current={activePage === item.id ? "page" : undefined}
              className={activePage === item.id ? "active" : ""}
              key={item.id}
              onClick={() => switchPage(item.id)}
              type="button"
            >
              <small>{item.code}</small>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="page-indicator" aria-live="polite">
          <span>ACTIVE VIEW</span>
          <strong>{activeLabel}</strong>
        </div>
      </div>
    </div>
  );
}
