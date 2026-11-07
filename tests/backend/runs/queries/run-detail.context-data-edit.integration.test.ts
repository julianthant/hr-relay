import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildRunSection } from "../../../../src/backend/runs/queries/run-detail.js";
import { ContextDataSectionSchema } from "../../../../src/models/dashboard/run-detail.js";
import { DeletedRunRecordSchema } from "../../../../src/models/run/deleted-run.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_B, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { runRecordOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";

const {world, OUTPUT_SCHEMA_HASH, EXACT_DESCRIPTOR, depsOf, sourceRun, checkpointFor, storeCheckpoint, cleanup } = createRunDetailTestWorld();

afterEach(cleanup);

function contextData(
  current: DashboardWorld,
  runId: string,
  options: Parameters<typeof depsOf>[1] = {},
) {
  const response = buildRunSection(depsOf(current, options), runId, "context-data");
  if (response.section !== "context-data") throw new Error("wrong section");
  return response.payload;
}

describe("read-only Context Data projection", () => {
  it("reads exact selected-run checkpoint values, coordinates and provenance without changing authority", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 1, claimGeneration: 1, version: 2 });
    const checkpoint = checkpointFor(source, { provenance: [
      { path: "invitedOn.value", source: "live", observedAt: "2026-08-03T16:58:00.000Z", originalObservedAt: NOW },
    ] });
    storeCheckpoint(current, checkpoint);
    const generation = current.database.getMeta().authorityGeneration;

    const payload = contextData(current, source.envelope.runId);
    assert.equal(payload.state, "available");
    assert.equal(payload.entries.length, 3);
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.equal(invited.coordinate.nodeId, "crm-dates");
    assert.equal(invited.coordinate.fieldPath, "invitedOn.value");
    assert.deepEqual(invited.checkpoint, {
      state: "present",
      runId: source.envelope.runId,
      attempt: source.envelope.attempt,
      claimGeneration: 1,
      descriptorVersion: source.envelope.descriptorVersion,
      contractFingerprint: source.envelope.contractFingerprint,
      schemaHash: OUTPUT_SCHEMA_HASH,
      writtenAt: NOW,
    });
    assert.equal(invited.origin?.step, "CRM dates");
    assert.equal(invited.source, "live");
    assert.equal(invited.observedAt, "2026-08-03T16:58:00.000Z");

    const absentOutcome = payload.entries.find((entry) => entry.label === "Completed on");
    assert.equal(absentOutcome?.checkpoint.state, "present");
    assert.equal(absentOutcome?.valueState, "absent");
    assert.equal(absentOutcome?.valueRedacted, "Not recorded on this outcome");
    assert.equal(JSON.stringify(payload).includes("edit"), false);
    assert.equal(current.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(current.database.authority.runCheckpoints.get(
      source.envelope.workflow, source.envelope.itemId, "crm-dates", source.envelope.attempt, 1,
    ), checkpoint);
  });

  it("does not borrow a sibling attempt's latest checkpoint, value, provenance or origin", async () => {
    const current = await world();
    const first = sourceRun(current, { seed: 11, attempt: 1, claimGeneration: 1 });
    const secondBase = runRecordOf({ seed: 12, attempt: 2, claimGeneration: 1 });
    const second = RunRecordSchema.parse({
      ...secondBase,
      envelope: { ...secondBase.envelope, itemId: first.envelope.itemId, retryOf: first.envelope.runId },
    });
    current.database.authority.runs.enqueue(second);
    storeCheckpoint(current, checkpointFor(second, {
      outputValue: { invitedOn: { state: "present", value: "SIBLING_VALUE" } },
      provenance: [{ path: "invitedOn.value", source: "operator", observedAt: NOW, originalObservedAt: NOW, correctedAt: NOW }],
    }));

    const payload = contextData(current, first.envelope.runId);
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.deepEqual(invited.checkpoint, { state: "absent", reason: "no-checkpoint-for-run" });
    assert.equal(invited.valueState, "absent");
    assert.equal(invited.valueRedacted, "Not recorded for this run");
    assert.equal(invited.origin, undefined);
    assert.equal(invited.observedAt, undefined);
    assert.equal(JSON.stringify(payload).includes("SIBLING_VALUE"), false);
    assert.equal(JSON.stringify(payload).includes(NOW), false);
  });

  it("marks a same-attempt checkpoint with the wrong run identity malformed", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 13, attempt: 1, claimGeneration: 1 });
    const malformed = RunCheckpointRecordSchema.parse({
      ...checkpointFor(source),
      runId: uuidOf(1313),
    });
    const corruptedDatabase = {
      authority: { runCheckpoints: { listByAttempt: () => [malformed] } },
      withAuthorityReadSnapshot: <T>(read: () => T): T =>
        current.database.withAuthorityReadSnapshot(read),
    } as unknown as NonNullable<RunDetailQueryDeps["canonical"]>["database"];

    const payload = contextData(current, source.envelope.runId, { database: corruptedDatabase });
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.deepEqual(invited.checkpoint, { state: "malformed", reason: "checkpoint-identity-mismatch" });
    assert.equal(invited.valueState, "malformed");
    assert.equal(invited.valueRedacted, "Checkpoint could not be verified");
  });

  it("selects the exact run checkpoint before considering foreign same-attempt rows", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 131, attempt: 1, claimGeneration: 2 });
    const exact = checkpointFor(source, {
      claimGeneration: 1,
      outputValue: { emplId: "10000023", invitedOn: { state: "present", value: "2026-06-01" } },
    });
    const foreign = RunCheckpointRecordSchema.parse({
      ...checkpointFor(source, {
        claimGeneration: 2,
        outputValue: { emplId: "10000023", invitedOn: { state: "present", value: "FOREIGN_RUN_VALUE" } },
      }),
      runId: uuidOf(1314),
    });
    const corruptedDatabase = {
      authority: { runCheckpoints: { listByAttempt: () => [exact, foreign] } },
      withAuthorityReadSnapshot: <T>(read: () => T): T =>
        current.database.withAuthorityReadSnapshot(read),
    } as unknown as NonNullable<RunDetailQueryDeps["canonical"]>["database"];

    const payload = contextData(current, source.envelope.runId, { database: corruptedDatabase });
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.equal(invited.checkpoint.state, "present");
    if (invited.checkpoint.state !== "present") throw new Error("exact source checkpoint was not selected");
    assert.equal(invited.checkpoint.runId, source.envelope.runId);
    assert.equal(invited.checkpoint.claimGeneration, 1);
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.equal(JSON.stringify(payload).includes("FOREIGN_RUN_VALUE"), false);
  });

  it("refuses a checkpoint claim generation newer than the selected run", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 14, attempt: 1, claimGeneration: 1 });
    storeCheckpoint(current, checkpointFor(source, { claimGeneration: 2 }));

    const payload = contextData(current, source.envelope.runId);
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.deepEqual(invited.checkpoint, { state: "malformed", reason: "checkpoint-identity-mismatch" });
    assert.equal(invited.valueState, "malformed");
  });

  it("returns a deleted state with no openable checkpoint values", async () => {
    const current = await world();
    const deleted = sourceRun(current, { seed: 41 });
    const baseReader = sqliteRunReader(current.database, current.clock);
    const tombstone = DeletedRunRecordSchema.parse({
      runId: deleted.envelope.runId,
      workflow: deleted.envelope.workflow,
      traceId: deleted.envelope.traceId,
      itemId: deleted.envelope.itemId,
      attempt: deleted.envelope.attempt,
      runNumber: null,
      ordinalSource: "tombstone",
      origin: "queue",
      commandId: uuidOf(4141),
      deletedAt: NOW,
      tallyVersion: 3,
      removed: [],
    });
    const reader = {
      ...baseReader,
      read: (runId: string) => runId === deleted.envelope.runId
        ? { state: "deleted" as const, tombstone }
        : baseReader.read(runId),
    };
    const payload = contextData(current, deleted.envelope.runId, { reader });
    assert.equal(payload.state, "deleted");
    assert.deepEqual(payload.entries, []);
  });

  it("serves retained protected checkpoint values in the BFF response", async () => {
    const current = await world();
    const secret = "protected-test-value-774411";
    const base = runRecordOf({ seed: 51, claimGeneration: 1, version: 2 });
    const protectedRun = RunRecordSchema.parse({
      ...base,
      input: {
        ...base.input,
        parsed: {
          ...base.input.parsed,
          value: { emplId: secret, timekeeperName: secret },
          protectedBindings: [{
            kind: "protected-store",
            inputPath: "timekeeperName",
            name: "timekeeperName",
            valueId: uuidOf(5151),
          }],
        },
      },
    });
    current.database.authority.runs.enqueue(protectedRun);
    storeCheckpoint(current, checkpointFor(protectedRun, {
      outputValue: { emplId: secret },
    }));
    const payload = contextData(current, protectedRun.envelope.runId, {
      fields: [{ nodeId: "crm-dates", fieldPath: "emplId", label: "Employee id" }],
    });
    const employeeId = payload.entries[0];
    assert.ok(employeeId);
    assert.equal(employeeId.valueState, "present");
    assert.equal(employeeId.valueRedacted, secret);
    assert.equal(JSON.stringify(payload).includes(secret), true);
  });

  it("keeps stale descriptor and malformed output hashes out of the value projection", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 61, claimGeneration: 1, version: 2 });
    storeCheckpoint(current, checkpointFor(source, { descriptorVersion: 2 }));
    let payload = contextData(current, source.envelope.runId);
    let invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.equal(invited?.checkpoint.state, "malformed");
    assert.equal(invited?.valueState, "malformed");
    assert.equal(invited?.valueRedacted, "Checkpoint could not be verified");
    assert.equal(invited?.origin, undefined);

    const next = sourceRun(current, { seed: 62, claimGeneration: 1, version: 2 });
    storeCheckpoint(current, checkpointFor(next, { schemaHash: HASH_B }));
    payload = contextData(current, next.envelope.runId);
    invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.equal(invited?.checkpoint.state, "malformed");
    assert.equal(invited?.checkpoint.reason, "output-schema-mismatch");
    assert.equal(invited?.valueRedacted, "Checkpoint could not be verified");
  });

  it("refuses a descriptor that no longer matches the exact source run", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 63, claimGeneration: 1, version: 2 });
    const descriptor = { ...EXACT_DESCRIPTOR, version: EXACT_DESCRIPTOR.version + 1 } as AnyWorkflowDescriptor;
    const payload = contextData(current, source.envelope.runId, { exactDescriptor: descriptor });
    assert.deepEqual(payload, {
      runId: source.envelope.runId,
      state: "unavailable",
      reason: "descriptor-mismatch",
      entries: [],
      observations: [],
    });
  });

  it("refuses stale editable prefill fields and leaves checkpoint/source authority untouched", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 71, claimGeneration: 1, version: 2 });
    const checkpoint = checkpointFor(source);
    storeCheckpoint(current, checkpoint);
    const generation = current.database.getMeta().authorityGeneration;
    const beforeRun = current.database.authority.runs.get(source.envelope.runId);
    const payload = contextData(current, source.envelope.runId);
    const legacyShape = {
      ...payload,
      entries: payload.entries.map((entry) => ({ ...entry, edit: { state: "editable", value: "stale" } })),
    };
    assert.equal(ContextDataSectionSchema.safeParse(legacyShape).success, false);
    assert.equal(current.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(current.database.authority.runs.get(source.envelope.runId), beforeRun);
    assert.deepEqual(current.database.authority.runCheckpoints.get(
      source.envelope.workflow, source.envelope.itemId, "crm-dates", source.envelope.attempt, 1,
    ), checkpoint);
  });
});
