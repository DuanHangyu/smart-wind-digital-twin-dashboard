import alarmsJson from "./fixtures/alarms.json";
import assetsJson from "./fixtures/assets-manifest.json";
import metaJson from "./fixtures/dashboard-meta.json";
import regionsJson from "./fixtures/statistics-regions.json";
import summaryJson from "./fixtures/statistics-summary.json";
import trendsJson from "./fixtures/statistics-trends.json";
import turbineJson from "./fixtures/turbine-detail.json";
import partsJson from "./fixtures/turbine-parts.json";
import environmentJson from "./fixtures/windfarm-environment.json";
import turbinesJson from "./fixtures/windfarm-turbines.json";
import type { DashboardFixture } from "../types/dashboard";

export const dashboardFixture: DashboardFixture = {
  meta: metaJson,
  summary: summaryJson,
  regions: regionsJson,
  monthlyPower: trendsJson.monthlyPower,
  generationTrend: trendsJson.generationTrend,
  alarms: alarmsJson,
  environment: environmentJson,
  turbines: turbinesJson,
  turbine: turbineJson,
  parts: partsJson,
  assets: assetsJson,
} as DashboardFixture;
