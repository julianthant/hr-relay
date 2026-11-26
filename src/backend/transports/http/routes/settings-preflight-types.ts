import type { createPreflightReportService } from "../../../runtime/preflight/report-service.js";

type PreflightReportService = ReturnType<typeof createPreflightReportService>;

export interface SettingsPreflightRouteDeps {
  readonly preflight: Pick<PreflightReportService, "execute"> & Partial<Pick<PreflightReportService, "read">>;
}
