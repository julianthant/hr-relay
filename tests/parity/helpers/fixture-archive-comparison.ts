import { SavedArchiveReportWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
import type { SavedArchiveReportWire } from "../../../src/domain/dashboard/archive.js";

const v = (major: number, minor: number) => ({ major, minor });
const fields = (person: number) => [
  { label: "Employee name", value: `Sample Person ${String(person).padStart(2, "0")}` },
  { label: "Employee ID", value: `DEMO-${String(person).padStart(2, "0")}` },
  { label: "Document number", value: `SAMPLE-${String(person).padStart(2, "0")}` },
  { label: "Last day worked", value: "09/18/2026" },
  { label: "Separation date", value: "09/20/2026" },
  { label: "Termination effective date", value: "09/21/2026" },
  { label: "Date source", value: "kronos-timesheet" },
  { label: "Kuali last day worked", value: "09/18/2026" },
  { label: "Kuali separation date", value: "09/18/2026" },
  { label: "Last day worked changed", value: false },
  { label: "Separation date changed", value: true },
  { label: "Latest sick date", value: "09/20/2026" },
  { label: "First holiday date", value: null },
  { label: "Latest holiday date", value: null },
  { label: "Separation determining leave", value: "sick" },
  { label: "Unclassified pay codes", value: [] },
];

function report(number: number, dashboard: { major: number; minor: number } | null,
  workflow: "separations" | "person-lookup", workflowVersion: { major: number; minor: number },
  day: number): SavedArchiveReportWire {
  const runId = `aa11bb22-0100-4000-8000-${String(number).padStart(12, "0")}`;
  const isSeparation = workflow === "separations";
  return SavedArchiveReportWireSchema.parse({
    state: "available", runId, title: isSeparation ? `Run ${number}` : `Person lookup ${number}`,
    workflow, descriptorVersion: "1", outcome: "done", completedAt: `2026-09-${String(day).padStart(2, "0")}T11:00:00.000Z`,
    capturedAt: `2026-09-${String(day).padStart(2, "0")}T11:30:00.000Z`, archiveFingerprint: "e".repeat(64),
    ...(dashboard === null ? {} : { runtimeVersion: { state: "stamped", dashboard, workflow: workflowVersion } }),
    sections: [
      { kind: "values", title: isSeparation ? "Identity and separation" : "Identity and lookup", values: fields(number) },
      { kind: "values", title: "Inputs & settings", values: [
        { label: "Dry run", value: true }, { label: "Hours", value: 0 },
        { label: "Input options", value: { source: "synthetic", codes: ["A", "B"] } },
      ] },
      { kind: "table", title: "Steps & results", columns: ["Step", "Result"], rows: [["Prepare", "Done"], ["Verify", "Done"]] },
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
