import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { ContextDataSectionSchema, RunDetailSectionResponseSchema } from "../../../src/domain/dashboard/run-detail.js";
import { DeletedRunRecordSchema } from "../../../src/domain/run/deleted-run.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { buildRunSection } from "../../../src/server/dashboard/queries/run-detail.js";
import { composeDataQueries } from "../../../src/backend/app/dashboard/compose/data.js";
import { registerDataRoutes } from "../../../src/backend/transports/dashboard/routes/data.js";
import type { DashboardApp } from "../../../src/backend/transports/dashboard/routes/api-types.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "../../../src/server/dashboard/queries/run-detail-types.js";
import { HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import {
  makeWorld,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "../../unit/server/helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const current of worlds.splice(0)) current.dispose();
});

const DATE_VALUE_SCHEMA = z.strictObject({
  state: z.enum(["present", "absent"]),
  value: z.string().optional(),
  reason: z.string().optional(),
});
const OUTPUT_SCHEMA = z.strictObject({
  emplId: z.string().optional(),
  invitedOn: DATE_VALUE_SCHEMA.optional(),
  startsOn: DATE_VALUE_SCHEMA.optional(),
  completedOn: DATE_VALUE_SCHEMA.optional(),
});
const OUTPUT_SCHEMA_HASH = deriveSchemaHash(OUTPUT_SCHEMA, "output");
const DATE_FIELDS = [
  { nodeId: "crm-dates", fieldPath: "invitedOn.value", label: "Invited on" },
  { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" },
  { nodeId: "crm-dates", fieldPath: "completedOn.value", label: "Completed on" },
] as const;

const EXACT_DESCRIPTOR = {
  id: "person-lookup",
  version: 1,
  contractFingerprint: HASH_A,
  nodes: [{ kind: "task", id: "crm-dates", uses: { output: OUTPUT_SCHEMA } }],
} as unknown as AnyWorkflowDescriptor;

function descriptorView(fields: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[]
  = DATE_FIELDS): RunDetailDescriptorView {
  return {
    capabilities: { editData: { fields } },
    dataOrigins: [{
      nodeId: "crm-dates",
      step: "CRM dates",
      taskId: "crm-read",
      role: "task",
      dir: "read",
      system: "crm",
      feeds: [],
    }],
  };
}

function depsOf(
  current: DashboardWorld,
  options: Readonly<{
    fields?: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[];
    reader?: RunDetailQueryDeps["runReader"];
    database?: NonNullable<RunDetailQueryDeps["canonical"]>["database"];
    exactDescriptor?: AnyWorkflowDescriptor | undefined;
  }> = {},
): RunDetailQueryDeps {
  const reader = options.reader ?? sqliteRunReader(current.database, current.clock);
  return {
    runReader: reader,
    stateRoot: current.stateRoot,
    projection: current.projection,
    authority: current.authority,
    descriptors: { resolve: () => descriptorView(options.fields) },
    canonical: {
      reader,
      database: options.database ?? current.database,
      descriptors: { resolve: () => options.exactDescriptor === undefined
        ? EXACT_DESCRIPTOR
        : options.exactDescriptor },
    },
  };
}

function sourceRun(current: DashboardWorld, input: Parameters<typeof runRecordOf>[0]) {
  const run = runRecordOf(input);
  current.database.authority.runs.enqueue(run);
  return run;
}

function checkpointFor(
  run: ReturnType<typeof runRecordOf>,
  overrides: Readonly<{
    outputValue?: unknown;
    nodeId?: string;
    runId?: string;
    attempt?: number;
    claimGeneration?: number;
    descriptorVersion?: number;
    contractFingerprint?: string;
    schemaHash?: string;
    provenance?: readonly unknown[];
  }> = {},
) {
  return RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: overrides.nodeId ?? "crm-dates",
    attempt: overrides.attempt ?? run.envelope.attempt,
    claimGeneration: overrides.claimGeneration ?? 1,
    runId: overrides.runId ?? run.envelope.runId,
    output: {
      schemaHash: overrides.schemaHash ?? OUTPUT_SCHEMA_HASH,
      value: overrides.outputValue ?? {
        emplId: "10000023",
        invitedOn: { state: "present", value: "2026-06-01" },
        startsOn: { state: "present", value: "2026-07-15" },
        completedOn: { state: "absent", reason: "No completed transition" },
      },
    },
    descriptorVersion: overrides.descriptorVersion ?? run.envelope.descriptorVersion,
    contractFingerprint: overrides.contractFingerprint ?? run.envelope.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: overrides.provenance ?? [],
    writtenAt: NOW,
  });
}

function storeCheckpoint(current: DashboardWorld, record: ReturnType<typeof checkpointFor>) {
  current.database.authority.runCheckpoints.insert(record);
}

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
  it("reads exact selected-run checkpoint values, coordinates and provenance without changing authority", () => {
    const current = world();
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

  it("does not borrow a sibling attempt's latest checkpoint, value, provenance or origin", () => {
    const current = world();
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

  it("marks a same-attempt checkpoint with the wrong run identity malformed", () => {
    const current = world();
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

  it("selects the exact run checkpoint before considering foreign same-attempt rows", () => {
    const current = world();
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

  it("refuses a checkpoint claim generation newer than the selected run", () => {
    const current = world();
    const source = sourceRun(current, { seed: 14, attempt: 1, claimGeneration: 1 });
    storeCheckpoint(current, checkpointFor(source, { claimGeneration: 2 }));

    const payload = contextData(current, source.envelope.runId);
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.deepEqual(invited.checkpoint, { state: "malformed", reason: "checkpoint-identity-mismatch" });
    assert.equal(invited.valueState, "malformed");
  });

  it("serves prior-run data through the production section route with exact source identity", async () => {
    const current = world();
    const source = sourceRun(current, { seed: 21, attempt: 1, claimGeneration: 1 });
    const laterBase = runRecordOf({ seed: 22, attempt: 2, claimGeneration: 1 });
    const later = RunRecordSchema.parse({
      ...laterBase,
      envelope: { ...laterBase.envelope, itemId: source.envelope.itemId, retryOf: source.envelope.runId },
    });
    current.database.authority.runs.enqueue(later);
    storeCheckpoint(current, checkpointFor(source, { outputValue: {
      invitedOn: { state: "present", value: "PRIOR_RUN_VALUE" },
    } }));
    storeCheckpoint(current, checkpointFor(later, { outputValue: {
      invitedOn: { state: "present", value: "CURRENT_RUN_VALUE" },
    } }));
    const deps = depsOf(current);
    const app: DashboardApp = new Hono();
    registerDataRoutes(app, () => composeDataQueries(deps));
    const response = await app.request("/api/v1/runs/" + source.envelope.runId + "/context-data");
    assert.equal(response.status, 200);
    const section = RunDetailSectionResponseSchema.parse(await response.json());
    assert.equal(section.section, "context-data");
    if (section.section !== "context-data") throw new Error("wrong section");
    assert.equal(section.payload.runId, source.envelope.runId);
    assert.equal(section.payload.entries.find((entry) => entry.label === "Invited on")?.valueRedacted, "PRIOR_RUN_VALUE");
    assert.equal(JSON.stringify(section).includes("CURRENT_RUN_VALUE"), false);
  });

  it("marks a retained archived checkpoint read-only and keeps its validated value", () => {
    const current = world();
    const archived = sourceRun(current, { seed: 31, claimGeneration: 1, version: 2 });
    storeCheckpoint(current, checkpointFor(archived));
    const reader = sqliteRunReader(current.database, current.clock);
    const archivedReader = {
      ...reader,
      read: (runId: string) => {
        const result = reader.read(runId);
        return result.state === "present" ? { ...result, disposition: "archived" as const } : result;
      },
    } as typeof reader;
    const payload = contextData(current, archived.envelope.runId, { reader: archivedReader });
    assert.equal(payload.state, "archived");
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.equal(invited.checkpoint.state, "present");
    if (invited.checkpoint.state === "present") assert.equal(invited.checkpoint.runId, archived.envelope.runId);
  });

  it("returns a deleted state with no openable checkpoint values", () => {
    const current = world();
    const deleted = sourceRun(current, { seed: 41 });
    const baseReader = sqliteRunReader(current.database, current.clock);
    const tombstone = DeletedRunRecordSchema.parse({
      runId: deleted.envelope.runId,
      workflow: deleted.envelope.workflow,
      traceId: deleted.envelope.traceId,
      itemId: deleted.envelope.itemId,
      attempt: deleted.envelope.attempt,
      origin: "queue",
      commandId: uuidOf(4141),
      deletedAt: NOW,
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

  it("serves retained protected checkpoint values in the BFF response", () => {
    const current = world();
    const secret = "protected-test-value-774411";
    const base = runRecordOf({ seed: 51, claimGeneration: 1, version: 2 });
    const protectedRun = RunRecordSchema.parse({
      ...base,
      input: {
        ...base.input,
        parsed: {
          ...base.input.parsed,
          value: { emplId: secret },
          protectedBindings: [{
            kind: "legacy-protected-input",
            inputPath: "emplId",
            name: "personLookupCanaryEid",
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

  it("keeps stale descriptor and malformed output hashes out of the value projection", () => {
    const current = world();
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

  it("refuses a descriptor that no longer matches the exact source run", () => {
    const current = world();
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

  it("refuses stale editable prefill fields and leaves checkpoint/source authority untouched", () => {
    const current = world();
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
