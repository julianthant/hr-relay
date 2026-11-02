import { describe,expect,it } from "vitest";
import { z } from "zod";
import { runRecordColumns,runRecordFromRow,transitionRunRecord } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { LATER, NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

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

  it.each(["workflow", "item_id", "attempt", "run_number", "state", "pause_state", "claim_generation", "version", "settings_snapshot_id", "dry_run", "local_day", "created_at", "updated_at",
    "id", "batch_id", "parent_id", "outcome", "priority", "not_before", "owner_worker_id", "heartbeat_at", "descriptor_version", "contract_fingerprint", "trace_id", "enqueued_at", "session_id"])("refuses a mismatched %s scalar", key => {
    const row = runRecordColumns(record());
    expect(() => runRecordFromRow({ ...row, [key]: key === "attempt" ? 9 : "mismatch" })).toThrow();
  });

  it("refuses an omitted native scalar column instead of deriving it from JSON", () => {
    const { version: _version, ...row } = runRecordColumns(record());
    expect(() => runRecordFromRow(row)).toThrow("run row columns do not match the native schema");
  });

  it.each(["envelope_json", "lifecycle_json"])("refuses absent, non-string and malformed %s", key => {
    const row = runRecordColumns(record());
    const without: Record<string, unknown> = { ...row };
    delete without[key];
    expect(() => runRecordFromRow(without)).toThrow("run row is missing whole-record JSON");
    expect(() => runRecordFromRow({ ...row, [key]: null })).toThrow("run row is missing whole-record JSON");
    expect(() => runRecordFromRow({ ...row, [key]: "{" })).toThrow(SyntaxError);
    expect(() => runRecordFromRow({ ...row, [key]: "{}" })).toThrow();
  });

  it.each([{ value: null }, { value: [] }, { value: 3 }])("refuses a non-object lifecycle JSON value $value", ({ value }) => {
    expect(() => runRecordFromRow({ ...runRecordColumns(record()), lifecycle_json: JSON.stringify(value) }))
      .toThrow("run lifecycle JSON must contain exactly the non-envelope record");
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

  it.each(["claimed", "rename", "cancelled"] as const)("persists an ordinary %s transition without inventing a pause field", kind => {
    const current = RunRecordSchema.parse(QUEUED_RUN);
    const candidate = RunRecordSchema.parse({ ...current,
      ...(kind === "claimed" ? { lifecycle: { state: "claimed", workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW }, claimGeneration: 1 }
        : kind === "cancelled" ? { lifecycle: { state: "terminal", outcome: "cancelled", endedAt: LATER } } : { displayName: "Renamed run" }) });
    const updated = transitionRunRecord(current, candidate, LATER);
    expect(Object.hasOwn(updated, "pause")).toBe(false);
    expect(updated.version).toBe(current.version + 1);
    expect(updated.updatedAt).toBe(LATER);
    expect(runRecordFromRow(runRecordColumns(updated))).toEqual(updated);
    expect(updated.envelope).toEqual(current.envelope);
    expect(updated.input).toEqual(current.input);
  });

  it.each(["absent", "undefined"] as const)("clears a held pause when the candidate pause is %s and keeps the native row JSON serializable", kind => {
    const current = RunRecordSchema.parse({ ...QUEUED_RUN, pause: { state: "paused", commandId: UUID_1, requestedAt: NOW, pausedAt: NOW } });
    const { pause: _pause, ...withoutPause } = current;
    const candidate = RunRecordSchema.parse({ ...withoutPause, ...(kind === "undefined" ? { pause: undefined } : {}) });
    const updated = transitionRunRecord(current, candidate, LATER);
    expect(Object.hasOwn(updated, "pause")).toBe(false);
    const row = runRecordColumns(updated);
    expect(row.pause_state).toBe(null);
    expect(Object.hasOwn(z.record(z.string(), z.unknown()).parse(JSON.parse(row.lifecycle_json)), "pause")).toBe(false);
    expect(runRecordFromRow(row)).toEqual(updated);
  });

  it.each(["queued", "parked-gate"] as const)("retains requested-pause acknowledgement when an active claim releases to %s", state => {
    const current = RunRecordSchema.parse({ ...QUEUED_RUN, claimGeneration: 1,
      lifecycle: { state: "running", workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW },
      pause: { state: "requested", commandId: UUID_1, requestedAt: NOW } });
    const candidate = RunRecordSchema.parse({ ...current, lifecycle: state === "queued" ? { state, requeuedFrom: "recovery" }
      : { state, gateId: "approval", resumeAt: "finish", parkedAt: LATER } });
    const updated = transitionRunRecord(current, candidate, LATER);
    expect(updated.pause).toEqual({ ...current.pause, state: "paused", pausedAt: LATER });
    expect(runRecordFromRow(runRecordColumns(updated))).toEqual(updated);
  });

  it("keeps the canonical serializer strict about an explicit undefined pause", () => {
    expect(() => runRecordColumns(RunRecordSchema.parse({ ...QUEUED_RUN, pause: undefined }))).toThrow("canonical-json-invalid");
  });

});
