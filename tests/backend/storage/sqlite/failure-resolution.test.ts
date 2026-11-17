import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { failureResolutionFromRow } from "../../../../src/backend/storage/sqlite/failure-resolution.js";

const RUN = "10000000-0000-4000-8000-000000000001", FAILURE = "30000000-0000-4000-8000-000000000001";
const row = (resolution_json: string, resolution_version = 1) => ({ id: FAILURE, run_id: RUN, resolution_json, resolution_version, code: "SUBJECT_MISMATCH" });

describe("stored failure resolution parse", () => {
  it("reads the capture from a run_failures row", () => {
    assert.deepEqual(failureResolutionFromRow(row('{"status":"resolved","version":2,"by":"local-operator","at":"2026-10-01T12:00:00.000Z"}', 2)),
      { failureId: FAILURE, runId: RUN, resolution: { status: "resolved", version: 2, by: "local-operator", at: "2026-10-01T12:00:00.000Z" } });
  });

  it("refuses a resolution whose version disagrees with its version column", () => {
    assert.throws(() => failureResolutionFromRow(row('{"status":"unresolved","version":2}', 1)), /failure-resolution-version-mismatch/u);
  });

  it("refuses unreadable or invalid resolution JSON by name", () => {
    assert.throws(() => failureResolutionFromRow(row("{")), /failure-resolution-annotation-invalid/u);
    assert.throws(() => failureResolutionFromRow(row('{"status":"open","version":1}')), /failure-resolution-annotation-invalid/u);
  });
});
