export type PageId = "windfarm" | "statistics" | "operations";

export type RuntimeStatus =
  | "normal"
  | "running"
  | "standby"
  | "offline"
  | "fault"
  | "abnormal";

export type DataStatus = "live" | "delayed" | "empty" | "error";
export type AlarmStatus = "pending" | "resolved";
export type AlarmSeverity = "info" | "warning" | "critical";
export type TurbineViewMode = "exterior" | "transparent" | "wireframe" | "structure";

export interface DashboardMeta {
  projectName: string;
  weather: string;
  timezone: string;
  updateFrequencyHz: number;
}

export interface WindFarmSummary {
  turbineCount: number | null;
  installedCapacityMW: number | null;
  monthlyGenerationKWh: number | null;
  availabilityPct: number | null;
  totalGenerationKWh: number | null;
  updatedAt: string;
  statusCounts: Record<"normal" | "offline" | "standby" | "fault", number>;
}

export interface RegionRecord {
  rank: number;
  regionCode: string;
  regionName: string;
  percentage: number;
  generationKWh: number;
  status: RuntimeStatus;
}

export interface TimeSeriesPoint {
  timestamp: string;
  label: string;
  value: number | null;
  comparisonValue?: number | null;
}

export interface AlarmRecord {
  id: string;
  title: string;
  message: string;
  status: AlarmStatus;
  severity: AlarmSeverity;
  turbineId?: string;
  partIds?: string[];
  createdAt: string;
  resolvedAt?: string;
}

export interface EnvironmentReading {
  temperatureC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  windSpeedMS: number | null;
  windDirectionDeg: number | null;
  windDirectionText: string;
  updatedAt: string;
}

export interface TurbineRecord {
  id: string;
  code: string;
  name: string;
  positionText: string;
  modelPosition: [number, number, number];
  status: RuntimeStatus;
  windSpeedMS: number | null;
  powerKW: number | null;
  totalGenerationKWh: number | null;
  updatedAt: string;
}

export interface TurbineDetail extends TurbineRecord {
  environmentTemperatureC: number | null;
  gearboxTemperatureC: number | null;
  generatorTemperatureC: number | null;
}

export interface TurbinePart {
  id: string;
  name: string;
  modelNodeName: string;
  status: RuntimeStatus;
  faultIds: string[];
}

export interface AssetManifestItem {
  id: string;
  kind: "map" | "terrain" | "turbine";
  preview: string;
  glb: string;
  version: string;
}

export interface DashboardFixture {
  meta: DashboardMeta;
  summary: WindFarmSummary;
  regions: RegionRecord[];
  monthlyPower: TimeSeriesPoint[];
  generationTrend: TimeSeriesPoint[];
  alarms: AlarmRecord[];
  environment: EnvironmentReading;
  turbines: TurbineRecord[];
  turbine: TurbineDetail;
  parts: TurbinePart[];
  assets: AssetManifestItem[];
}

export interface DashboardSnapshot extends DashboardFixture {
  tick: number;
  dataStatus: DataStatus;
  lastUpdatedAt: string;
}

export interface StatisticsSceneState {
  turbineLayerVisible: boolean;
  landmarkLayerVisible: boolean;
  autoHighlightEnabled: boolean;
  selectedRegionCode: string;
}

export interface WindfarmSceneState {
  waterVisible: boolean;
  projectionEnabled: boolean;
  circuitVisible: boolean;
  selectedTurbineId: string | null;
}

export interface OperationsSceneState {
  viewMode: TurbineViewMode;
  animationEnabled: boolean;
  selectedPartId: string | null;
}

export interface DashboardUiState {
  statistics: StatisticsSceneState;
  windfarm: WindfarmSceneState;
  operations: OperationsSceneState;
}
