import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runRecordColumns, runRecordFromRow } from "../../../../../src/backend/storage/sqlite/run-record-row.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../../support/fixtures/phase1f-run-fixtures.js";

describe("native run rows", () => {
  const record = () => RunRecordSchema.parse({
    ...QUEUED_RUN,
    lifecycle: { state: "queued", notBefore: QUEUED_RUN.createdAt, requeuedFrom: "reassign" },
    cancelRequested: true,
    displayName: "A current run",
    appVersion: "0.1.0",
    runNumber: 17,
  });

  it("round trips the envelope and every remaining field separately", () => {
    const run = record();
    const row = runRecordColumns(run);
    expect(JSON.parse(row.envelope_json)).toEqual(run.envelope);
    const { envelope, ...remaining } = run;
    expect(JSON.parse(row.lifecycle_json)).toEqual(remaining);
    expect(runRecordFromRow(row)).toEqual(run);
    expect(row.local_day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(envelope).toEqual(run.envelope);
  });

  it.each(["workflow", "item_id", "attempt", "run_number", "state", "claim_generation", "version", "settings_snapshot_id", "dry_run", "local_day", "created_at", "updated_at"])("refuses a mismatched %s scalar", key => {
    const row = runRecordColumns(record());
    expect(() => runRecordFromRow({ ...row, [key]: key === "attempt" ? 9 : "mismatch" })).toThrow();
  });

  it("refuses extra row columns and unknown whole-record fields", () => {
    const row = runRecordColumns(record());
    expect(() => runRecordFromRow({ ...row, unrecognized: null })).toThrow();
    expect(() => runRecordFromRow({ ...row, lifecycle_json: JSON.stringify({ ...z.record(z.string(), z.unknown()).parse(JSON.parse(row.lifecycle_json)), unrecognized: true }) })).toThrow();
    expect(() => runRecordFromRow({ ...row, lifecycle_json: JSON.stringify({ ...z.record(z.string(), z.unknown()).parse(JSON.parse(row.lifecycle_json)), envelope: z.unknown().parse(JSON.parse(row.envelope_json)) }) })).toThrow();
  });

  it("does not reconstruct omitted input from scalars", () => {
    const row = runRecordColumns(record());
    const remaining = z.record(z.string(), z.unknown()).parse(JSON.parse(row.lifecycle_json));
    delete remaining.input;
    expect(() => runRecordFromRow({ ...row, lifecycle_json: JSON.stringify(remaining) })).toThrow();
  });
});
