import type { BootstrapQueryDeps } from "../../../runs/dashboard/queries/bootstrap.js";
import type { CrossDateSearchQueryService } from "../../../runs/dashboard/queries/search.js";
import type { OperatorXlsxExportService } from "../../../runs/exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";

export interface ShellRouteDeps {
  readonly calendar?: import("../../../runs/dashboard/queries/calendar.js").CalendarQueryService;
  readonly bootstrap: BootstrapQueryDeps;
  readonly search: CrossDateSearchQueryService;
  readonly searchMetadataExports?: { export(input: unknown): Response };
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly hub: DashboardStreamHub;
}
