"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTweenNumber } from "../../hooks/useTweenNumber";
import type {
  AlarmRecord,
  DataStatus,
  EnvironmentReading,
  RegionRecord,
  RuntimeStatus,
  TimeSeriesPoint,
  TurbineDetail,
  TurbineRecord,
  WindFarmSummary,
} from "../../types/dashboard";

const statusLabel: Record<RuntimeStatus, string> = {
  normal: "正常运行",
  running: "运行中",
  standby: "设备待机",
  offline: "离线",
  fault: "设备故障",
  abnormal: "设备异常",
};

function formatValue(value: number | null, decimals = 0) {
  return value === null ? "--" : value.toFixed(decimals);
}

export function HudPanel({
  title,
  code,
  className = "",
  status = "live",
  children,
}: {
  title: string;
  code?: string;
  className?: string;
  status?: DataStatus;
  children: ReactNode;
}) {
  return (
    <section className={`hud-panel ${className}`} data-status={status}>
      <div className="panel-corner panel-corner-tl" />
      <div className="panel-corner panel-corner-br" />
      <header className="panel-heading">
        <span className="panel-icon" aria-hidden="true"><i /></span>
        <h2>{title}</h2>
        {code ? <small>{code}</small> : null}
      </header>
      <div className="panel-accent" />
      <div className="panel-body">{children}</div>
    </section>
  );
}

function AnimatedNumber({
  value,
  decimals = 0,
  className,
}: {
  value: number | null;
  decimals?: number;
  className?: string;
}) {
  const tweened = useTweenNumber(value);
  return <span className={className}>{formatValue(tweened, decimals)}</span>;
}

export function DataStatusBadge({ status, updatedAt }: { status: DataStatus; updatedAt: string }) {
  const labels: Record<DataStatus, string> = {
    live: "实时数据",
    delayed: "数据延迟",
    empty: "暂无数据",
    error: "连接异常",
  };
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(updatedAt));
  return (
    <div className={`data-status-badge ${status}`} role="status">
      <i />
      <span>{labels[status]}</span>
      <small>{time} · 1.0 Hz</small>
    </div>
  );
}

export function SummaryPanel({ summary, status }: { summary: WindFarmSummary; status: DataStatus }) {
  const items = [
    { label: "风电机组", value: summary.turbineCount, unit: "台", glyph: "机", decimals: 0 },
    { label: "总装机容量", value: summary.installedCapacityMW, unit: "MW", glyph: "容", decimals: 0 },
    { label: "月发电量", value: summary.monthlyGenerationKWh, unit: "kWh", glyph: "电", decimals: 2 },
    { label: "可利用率", value: summary.availabilityPct, unit: "%", glyph: "率", decimals: 1 },
  ];
  return (
    <HudPanel title="风机详情" code="SUMMARY" className="summary-panel" status={status}>
      <div className="summary-layout">
        <div className="turbine-orbit" aria-hidden="true">
          <div className="orbit-ring orbit-a" />
          <div className="orbit-ring orbit-b" />
          <div className="mini-turbine">
            <i className="mini-tower" /><i className="mini-hub" />
            <i className="mini-blade blade-one" /><i className="mini-blade blade-two" /><i className="mini-blade blade-three" />
          </div>
        </div>
        <div className="summary-grid">
          {items.map((item) => (
            <article className="metric-card" key={item.label}>
              <span className="metric-glyph">{item.glyph}</span>
              <div>
                <p>{item.label}</p>
                <strong><AnimatedNumber value={item.value} decimals={item.decimals} /></strong>
                <small>{item.unit}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

export function SegmentedBarChart({
  data,
  status,
  title = "双柱图",
}: {
  data: TimeSeriesPoint[];
  status: DataStatus;
  title?: string;
}) {
  const max = Math.max(120, ...data.flatMap((item) => [item.value ?? 0, item.comparisonValue ?? 0]));
  return (
    <HudPanel title={title} code="POWER / MONTH" status={status}>
      {data.length ? (
        <div className="bar-chart">
          <div className="bar-axis"><span>120</span><span>80</span><span>40</span><span>0</span></div>
          <div className="bar-groups">
            {data.map((point) => (
              <div
                className="bar-group"
                data-tooltip={`${point.label} · 发电 ${formatValue(point.value, 1)} / 对比 ${formatValue(point.comparisonValue ?? null, 1)}`}
                key={point.label}
              >
                <div className="bar-pair">
                  <span className="bar-track"><i className="segmented-bar cyan" style={{ height: `${((point.value ?? 0) / max) * 100}%` }} /></span>
                  <span className="bar-track"><i className="segmented-bar green" style={{ height: `${((point.comparisonValue ?? 0) / max) * 100}%` }} /></span>
                </div>
                <span>{point.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : <PanelEmpty />}
    </HudPanel>
  );
}

export function StatusDonut({ summary, status }: { summary: WindFarmSummary; status: DataStatus }) {
  const states = [
    ["正常运行", summary.statusCounts.normal, "cyan"],
    ["离线", summary.statusCounts.offline, "white"],
    ["待机", summary.statusCounts.standby, "green"],
    ["故障", summary.statusCounts.fault, "yellow"],
  ] as const;
  const total = states.reduce((sum, item) => sum + item[1], 0);
  const normalPct = total ? (summary.statusCounts.normal / total) * 100 : 0;
  const stops = states.reduce<number[]>((values, item) => {
    values.push((values.at(-1) ?? 0) + (total ? (item[1] / total) * 100 : 0));
    return values;
  }, []);
  const chartStyle = {
    "--donut-a": `${stops[0] ?? 0}%`,
    "--donut-b": `${stops[1] ?? 0}%`,
    "--donut-c": `${stops[2] ?? 0}%`,
  } as CSSProperties;

  return (
    <HudPanel title="环图" code="EQUIPMENT STATUS" status={status}>
      <div className="donut-layout">
        <div className="donut-chart" style={chartStyle}>
          <div className="donut-inner">
            <strong><AnimatedNumber value={normalPct} decimals={1} />%</strong>
            <span>正常比例</span>
          </div>
        </div>
        <div className="legend-list">
          {states.map(([label, value, color]) => (
            <div key={label}><i className={`status-dot ${color}`} /><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function useCircularWindow<T>(items: T[], count: number, interval = 1800) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || items.length <= count) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % items.length), interval);
    return () => window.clearInterval(timer);
  }, [count, interval, items.length, paused]);
  const visible = useMemo(
    () => Array.from({ length: Math.min(count, items.length) }, (_, offset) => items[(index + offset) % items.length]),
    [count, index, items],
  );
  return { visible, index, setPaused };
}

export function RankingList({ regions, status }: { regions: RegionRecord[]; status: DataStatus }) {
  const { visible, index, setPaused } = useCircularWindow(regions, 5);
  return (
    <HudPanel title="条形排行" code="REGION RANKING" status={status}>
      {visible.length ? (
        <div className="ranking-list" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          {visible.map((item, offset) => (
            <div className="ranking-row list-slide-in" key={`${index}-${item.regionCode}`} style={{ animationDelay: `${offset * 45}ms` }}>
              <span className="top-tag">TOP{item.rank}</span><b>{item.regionName}</b>
              <div className="ranking-track"><i style={{ width: `${Math.min(item.percentage * 4.4, 100)}%` }} /></div>
              <strong>{formatValue(item.percentage, 0)}%</strong>
            </div>
          ))}
        </div>
      ) : <PanelEmpty />}
    </HudPanel>
  );
}

export function TrendChart({
  data,
  status,
  title = "折线图",
}: {
  data: TimeSeriesPoint[];
  status: DataStatus;
  title?: string;
}) {
  const values = data.map((item) => item.value ?? 0);
  const max = Math.max(25, Math.ceil(Math.max(...values) / 5) * 5);
  const plot = { left: 36, right: 350, top: 14, bottom: 150 };
  const points = values.map((value, index) => ({
    x: plot.left + index * ((plot.right - plot.left) / Math.max(1, values.length - 1)),
    y: plot.bottom - (value / max) * (plot.bottom - plot.top),
    value,
    label: data[index]?.label ?? "",
  }));
  const ticks = Array.from({ length: Math.floor(max / 5) + 1 }, (_, index) => index * 5);
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaString = `${plot.left},${plot.bottom} ${pointString} ${plot.right},${plot.bottom}`;
  return (
    <HudPanel title={title} code="GENERATION TREND" status={status}>
      {data.length ? (
        <div className="trend-chart">
          <svg className="trend-svg" viewBox="0 0 360 180" role="img" aria-label={`${title}，${data.map((item) => `${item.label}${formatValue(item.value, 1)}`).join("，")}`}>
            <defs>
              <linearGradient id="trend-area-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10e9df" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#10e9df" stopOpacity="0.015" />
              </linearGradient>
              <filter id="trend-line-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {ticks.map((tick) => {
              const y = plot.bottom - (tick / max) * (plot.bottom - plot.top);
              return <g className="trend-tick" key={tick}><line x1={plot.left} x2={plot.right} y1={y} y2={y} /><text x="27" y={y + 3}>{tick}</text></g>;
            })}
            {points.map((point) => <line className="trend-x-grid" key={`grid-${point.label}`} x1={point.x} x2={point.x} y1={plot.top} y2={plot.bottom} />)}
            <polygon className="trend-area" points={areaString} />
            <polyline className="trend-line" points={pointString} />
            {points.map((point) => (
              <g className="trend-node" key={point.label}>
                <title>{`${point.label} · ${formatValue(point.value, 1)}`}</title>
                <text className="trend-value" x={point.x} y={point.y - 10}>{formatValue(point.value, 1)}</text>
                <circle className="trend-node-halo" cx={point.x} cy={point.y} r="5" />
                <circle className="trend-node-core" cx={point.x} cy={point.y} r="2.2" />
                <text className="trend-label" x={point.x} y="169">{point.label}</text>
              </g>
            ))}
          </svg>
        </div>
      ) : <PanelEmpty />}
    </HudPanel>
  );
}

export function AlarmList({ alarms, status }: { alarms: AlarmRecord[]; status: DataStatus }) {
  const visible = alarms.slice(0, 2);
  return (
    <HudPanel title="设备预警" code="ALARM CENTER" status={status}>
      {visible.length ? (
        <div className="alarm-list">
          {visible.map((alarm) => (
            <article className={`${alarm.status === "resolved" ? "resolved" : ""} severity-${alarm.severity}`} key={alarm.id} title={alarm.message}>
              <span className="warning-triangle">!</span>
              <div><strong>预警信息</strong><p>{alarm.title} · {alarm.message}</p></div>
              <em>{alarm.status === "resolved" ? "已处理" : "待处理"}</em>
            </article>
          ))}
        </div>
      ) : <PanelEmpty />}
    </HudPanel>
  );
}

export function EnvironmentPanel({ data, status }: { data: EnvironmentReading; status: DataStatus }) {
  const readings = [
    ["温度", data.temperatureC, "°C", 1, "温"],
    ["湿度", data.humidityPct, "%", 0, "湿"],
    ["气压", data.pressureHpa, "hPa", 0, "压"],
    ["风速", data.windSpeedMS, "m/s", 1, "风"],
    ["体感", data.temperatureC === null ? null : data.temperatureC - 1.2, "°C", 1, "感"],
    ["阵风", data.windSpeedMS === null ? null : data.windSpeedMS * 1.18, "m/s", 1, "阵"],
  ] as const;
  return (
    <HudPanel title="风场环境情况" code="ENVIRONMENT" className="environment-panel" status={status}>
      <div className="environment-layout">
        <div className="compass">
          <span>N</span><span>E</span><span>S</span><span>W</span>
          <i style={{ transform: `rotate(${data.windDirectionDeg ?? 0}deg)` }} />
          <b>{data.windDirectionText}</b>
        </div>
        <div className="environment-values">
          {readings.map(([label, value, unit, decimals, glyph]) => (
            <div key={label}><i aria-hidden="true">{glyph}</i><span>{label}</span><strong><AnimatedNumber value={value} decimals={decimals} /><small>{unit}</small></strong></div>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

export function EquipmentStatusTable({
  turbines,
  status,
  selectedTurbineId = null,
  linkedTurbineIds = [],
  onTurbineSelect,
}: {
  turbines: TurbineRecord[];
  status: DataStatus;
  selectedTurbineId?: string | null;
  linkedTurbineIds?: string[];
  onTurbineSelect?: (turbineId: string) => void;
}) {
  const { visible, index, setPaused } = useCircularWindow(turbines, 6, 1600);
  return (
    <HudPanel title="设备预警" code="TURBINE STATUS" className="equipment-table-panel" status={status}>
      <div className="equipment-table" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="equipment-head"><span>风机编号</span><span>位置</span><span>运行状态</span></div>
        {visible.length ? visible.map((item, offset) => (
          <button
            aria-pressed={selectedTurbineId === item.id}
            className={`equipment-row list-slide-in ${linkedTurbineIds.includes(item.id) ? "model-linked" : ""} ${selectedTurbineId === item.id ? "selected" : ""}`}
            disabled={!onTurbineSelect || !linkedTurbineIds.includes(item.id)}
            key={`${index}-${item.id}`}
            onClick={() => onTurbineSelect?.(item.id)}
            style={{ animationDelay: `${offset * 35}ms` }}
            type="button"
          >
            <span>{item.code}</span><span>{item.positionText}</span>
            <span><i className={`status-dot ${item.status}`} />{statusLabel[item.status]}</span>
          </button>
        )) : <PanelEmpty compact />}
      </div>
    </HudPanel>
  );
}

export function RealtimeMetricsBar({ turbine }: { turbine: TurbineDetail }) {
  const values = [
    ["环境温度", turbine.environmentTemperatureC, "°C", 1, "", "温"],
    ["运行状态", null, "", 0, statusLabel[turbine.status], "态"],
    ["实时风速", turbine.windSpeedMS, "m/s", 1, "", "风"],
    ["齿轮箱温度", turbine.gearboxTemperatureC, "°C", 1, turbine.gearboxTemperatureC !== null && turbine.gearboxTemperatureC > 60 ? "warning" : "", "齿"],
    ["发电机温度", turbine.generatorTemperatureC, "°C", 1, turbine.generatorTemperatureC !== null && turbine.generatorTemperatureC > 70 ? "warning" : "", "机"],
  ] as const;
  return (
    <div className="realtime-bar">
      {values.map(([label, value, unit, decimals, text, glyph]) => (
        <div className={text === "warning" ? "warning" : ""} key={label}>
          <i className="realtime-glyph" aria-hidden="true">{glyph}</i>
          <span>{label}</span>
          <strong>{text && text !== "warning" ? text : <AnimatedNumber value={value} decimals={decimals} />}</strong>
          <small>{unit}</small>
        </div>
      ))}
    </div>
  );
}

export function PanelEmpty({ compact = false }: { compact?: boolean }) {
  return <div className={`panel-empty ${compact ? "compact" : ""}`}><i /><span>暂无数据</span><small>NO DATA AVAILABLE</small></div>;
}
