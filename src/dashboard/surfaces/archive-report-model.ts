import { useEffect,useState } from "react";
import { systemClock } from "../../domain/clock.js";
import { SavedArchiveFileWireSchema,type SavedArchiveQuery,type SavedArchiveReportWire,type SavedVersionIndexWire } from "../../domain/dashboard/archive.js";
import type { ArchiveReportCell } from "../../domain/archive/report.js";
import { observeResource } from "../state/async-resource.js";

export type SavedResource<T> = { state: "loading" } | { state: "loaded"; value: T } | { state: "error"; message: string };
export function useSavedResource<T>(read: () => Promise<T>, revision = 0): SavedResource<T> {
  const [settled, setSettled] = useState<{ read: typeof read; revision: number; resource: SavedResource<T> }>();
  useEffect(() => {
    return observeResource(read,
      value => setSettled({ read, revision, resource: { state: "loaded", value } }),
      (error) => setSettled({ read, revision, resource: { state: "error", message: error instanceof Error ? error.message : "Saved report request failed." } }));
  }, [read, revision]);
  const resource: SavedResource<T> = settled?.read === read && settled.revision === revision ? settled.resource : { state: "loading" };
  return resource;
}
export function savedCell(value: ArchiveReportCell): string {
  if (value === null) return "Null";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && value === "") return '""';
  if (Array.isArray(value)) return value.length === 0 ? "Empty list" : archiveCellJson(value);
  if (typeof value === "object") return Object.keys(value).length === 0 ? "Empty record" : archiveCellJson(value);
  return String(value);
}

export function visibleCapturedSettings(value: ArchiveReportCell): ArchiveReportCell {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Readonly<Record<string, ArchiveReportCell>>;
  if (record.state === "unavailable" && typeof record.reason === "string") return record.reason;
  return Object.hasOwn(record, "config") ? record.config : value;
}

export function readableArchiveLabel(value: string): string {
  return value.replace(/([a-z\d])([A-Z])/gu, "$1 $2").replaceAll(/[_-]+/gu, " ")
    .toLowerCase().replace(/^\w/u, letter => letter.toUpperCase()).replace(/\bid\b/giu, "ID");
}

function archiveCellJson(value: ArchiveReportCell): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Saved archive cell cannot be serialized.");
  return serialized;
}
export function savedCommandEnvelope(actorId: string) {
  return { commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: actorId, source: "archive", family: "version-archive" };
}
export function savedPlanRequest(wire: SavedVersionIndexWire, actorId: string, workflow: string, kind: "major" | "minor", what: string, why: string) {
  const target = workflow === "application" ? wire.workflows[0] : wire.workflows.find(row => row.workflow === workflow);
  if (target === undefined) throw new Error("Select a currently registered workflow.");
  return { ...savedCommandEnvelope(actorId), type: "plan-version-bump", target: { scope: workflow === "application" ? { kind: "application", applicationVersion: wire.appVersion } : { kind: "workflows", workflowIds: [workflow] } },
    payload: { targetVersion: wire.appVersion, changeFingerprint: target.fingerprint, changeRecord: { kind, what, why, commit: { state: "absent", reason: "No commit reference supplied." } } } };
}

/** A native download sink accepts only the exact typed, retained member response. */
export function savedDownload(input: unknown, runId: string, digest: string) {
  const file = SavedArchiveFileWireSchema.parse(input);
  if (file.runId !== runId || file.digest !== digest) throw new Error("Saved attachment identity mismatch.");
  return file.resource;
}

export function savedOutcomeLabel(outcome: SavedArchiveReportWire["outcome"]): string {
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export type VisibleArchiveSection = {
  key: number;
  label: string;
  kind: "facts" | "summary" | "input" | "settings" | "logs" | "files";
  values?: readonly { label: string; value: ArchiveReportCell }[];
  value?: ArchiveReportCell;
  sections?: SavedArchiveReportWire["sections"];
};

/** View groups retain frozen section order and keys independently of workflow registration. */
export function archiveWorkflowGroups(report: SavedArchiveReportWire): VisibleArchiveSection[] {
  const items: VisibleArchiveSection[] = [];
  if (!report.sections.some(section => section.title === "Run summary" && section.kind === "values")) {
    items.push({ key: report.sections.length + 19, label: "Run summary", kind: "summary", values: archiveRunSummaryValues(report) });
  }
  let syntheticKey = report.sections.length + 20;
  report.sections.forEach((section, index) => {
    const key = index + 1;
    if (section.title === "Run summary" && section.kind === "values") {
      items.push({ key, label: section.title, kind: "summary", values: section.values });
    } else if (section.title === "Inputs & settings" && section.kind === "values") {
      if (section.values.length === 0) items.push({ key, label: section.title, kind: "facts", values: section.values });
      section.values.forEach(cell => {
        const cellKey = syntheticKey++;
        if (cell.label === "Submitted input" || cell.label === "Parsed input") {
          items.push({ key: cellKey, label: cell.label, kind: "input", value: cell.value });
        } else if (cell.label === "Captured settings") {
          const value = visibleCapturedSettings(cell.value);
          const settings = cell.value !== null && typeof cell.value === "object" && !Array.isArray(cell.value)
            ? cell.value as Readonly<Record<string, ArchiveReportCell>> : undefined;
          const metadata = settings === undefined ? [] : Object.entries(settings)
            .filter(([label]) => label !== "config" || value !== settings.config).map(([label, entry]) => ({ label, value: entry }));
          items.push({ key: cellKey, label: "Settings", kind: "settings", values: [
            { label: cell.label, value },
            ...(value !== cell.value ? metadata : []),
          ] });
        } else {
          items.push({ key: cellKey, label: cell.label, kind: "facts", values: [cell] });
        }
      });
    } else if (section.title === "Run and frozen inputs" && section.kind === "values") {
      const inputPrefix = (label: string) => ["input.raw", "input.parsed.value"].find(prefix => label === prefix || label.startsWith(`${prefix}.`));
      const values = section.values.filter(cell => inputPrefix(cell.label) === undefined);
      items.push({ key, label: section.title, kind: "facts", values });
      for (const [prefix, label] of [["input.raw", "Submitted input"], ["input.parsed.value", "Parsed input"]] as const) {
        const inputValues = section.values.filter(cell => inputPrefix(cell.label) === prefix)
          .map(cell => ({ label: cell.label.slice(prefix.length).replace(/^\./u, "") || "Value", value: cell.value }));
        if (inputValues.length > 0) items.push({ key: syntheticKey++, label, kind: "facts", values: inputValues });
      }
    } else {
      items.push({ key, label: section.title, kind: "facts", ...(section.kind === "values" ? { values: section.values } : { sections: [section] }) });
    }
  });
  return items;
}

export function archiveLogSections(report: SavedArchiveReportWire): SavedArchiveReportWire["sections"] {
  return report.sections.filter(section => section.title === "Logs" || section.title === "Saved logs");
}

export function archiveRunSummaryValues(report: SavedArchiveReportWire): readonly { label: string; value: ArchiveReportCell }[] {
  const summary = report.sections.find(section => section.title === "Run summary" && section.kind === "values");
  if (summary?.kind === "values") return summary.values;
  const legacy = report.sections.find(section => section.title === "Run and frozen inputs" && section.kind === "values");
  const field = (path: string): ArchiveReportCell | undefined => legacy?.kind === "values" ? legacy.values.find(row => row.label === path)?.value : undefined;
  const enqueued = field("envelope.enqueuedAt");
  const ended = report.completedAt;
  const elapsed = typeof enqueued === "string" && Number.isFinite(Date.parse(enqueued)) && Number.isFinite(Date.parse(ended)) && Date.parse(ended) >= Date.parse(enqueued)
    ? Date.parse(ended) - Date.parse(enqueued) : "Not recorded";
  const input = report.sections.find(section => section.title === "Inputs & settings" && section.kind === "values");
  const storedMode = input?.kind === "values" ? input.values.find(row => row.label === "Run mode")?.value : undefined;
  const mode = field("envelope.dryRun") ?? storedMode;
  return [
    { label: "Verification result", value: "Not recorded" },
    { label: "Queued", value: typeof enqueued === "string" ? enqueued : "Not recorded" },
    { label: "Completed", value: ended },
    { label: "Total elapsed", value: elapsed },
    { label: "Run mode", value: mode === true ? "Dry run" : mode === false ? "Live run" : mode === "Dry run" || mode === "Live run" ? mode : "Not recorded" },
    { label: "Attempt", value: field("envelope.attempt") ?? report.attempt ?? "Not recorded" },
  ];
}

export function archiveFileRelationships(report: SavedArchiveReportWire, digest: string): readonly { taskId: string; actionId: string }[] {
  const section = report.sections.find(item => item.title === "Retained file relationships" && item.kind === "values");
  if (section?.kind !== "values") return [];
  return section.values.filter(row => row.label === digest).flatMap(row => {
    const value = row.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
    const { taskId, actionId } = value as Record<string, ArchiveReportCell>;
    return typeof taskId === "string" && typeof actionId === "string" ? [{ taskId, actionId }] : [];
  });
}

export function visibleArchiveSections(report: SavedArchiveReportWire): VisibleArchiveSection[] {
  return [
    { key: 0, label: "Workflow details", kind: "facts" },
    { key: report.sections.length + 8, label: "Logs", kind: "logs" },
    { key: report.sections.length + 1, label: "Retained files", kind: "files" },
  ];
}

export function savedDateFilterSummary(query: SavedArchiveQuery): string {
  return ([
    ["from", "Completed from"],
    ["to", "Completed through"],
    ["capturedFrom", "Captured from"],
    ["capturedTo", "Captured through"],
  ] as const)
    .flatMap(([key, label]) => query[key] === undefined ? [] : [`${label} ${query[key].slice(0, 10)}`])
    .join(", ");
}

/** Filter changes discard the server cursor while retaining the other filters. */
export function savedFilterQuery(query: SavedArchiveQuery, key: "workflow" | "title" | "descriptorVersion" | "outcome" | "from" | "to" | "capturedFrom" | "capturedTo", value: string): SavedArchiveQuery {
  const next = { ...query };
  delete next.after;
  if (value === "") delete next[key]; else next[key] = value;
  return next;
}
