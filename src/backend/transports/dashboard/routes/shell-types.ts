import type { BootstrapQueryDeps } from "../../../../server/dashboard/queries/bootstrap.js";
import type { CrossDateSearchQueryService } from "../../../../server/dashboard/queries/search.js";
import type { OperatorXlsxExportService } from "../../../../server/dashboard/exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";

export interface ShellRouteDeps {
  readonly calendar?: import("../../../../server/dashboard/queries/calendar.js").CalendarQueryService;
  readonly bootstrap: BootstrapQueryDeps;
  readonly search: CrossDateSearchQueryService;
  readonly searchMetadataExports?: { export(input: unknown): Response };
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly hub: DashboardStreamHub;
}
