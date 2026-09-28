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
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string" && value === "") return '""';
  if (Array.isArray(value)) return value.length === 0 ? "[]" : archiveCellJson(value);
  if (typeof value === "object") return Object.keys(value).length === 0 ? "{}" : archiveCellJson(value);
  return String(value);
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
