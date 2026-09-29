import { SavedArchiveReportWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
import type { SavedArchiveReportWire } from "../../../src/domain/dashboard/archive.js";

const v = (major: number, minor: number) => ({ major, minor });
const personName = (person: number) => ["", "Morgan Vale", "Avery Reed", "Jordan Quinn", "Taylor Finch", "Casey Rowan", "Riley Park", "Devon Moss"][person] ?? `Example person ${person}`;
const fields = (person: number) => [
  { label: "Employee name", value: personName(person) },
  { label: "Employee ID", value: `DEMO-${String(person).padStart(2, "0")}` },
  { label: "Document number", value: `SAMPLE-${String(person).padStart(2, "0")}` },
  { label: "Last day worked", value: "09/14/2026" },
  { label: "Separation date", value: "09/15/2026" },
  { label: "Termination effective date", value: "09/16/2026" },
  { label: "Date source", value: "kronos-timesheet" },
  { label: "Kuali last day worked", value: "09/14/2026" },
  { label: "Kuali separation date", value: "09/14/2026" },
  { label: "Last day worked changed", value: false },
  { label: "Separation date changed", value: true },
  { label: "Latest sick date", value: "09/15/2026" },
  { label: "First holiday date", value: null },
  { label: "Latest holiday date", value: null },
  { label: "Separation determining leave", value: "sick" },
  { label: "Unclassified pay codes", value: [] },
];
const lookupFields = (person: number) => [
  { label: "Employee name", value: personName(person) },
  { label: "Employee ID", value: `DEMO-${String(person).padStart(2, "0")}` },
  { label: "Lookup status", value: "Record found" },
  { label: "Source system", value: "UCPath" },
];

function report(number: number, dashboard: { major: number; minor: number } | null,
  workflow: "separations" | "person-lookup", workflowVersion: { major: number; minor: number },
  day: number): SavedArchiveReportWire {
  const runId = `aa11bb22-0100-4000-8000-${String(number).padStart(12, "0")}`;
  const isSeparation = workflow === "separations";
  return SavedArchiveReportWireSchema.parse({
    state: "available", runId, title: isSeparation ? `${personName(number)} · Separation ${number}` : `${personName(number)} · Lookup ${number}`,
    workflow, descriptorVersion: "1", outcome: "done", completedAt: `2026-09-${String(day).padStart(2, "0")}T11:00:00.000Z`,
    capturedAt: `2026-09-${String(day).padStart(2, "0")}T11:30:00.000Z`, archiveFingerprint: "e".repeat(64),
    ...(dashboard === null ? {} : { runtimeVersion: { state: "stamped", dashboard, workflow: workflowVersion } }),
    sections: [
      { kind: "values", title: isSeparation ? "Identity and separation" : "Identity and lookup", values: isSeparation ? fields(number) : lookupFields(number) },
      { kind: "values", title: "Inputs & settings", values: [
        { label: "Run mode", value: "Dry run" },
        { label: "Submitted input", value: isSeparation ? { employeeId: `DEMO-${String(number).padStart(2, "0")}`, lastDayWorked: "2026-09-14", separationDate: "2026-09-15" } : { employeeId: `DEMO-${String(number).padStart(2, "0")}` } },
        { label: "Parsed input", value: isSeparation ? { employeeId: `DEMO-${String(number).padStart(2, "0")}`, lastDayWorked: "2026-09-14", separationDate: "2026-09-15" } : { employeeId: `DEMO-${String(number).padStart(2, "0")}` } },
        { label: "Captured settings", value: { state: "unavailable", reason: "No settings snapshot was retained for this example" } },
      ] },
      { kind: "table", title: "Steps & results", columns: ["Step", "Result"], rows: [] },
      { kind: "text", title: "Record notes", text: "Synthetic saved record with complete public field density for design comparison." },
    ],
    files: Array.from({ length: number === 2 ? 3 : 2 }, (_, index) => ({
      digest: String(index + number).padStart(64, "a"), byteLength: 18, mediaType: "text/plain",
      name: `Synthetic attachment ${index + 1}`,
    })),
  });
}

export const ARCHIVE_COMPARISON_REPORTS: readonly SavedArchiveReportWire[] = [
  report(7, v(2, 0), "separations", v(2, 1), 26),
  report(1, v(1, 0), "separations", v(1, 2), 24),
  report(2, v(1, 0), "separations", v(1, 2), 23),
  report(4, v(1, 0), "separations", v(1, 1), 21),
  report(3, v(1, 0), "person-lookup", v(1, 1), 25),
  report(5, null, "separations", v(1, 0), 19),
  report(6, null, "person-lookup", v(1, 0), 18),
];

export const ARCHIVE_COMPARISON_VERSIONS = SavedRuntimeVersionIndexWireSchema.parse({
  revision: 1, dashboard: v(2, 0), workflows: [
    { workflowId: "separations", label: "Separations", version: v(2, 1) },
    { workflowId: "person-lookup", label: "Person lookup", version: v(2, 0) },
  ], changes: [],
});
