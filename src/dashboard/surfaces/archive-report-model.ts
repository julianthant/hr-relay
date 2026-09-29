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
  kind: "facts" | "input" | "settings" | "logs" | "files";
  values?: readonly { label: string; value: ArchiveReportCell }[];
  value?: ArchiveReportCell;
  sections?: SavedArchiveReportWire["sections"];
};

const separationFacts: Readonly<Record<string, string>> = {
  "Employee name": "Employee", "Employee ID": "Employee", "Document number": "Employee",
  "Last day worked": "Separation dates", "Separation date": "Separation dates", "Termination effective date": "Separation dates",
  "Date source": "Date reconciliation", "Kuali last day worked": "Date reconciliation", "Kuali separation date": "Date reconciliation",
  "Last day worked changed": "Date reconciliation", "Separation date changed": "Date reconciliation", "Latest sick date": "Date reconciliation",
  "First holiday date": "Date reconciliation", "Latest holiday date": "Date reconciliation", "Separation determining leave": "Date reconciliation",
  "Unclassified pay codes": "Date reconciliation",
};
const lookupFacts: Readonly<Record<string, string>> = {
  "Employee name": "Employee", "Employee ID": "Employee", "Lookup status": "Lookup details", "Source system": "Lookup details",
};

/** Synthetic view keys follow sealed sections; historical section keys never change. */
export function archiveWorkflowGroups(report: SavedArchiveReportWire): VisibleArchiveSection[] {
  const base = report.sections.length + 10;
  const names = report.workflow === "separations" ? ["Employee", "Separation dates", "Date reconciliation", "Details"]
    : report.workflow === "person-lookup" ? ["Employee", "Lookup details", "Details"] : ["Details"];
  const mapping = report.workflow === "separations" ? separationFacts : report.workflow === "person-lookup" ? lookupFacts : {};
  const buckets = new Map(names.map(name => [name, { values: [] as { label: string; value: ArchiveReportCell }[], sections: [] as SavedArchiveReportWire["sections"][number][] }]));
  for (const section of report.sections) {
    const workflowFacts = section.title.startsWith("Identity and ") || ["Captured facts", "Failure details", "Warning facts"].includes(section.title) || /^\d+ warnings?$/u.test(section.title);
    if (!workflowFacts) continue;
    if (section.kind === "values") for (const cell of section.values) buckets.get(mapping[cell.label] ?? "Details")?.values.push(cell);
    else buckets.get("Details")?.sections.push(section);
  }
  const items: VisibleArchiveSection[] = names.flatMap((name, index) => {
    const bucket = buckets.get(name);
    return bucket === undefined || bucket.values.length + bucket.sections.length === 0 ? [] : [{ key: base + index, label: name, kind: "facts" as const, values: bucket.values, sections: bucket.sections }];
  });
  const input = report.sections.find(section => section.title === "Inputs & settings" && section.kind === "values");
  if (input?.kind === "values") {
    const submitted = input.values.find(cell => cell.label === "Submitted input");
    const parsed = input.values.find(cell => cell.label === "Parsed input");
    const settings = input.values.find(cell => cell.label === "Captured settings");
    const mode = input.values.find(cell => cell.label === "Run mode");
    if (submitted !== undefined) items.push({ key: base + 5, label: "Submitted input", kind: "input", value: submitted.value });
    if (parsed !== undefined) items.push({ key: base + 6, label: "Parsed input", kind: "input", value: parsed.value });
    if (settings !== undefined || mode !== undefined) items.push({ key: base + 7, label: "Settings", kind: "settings", values: [
      ...(mode === undefined ? [] : [{ label: "Run mode", value: mode.value }]),
      ...(settings === undefined ? [] : [{ label: "Captured settings", value: visibleCapturedSettings(settings.value) }]),
    ] });
  } else {
    const legacy = report.sections.find(section => section.title === "Run and frozen inputs" && section.kind === "values");
    if (legacy?.kind === "values") {
      for (const [prefix, label, key] of [["input.raw", "Submitted input", 5], ["input.parsed.value", "Parsed input", 6]] as const) {
        const values = legacy.values.filter(cell => cell.label === prefix || cell.label.startsWith(`${prefix}.`))
          .map(cell => ({ label: readableArchiveLabel(cell.label.slice(prefix.length).replace(/^\./u, "") || "Value"), value: cell.value }));
        if (values.length > 0) items.push({ key: base + key, label, kind: "facts", values });
      }
      const mode = legacy.values.find(cell => cell.label === "envelope.dryRun");
      if (mode !== undefined) items.push({ key: base + 7, label: "Settings", kind: "settings", values: [{ label: "Run mode", value: mode.value === true ? "Dry run" : mode.value === false ? "Live run" : mode.value }] });
    }
  }
  items.push({ key: base + 8, label: "Logs", kind: "logs" });
  items.push({ key: report.sections.length + 1, label: "Retained files", kind: "files" });
  return items;
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
