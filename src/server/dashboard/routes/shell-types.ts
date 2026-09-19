import type { BootstrapQueryDeps } from "../queries/bootstrap.js";
import type { CrossDateSearchQueryService } from "../queries/search.js";
import type { OperatorXlsxExportService } from "../exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";

export interface ShellRouteDeps {
  readonly calendar?: import("../queries/calendar.js").CalendarQueryService;
  readonly bootstrap: BootstrapQueryDeps;
  readonly search: CrossDateSearchQueryService;
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly hub: DashboardStreamHub;
}
