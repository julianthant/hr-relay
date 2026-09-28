import type { SavedArchiveGroupsWire, SavedArchiveReportWire, SavedRuntimeVersionIndexWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion, planRuntimeVersionTransition, type RuntimeVersion, type RuntimeVersionScope, type RuntimeVersionTransition } from "../../domain/archive/runtime-version.js";

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
  return `${count} ${count === 1 ? "run" : "runs"}`;
}

export function archiveDisplayDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function archiveWorkflowMark(label: string): string {
  const words = label.split(/[\s_-]+/u).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : label.slice(0, 2)).toUpperCase();
}

export function archiveWorkflowVersionLabels(groups: readonly ArchiveGroup[]): string[] {
  return [...new Set(groups.map(group => archiveVersionLabel(group.workflowVersion)))];
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

export type ArchiveSummaryValueType = "string" | "number" | "boolean" | "null" | "array" | "object" | "mixed";

/**
 * A summary column is a saved public field, never a guessed label. The path is
 * the same identity used by the typed CSV export, so two equal labels in
 * different retained sections cannot collapse into one table column.
 */
export type ArchiveSummaryColumn = Readonly<{
  /** Stable semantic saved path, independent of positional array offsets. */
  id: string;
  path: string;
  section: string;
  sectionOccurrence: number;
  label: string;
  labelOccurrence: number;
  type: ArchiveSummaryValueType;
}>;

const SUMMARY_PRIORITY = [/^(?:employee|person|subject).*name$|^name$|^subject$/iu, /^document number$/iu,
  /^last day worked$/iu, /^separation date$/iu, /^(?:termination )?effective date$/iu,
  /employee.*id|eid/iu, /document/iu, /last day worked/iu, /result/iu];
const LEGACY_RIGHT_ALIGNED_FIELDS = new Set(["last day worked", "separation date", "effective date", "hours", "count", "files", "version"]);

function summaryType(value: unknown): Exclude<ArchiveSummaryValueType, "mixed"> {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  throw new Error("Archive summary contains a non-public saved value.");
}

function sourceRank(section: string): number {
  return section === "Run and frozen inputs" || /^[a-z0-9_]+$/u.test(section) ? 1 : 0;
}

function priorityRank(label: string): number {
  const index = SUMMARY_PRIORITY.findIndex(pattern => pattern.test(label));
  return index < 0 ? SUMMARY_PRIORITY.length : index;
}

function summaryFieldPath(section: string, sectionOccurrence: number, label: string, labelOccurrence: number): string {
  return `sections[${JSON.stringify(section)}][${String(sectionOccurrence)}].values[${JSON.stringify(label)}][${String(labelOccurrence)}].value`;
}

/** Return every public field observed in the loaded report pages. */
export function archiveSummaryColumns(reports: readonly SavedArchiveReportWire[]): ArchiveSummaryColumn[] {
  const available = new Map<string, ArchiveSummaryColumn>();
  for (const report of reports) {
    const sectionOccurrences = new Map<string, number>();
    report.sections.forEach(section => {
    if (section.kind !== "values") return;
    const sectionOccurrence = sectionOccurrences.get(section.title) ?? 0;
    sectionOccurrences.set(section.title, sectionOccurrence + 1);
    const labelOccurrences = new Map<string, number>();
    section.values.forEach(value => {
      const labelOccurrence = labelOccurrences.get(value.label) ?? 0;
      labelOccurrences.set(value.label, labelOccurrence + 1);
      const path = summaryFieldPath(section.title, sectionOccurrence, value.label, labelOccurrence);
      const id = path;
      const current = { id, path, section: section.title, sectionOccurrence, label: value.label, labelOccurrence, type: summaryType(value.value) } as const;
      const prior = available.get(id);
      if (prior === undefined) available.set(id, current);
      else if (prior.type !== current.type && prior.type !== "mixed") available.set(id, { ...prior, type: "mixed" });
    });
    });
  }
  return [...available.values()].sort((left, right) => sourceRank(left.section) - sourceRank(right.section)
    || priorityRank(left.label) - priorityRank(right.label)
    || left.section.localeCompare(right.section)
    || left.label.localeCompare(right.label)
    || left.path.localeCompare(right.path));
}

/** Preserve catalog discoveries while pagination exposes additional retained fields. */
export function mergeArchiveSummaryColumns(existing: readonly ArchiveSummaryColumn[], next: readonly ArchiveSummaryColumn[]): ArchiveSummaryColumn[] {
  const merged = new Map(existing.map(column => [column.id, column]));
  for (const column of next) {
    const prior = merged.get(column.id);
    if (prior === undefined) merged.set(column.id, column);
    else if (prior.type !== column.type && prior.type !== "mixed") merged.set(column.id, { ...prior, type: "mixed" });
  }
  return archiveSummaryColumnsFromCatalog([...merged.values()]);
}

function archiveSummaryColumnsFromCatalog(columns: readonly ArchiveSummaryColumn[]): ArchiveSummaryColumn[] {
  return [...columns].sort((left, right) => sourceRank(left.section) - sourceRank(right.section)
    || priorityRank(left.label) - priorityRank(right.label)
    || left.section.localeCompare(right.section)
    || left.label.localeCompare(right.label)
    || left.path.localeCompare(right.path));
}

/** The dense default is intentionally separate from the complete column catalog. */
export function archiveInitialSummaryColumns(columns: readonly ArchiveSummaryColumn[]): ArchiveSummaryColumn[] {
  return archiveSummaryColumnsFromCatalog(columns).slice(0, 5);
}

export function archiveSummaryColumnLabel(column: ArchiveSummaryColumn, catalog: readonly ArchiveSummaryColumn[]): string {
  const sameLabel = catalog.filter(candidate => candidate.label.toLocaleLowerCase() === column.label.toLocaleLowerCase());
  if (sameLabel.length === 1) return column.label;
  const sameSection = sameLabel.filter(candidate => candidate.section === column.section);
  if (sameSection.length === 1) return `${column.section} · ${column.label}`;
  return `${column.section} · ${column.label} · ${String(column.labelOccurrence + 1)}`;
}

export function archiveSummaryColumnAlignment(column: ArchiveSummaryColumn): "left" | "right" {
  if (column.type === "number") return "right";
  return LEGACY_RIGHT_ALIGNED_FIELDS.has(column.label.toLocaleLowerCase()) ? "right" : "left";
}

function summaryCell(report: SavedArchiveReportWire, column: ArchiveSummaryColumn): unknown {
  let sectionOccurrence = 0;
  for (const section of report.sections) {
    if (section.kind !== "values" || section.title !== column.section) continue;
    if (sectionOccurrence !== column.sectionOccurrence) {
      sectionOccurrence += 1;
      continue;
    }
    let labelOccurrence = 0;
    for (const value of section.values) {
      if (value.label !== column.label) continue;
      if (labelOccurrence === column.labelOccurrence) return value.value;
      labelOccurrence += 1;
    }
    return undefined;
  }
  return undefined;
}

/** Keep absence, null, false, zero, empty containers and empty strings distinct. */
export function archiveSummaryValue(report: SavedArchiveReportWire, column: ArchiveSummaryColumn): string {
  const value = summaryCell(report, column);
  if (value === undefined) return "Absent";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "[]" : JSON.stringify(value);
  if (typeof value === "object") return Object.keys(value).length === 0 ? "{}" : JSON.stringify(value);
  throw new Error("Archive summary contains a non-public saved value.");
}

export type ArchiveRuntimeVersionPreview = Readonly<{
  scope: RuntimeVersionScope;
  transition: RuntimeVersionTransition;
}>;

/**
 * The dialog's preview, review command and apply eligibility share this one
 * normalized scope. In particular, selecting every registered workflow is the
 * dashboard-major action even when the registry contains only one workflow.
 */
export function archiveRuntimeVersionPreview(
  wire: SavedRuntimeVersionIndexWire,
  requestedKind: "workflows" | "dashboard",
  requestedWorkflowIds: readonly string[],
): ArchiveRuntimeVersionPreview | null {
  const registered = wire.workflows.map(row => row.workflowId);
  if (registered.length === 0) return null;
  const requested = new Set(requestedWorkflowIds);
  const selected = requestedKind === "dashboard"
    ? registered
    : registered.filter(id => requested.has(id)).sort();
  if (selected.length === 0) return null;
  const scope: RuntimeVersionScope = selected.length === registered.length
    ? { kind: "dashboard" }
    : { kind: "workflows", workflowIds: selected };
  const transition = planRuntimeVersionTransition({ dashboard: wire.dashboard,
    workflows: wire.workflows.map(row => ({ workflowId: row.workflowId, version: row.version })) }, scope);
  return Object.freeze({ scope, transition });
}
