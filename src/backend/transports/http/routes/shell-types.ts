import type { BootstrapQueryDeps } from "../../../runs/queries/bootstrap.js";
import type { CrossDateSearchQueryService } from "../../../runs/queries/search.js";
import type { OperatorXlsxExportService } from "../../../runs/exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";
import type { RunLogsStreamHub } from "../subscriptions/run-logs-stream.js";

export interface ShellRouteDeps {
  readonly debugEvents?: ReturnType<typeof import("../../../logs/debug-events.js").createDebugEventWriter>;
  readonly calendar?: import("../../../runs/queries/calendar.js").CalendarQueryService;
  readonly bootstrap: BootstrapQueryDeps;
  readonly search: CrossDateSearchQueryService;
  readonly searchMetadataExports?: { export(input: unknown): Response };
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly hub: DashboardStreamHub;
  readonly runLogsHub: RunLogsStreamHub;
}
