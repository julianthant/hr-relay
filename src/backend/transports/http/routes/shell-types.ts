import type { BootstrapQueryDeps } from "../../../runs/queries/bootstrap.js";
import type { CrossDateSearchQueryService } from "../../../runs/queries/search.js";
import type { OperatorXlsxExportService } from "../../../runs/exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";
import type { CalendarQuery, CalendarWire } from "../../../../models/dashboard/calendar.js";
import type { CrossDateSearchQuery } from "../../../../models/dashboard/search.js";
import type { DebugEventEmitter } from "../../../logs/debug-events.js";

export interface ShellRouteDeps {
  readonly applicationLifecycle?: { snapshot(): import("../../../../models/dashboard/application-lifecycle.js").ApplicationLifecycle };
  readonly debugEvents?: DebugEventEmitter;
  readonly calendar?: { read(query: CalendarQuery, signal?: AbortSignal): CalendarWire | Promise<string> };
  readonly bootstrap: BootstrapQueryDeps;
  readonly search: CrossDateSearchQueryService;
  readonly searchPage?: (query: CrossDateSearchQuery, signal?: AbortSignal) => Promise<string>;
  readonly searchMetadataExports?: { export(input: unknown, signal?: AbortSignal): Response | Promise<Response> };
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly hub: DashboardStreamHub;
}
