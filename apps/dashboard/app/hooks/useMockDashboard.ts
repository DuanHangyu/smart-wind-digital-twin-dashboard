"use client";

import { useEffect, useState } from "react";
import { dashboardFixture } from "../data/fixtures";
import type { DashboardSnapshot, TurbineRecord } from "../types/dashboard";

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const initialSnapshot = (): DashboardSnapshot => ({
  ...dashboardFixture,
  summary: { ...dashboardFixture.summary, statusCounts: { ...dashboardFixture.summary.statusCounts } },
  regions: dashboardFixture.regions.map((item) => ({ ...item })),
  monthlyPower: dashboardFixture.monthlyPower.map((item) => ({ ...item })),
  generationTrend: dashboardFixture.generationTrend.map((item) => ({ ...item })),
  alarms: dashboardFixture.alarms.map((item) => ({ ...item })),
  environment: { ...dashboardFixture.environment },
  turbines: dashboardFixture.turbines.map((item) => ({ ...item })),
  turbine: { ...dashboardFixture.turbine },
  parts: dashboardFixture.parts.map((item) => ({ ...item })),
  assets: dashboardFixture.assets.map((item) => ({ ...item })),
  tick: 0,
  dataStatus: "live",
  lastUpdatedAt: dashboardFixture.summary.updatedAt,
});

function updateTurbine(turbine: TurbineRecord, tick: number, now: string): TurbineRecord {
  if (turbine.status === "offline") return turbine;
  const phase = tick * 0.41 + Number(turbine.code.slice(-2)) * 0.63;
  const windSpeedMS = Math.max(4.5, round((turbine.windSpeedMS ?? 10) + Math.sin(phase) * 0.18, 1));
  const basePower = turbine.status === "standby" ? 0 : turbine.powerKW ?? 900;
  const powerKW = turbine.status === "standby" ? 0 : Math.max(0, Math.round(basePower + Math.cos(phase * 0.8) * 18));
  return {
    ...turbine,
    windSpeedMS,
    powerKW,
    totalGenerationKWh: round((turbine.totalGenerationKWh ?? 0) + powerKW / 3600000, 2),
    updatedAt: now,
  };
}

function nextSnapshot(previous: DashboardSnapshot): DashboardSnapshot {
  const tick = previous.tick + 1;
  const now = new Date().toISOString();
  const wave = Math.sin(tick * 0.47);
  const slowerWave = Math.cos(tick * 0.19);
  const turbines = previous.turbines.map((item) => updateTurbine(item, tick, now));
  const primary = turbines.find((item) => item.id === previous.turbine.id) ?? turbines[0];
  const windSpeedMS = primary.windSpeedMS ?? previous.turbine.windSpeedMS ?? 0;
  const powerKW = primary.powerKW ?? previous.turbine.powerKW ?? 0;

  return {
    ...previous,
    tick,
    dataStatus: "live",
    lastUpdatedAt: now,
    summary: {
      ...previous.summary,
      monthlyGenerationKWh: round((previous.summary.monthlyGenerationKWh ?? 0) + 0.02 + wave * 0.004, 2),
      availabilityPct: round(96.6 + slowerWave * 0.08, 1),
      totalGenerationKWh: round((previous.summary.totalGenerationKWh ?? 0) + 0.31 + wave * 0.04, 2),
      updatedAt: now,
    },
    monthlyPower: previous.monthlyPower.map((point, index) => ({
      ...point,
      value: point.value === null ? null : round(point.value + Math.sin(tick * 0.22 + index) * 0.08, 1),
      comparisonValue:
        point.comparisonValue == null
          ? point.comparisonValue
          : round(point.comparisonValue + Math.cos(tick * 0.17 + index) * 0.07, 1),
    })),
    generationTrend: previous.generationTrend.map((point, index, values) =>
      index === values.length - 1 && point.value !== null
        ? { ...point, value: round(25 + Math.sin(tick * 0.15) * 0.6, 1) }
        : point,
    ),
    environment: {
      ...previous.environment,
      temperatureC: round(22.4 + Math.sin(tick * 0.12) * 0.5, 1),
      humidityPct: round(64 + Math.cos(tick * 0.16) * 1.2, 0),
      pressureHpa: round(1008 + Math.sin(tick * 0.08) * 0.9, 0),
      windSpeedMS: round(12.1 + wave * 0.35, 1),
      windDirectionDeg: round(135 + slowerWave * 5, 0),
      updatedAt: now,
    },
    turbines,
    turbine: {
      ...previous.turbine,
      windSpeedMS,
      powerKW,
      totalGenerationKWh: round((previous.turbine.totalGenerationKWh ?? 0) + powerKW / 3600000, 2),
      environmentTemperatureC: round(20.4 + Math.sin(tick * 0.12) * 0.4, 1),
      gearboxTemperatureC: round(46.2 + Math.sin(tick * 0.21) * 1.1, 1),
      generatorTemperatureC: round(52.1 + Math.cos(tick * 0.18) * 1.4, 1),
      updatedAt: now,
    },
  };
}

export function useMockDashboard(enabled = true) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initialSnapshot);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => setSnapshot(nextSnapshot), 1000);
    return () => window.clearInterval(interval);
  }, [enabled]);

  return snapshot;
}
