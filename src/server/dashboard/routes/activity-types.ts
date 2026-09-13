export interface ActivityRouteDeps {
  readonly activity: { read(from: string, to: string): import("../../../domain/dashboard/activity.js").ActivityReportWire };
}
