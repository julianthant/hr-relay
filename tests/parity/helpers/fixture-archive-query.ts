import type { ArchiveGroupQuery } from "../../../src/models/archive/report.js";
import type { SavedArchiveReportWire } from "../../../src/models/dashboard/archive.js";

export function matchesArchiveComparisonQuery(report: SavedArchiveReportWire, query: ArchiveGroupQuery): boolean {
  const lower = (value: string) => value.replace(/[A-Z]/gu, character => character.toLowerCase());
  const sameVersion = (left: { major: number; minor: number } | undefined, right: { major: number; minor: number } | undefined) => right === undefined || (left?.major === right.major && left?.minor === right.minor);
  const values = [report.runId, report.transferId, report.workflow, report.itemId, report.attempt, report.runNumber,
    report.title, report.descriptorVersion, report.outcome, report.completedAt, report.capturedAt,
    report.sections, report.files, report.runtimeVersion, report.versionChange?.changeId, report.versionChange?.change,
    report.versionChange?.scope, report.versionChange?.targetVersion, report.versionChange?.reviewedAt,
    report.versionChange?.appliedBy, report.versionChange?.startedAt];
  return (query.workflow === undefined || query.workflow === report.workflow)
    && (query.title === undefined || query.title === report.title)
    && (query.search === undefined || values.some(value => value !== undefined && value !== null
      && lower(typeof value === "object" ? JSON.stringify(value) : String(value)).includes(lower(query.search ?? ""))))
    && (query.from === undefined || report.completedAt >= query.from)
    && (query.to === undefined || report.completedAt <= query.to)
    && (query.capturedFrom === undefined || report.capturedAt >= query.capturedFrom)
    && (query.capturedTo === undefined || report.capturedAt <= query.capturedTo)
    && (query.outcome === undefined || report.outcome === query.outcome)
    && (query.descriptorVersion === undefined || report.descriptorVersion === query.descriptorVersion)
    && sameVersion(report.runtimeVersion?.dashboard, query.dashboardVersion)
    && sameVersion(report.runtimeVersion?.workflow, query.workflowVersion)
    && (query.versionState === undefined || (query.versionState === "unrecorded" ? report.runtimeVersion === undefined : report.runtimeVersion?.state === query.versionState));
}
