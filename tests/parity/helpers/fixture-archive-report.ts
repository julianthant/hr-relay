/** H-owned synthetic document. No current descriptor or live record is needed. */
import { SavedArchiveReportWireSchema } from "../../../src/models/dashboard/archive.js";
export const H_REPORT = SavedArchiveReportWireSchema.parse({
  state: "available", runId: "00000000-0000-4000-8000-000000000081",
  title: "Synthetic retained report", workflow: "removed-workflow", descriptorVersion: "retired-v7",
  outcome: "superseded", completedAt: "2026-08-01T12:00:00.000Z", capturedAt: "2026-08-02T12:00:00.000Z",
  archiveFingerprint: "a".repeat(64),
  sections: [
    { kind: "values", title: "Captured facts", values: [{ label: "Subject", value: "Synthetic subject" }, { label: "Count", value: 0 }, { label: "Verified", value: true }, { label: "Submitted", value: false }, { label: "Absent", value: null }] },
    { kind: "table", title: "Retained work", columns: ["Step", "Result"], rows: [["Review", "Recorded"], ["Resolution", "Captured approval"]] },
    { kind: "text", title: "Saved logs", text: "Review recorded\nNo live resolution is available. <script>unsafe()</script>" },
    { kind: "unavailable", title: "Old evidence", reason: "These bytes were not retained." },
  ],
  files: [{ name: "Synthetic receipt.txt", digest: "b".repeat(64), byteLength: 17, mediaType: "text/plain" }],
  versionChange: { changeId: "00000000-0000-4000-8000-000000000082", change: { kind: "major", what: "Archived old workflow", why: "Replaced input contract", commit: { state: "absent", reason: "Commit not captured" } }, scope: { kind: "workflows", workflowIds: ["removed-workflow"] }, targetVersion: "8", reviewedAt: "2026-08-02T10:00:00.000Z", startedAt: "2026-08-02T11:00:00.000Z", appliedBy: "Synthetic operator" },
});
