import type { SavedArchiveGroupsWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion, type RuntimeVersion } from "../../domain/archive/runtime-version.js";

export type ArchiveGroup = SavedArchiveGroupsWire["groups"][number];
export type DashboardArchiveGroup = {
  key: string;
  version: RuntimeVersion | null;
  reportCount: number;
  workflows: { workflow: string; reportCount: number; versions: ArchiveGroup[] }[];
};

export function archiveVersionLabel(version: RuntimeVersion | null): string {
  return version === null ? "Version not recorded" : formatRuntimeVersion(version);
}

export function archiveVersionKey(version: RuntimeVersion | null): string {
  return version === null ? "unrecorded" : formatRuntimeVersion(version);
}

export function archiveReportCount(count: number): string {
  return `${count} ${count === 1 ? "report" : "reports"}`;
}

export function groupArchiveVersions(groups: readonly ArchiveGroup[]): DashboardArchiveGroup[] {
  const dashboards = new Map<string, DashboardArchiveGroup>();
  for (const group of groups) {
    const key = archiveVersionKey(group.dashboardVersion);
    let dashboard = dashboards.get(key);
    if (dashboard === undefined) {
      dashboard = { key, version: group.dashboardVersion, reportCount: 0, workflows: [] };
      dashboards.set(key, dashboard);
    }
    dashboard.reportCount += group.reportCount;
    let workflow = dashboard.workflows.find(row => row.workflow === group.workflow);
    if (workflow === undefined) {
      workflow = { workflow: group.workflow, reportCount: 0, versions: [] };
      dashboard.workflows.push(workflow);
    }
    workflow.reportCount += group.reportCount;
    workflow.versions.push(group);
  }
  return [...dashboards.values()];
}

export function sameArchiveGroup(left: ArchiveGroup | null, right: ArchiveGroup): boolean {
  return left !== null && left.workflow === right.workflow
    && archiveVersionKey(left.dashboardVersion) === archiveVersionKey(right.dashboardVersion)
    && archiveVersionKey(left.workflowVersion) === archiveVersionKey(right.workflowVersion);
}
