import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { testRunLifecycle } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { applyCheckpointPatches } from "../../../../../../src/backend/runtime/checkpoints/checkpoint-patch.js";
import { createCommandKernel, type CommandKernel } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import {
  executeClaimedRun,
  type RunExecutorDependencies,
} from "../../../../../../src/backend/runtime/execution/run-executor.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../../../../../src/models/task/task-contract.js";
import { ScenarioIdSchema, TraceIdSchema, taskId } from "../../../../../../src/rules/identity/ids.js";
import type { RunRecord } from "../../../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import {
  CheckpointPatchSchema,
  RunCheckpointRecordSchema,
  type RunCheckpointRecord,
} from "../../../../../../src/models/workflow/checkpoint.js";
import {
  STANDARD_WORKFLOW_ACTIONS,
  WorkflowCapabilitiesSchema,
} from "../../../../../../src/models/workflow/presentation.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { HASH_A, NOW } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  RUN_ID,
  WORKER_ID,
  sequentialIdFactory,
} from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  openAuthorityHarness,
  recordingEmitter,
  recordingLogger,
  sessionManagerFor,
} from "../../../../../support/helpers/phase1f-executor-harness.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../../../support/fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../../../../support/fixtures/archive-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;
const SCENARIO = ScenarioIdSchema.parse("ocr/capability-wiring-happy");
const RUN2_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);
const EditOutput = z.strictObject({
  subject: z.string().min(1),
  eid: z.string().regex(/^10\d{6}$/u),
  disposition: z.string().min(1),
});
const OUTPUT_VALUE = { subject: "10456712", eid: "10456712", disposition: "retain" };

const editContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Edit data fixture",
  effect: "read",
  input: FixtureInput,
  output: EditOutput,
  errorCodes: ["provider-unavailable"] as const,
  subject: { kind: "none", reason: "edit data fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  example: OUTPUT_VALUE,
});

const editTask = defineTask(editContract, {
  sessions: [],
  async run({ ctx }) {
    ctx.recordData([
      { direction: "read", field: "subject", value: OUTPUT_VALUE.subject },
      { direction: "read", field: "eid", value: OUTPUT_VALUE.eid },
      { direction: "read", field: "disposition", value: OUTPUT_VALUE.disposition },
    ]);
    return { ...OUTPUT_VALUE };
  },
});

function editDescriptor(): AnyWorkflowDescriptor {
  const fixtureFlow = flow(FixtureInput)
    .step("extract", editContract, {
      dependsOn: [],
      replay: "checkpoint",
      bind: ({ input }) => ({ name: input.name }),
    })
    .build({
      schema: z.strictObject({ eid: z.string().min(1) }),
      dependsOn: ["extract"],
      derive: ({ outputs }) => ({ eid: EditOutput.parse(outputs.extract).eid }),
    });
  return defineWorkflowDescriptor({
    id: "wiring-edit-data",
    version: 1,
    contractFingerprint: HASH_A,
    code: "we",
    label: "Edit data fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof FixtureInput>) => `name:${input.name}` },
    presentation: { title: (input: z.output<typeof FixtureInput>) => input.name },
    scenarios: ["wiring-edit-data/happy"],
    capabilities: WorkflowCapabilitiesSchema.parse({
      review: false,
      editData: { fields: [{ nodeId: "extract", fieldPath: "eid", label: "EID" }] },
    }),
    flow: fixtureFlow,
  });
}

const PATCH = CheckpointPatchSchema.parse({
  nodeId: "extract",
  fieldPath: "eid",
  value: "10999999",
  correctedAt: "2026-08-08T13:00:00.000Z",
  reason: "operator verified the EID against the paper form",
});

const REPLAYED: RunCheckpointRecord = RunCheckpointRecordSchema.parse({
  workflowId: "wiring-edit-data",
  itemId: QUEUED_RUN.envelope.itemId,
  nodeId: "extract",
  attempt: 1,
  claimGeneration: 1,
  runId: RUN_ID,
  output: { schemaHash: deriveSchemaHash(EditOutput, "output"), value: OUTPUT_VALUE },
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
  implFingerprint: HASH_A,
  provenance: [
    { path: "subject", source: "live", observedAt: NOW, originalObservedAt: NOW },
    { path: "eid", source: "live", observedAt: NOW, originalObservedAt: NOW },
    { path: "disposition", source: "live", observedAt: NOW, originalObservedAt: NOW },
  ],
  writtenAt: NOW,
});

/* ── 1. the applier ──────────────────────────────────────────────────────── */

describe("applyCheckpointPatches", () => {
  it("re-parses the whole output and moves provenance only on changed leaves", () => {
    const applied = applyCheckpointPatches({
      replayed: REPLAYED,
      patches: [PATCH],
      outputSchema: EditOutput,
      attempt: 2,
      claimGeneration: 1,
      runId: RUN2_ID,
      writtenAt: "2026-08-08T13:01:00.000Z",
    });
    assert.equal(applied.record.attempt, 2);
    assert.deepEqual(applied.record.output.value, { ...OUTPUT_VALUE, eid: "10999999" });
    const corrected = applied.record.provenance.find((fact) => String(fact.path) === "eid");
    assert.deepEqual(corrected, {
      path: "eid",
      source: "operator",
      observedAt: PATCH.correctedAt,
      originalObservedAt: NOW,
      correctedAt: PATCH.correctedAt,
      supersedes: NOW,
    });
    const untouched = applied.record.provenance.find((fact) => String(fact.path) === "subject");
    assert.deepEqual(untouched, REPLAYED.provenance[0]);
  });

  it("refuses a patched output the producing schema rejects", () => {
    assert.throws(() => applyCheckpointPatches({
      replayed: REPLAYED,
      patches: [{ ...PATCH, value: "not-an-eid" }],
      outputSchema: EditOutput,
      attempt: 2,
      claimGeneration: 1,
      runId: RUN2_ID,
      writtenAt: NOW,
    }));
  });

  it("refuses a path the checkpoint output does not carry", () => {
    assert.throws(
      () => applyCheckpointPatches({
        replayed: REPLAYED,
        patches: [{ ...PATCH, fieldPath: ContractFieldPathSchema.parse("salary.rate") }],
        outputSchema: EditOutput,
        attempt: 2,
        claimGeneration: 1,
        runId: RUN2_ID,
        writtenAt: NOW,
      }),
      /does not resolve through the checkpoint output|names a hop/u,
    );
  });
});

/* ── 2. the kernel save ──────────────────────────────────────────────────── */

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

function editCommand(runId: string, expectedVersion: number, patches: readonly unknown[]) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type: "edit-checkpoint",
    target: { runId, expectedVersion },
    payload: { patches },
  };
}

function kernelHarness(descriptor: AnyWorkflowDescriptor): {
  database: AuthorityDatabase;
  kernel: CommandKernel;
} {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-edit-data-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "edit-data-test" },
    clock,
  );
  disposers.push(() => database.close());
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory("e"),
    descriptors: {
      resolve: (workflowId) => (workflowId === String(descriptor.id) ? descriptor : undefined),
    },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("unused"); },
      spawnWorker: () => { throw new Error("unused"); },
      refreshBrowser: () => { throw new Error("unused"); },
      reopenBrowser: () => { throw new Error("unused"); },
    },
  });
  return { database, kernel };
}

function queuedRunFor(descriptor: AnyWorkflowDescriptor, runId?: string, attempt = 1, injected?: readonly unknown[]) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      ...(runId === undefined ? {} : { runId }),
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
      attempt,
      ...(injected === undefined ? {} : { injected }),
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: {
        schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie" },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

describe("checkpoint saves are unavailable", () => {
  it.each([
    { version: 1, patch: PATCH },
    { version: 2, patch: PATCH },
    { version: 1, patch: { ...PATCH, fieldPath: "disposition" } },
    { version: 1, patch: { ...PATCH, value: "not-an-eid" } },
  ])("refuses the retired command regardless of former field/CAS eligibility: %j", ({ version, patch }) => {
    const descriptor = editDescriptor();
    const { database, kernel } = kernelHarness(descriptor);
    database.authority.runs.enqueue(queuedRunFor(descriptor));
    database.authority.runCheckpoints.insert(REPLAYED);
    const before = database.authority.runs.get(RUN_ID);
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => kernel.execute(editCommand(RUN_ID, version, [patch])));
    assert.deepEqual(database.authority.runs.get(RUN_ID), before);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });
});

/* ── 3. the executor consume ─────────────────────────────────────────────── */

function executorHarness(descriptor: AnyWorkflowDescriptor) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = happySessionHarness();
  const emitter = recordingEmitter();
  const store = defineServiceStore("ocr", { fixture: editTask });
  const stores = defineTaskStoreRegistry([store], {
    scenarioIds: [SCENARIO],
    tasks: [{ id: editContract.id, effect: editContract.effect }],
  });
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor,
    stores,
    authority: authority.database,
    sessions: sessionManagerFor(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("f"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
  return { authority, deps };
}

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const claimed = database.authority.runs.claimNext({
    workflow: descriptor.id,
    workerId: WORKER_ID,
    now: new Date("2026-08-03T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration } };
}

describe("executor consume — injected corrections at replay", () => {
  it("applies the patch to the replayed checkpoint and lands the corrected row at the resuming attempt", async () => {
    const descriptor = editDescriptor();
    const harness = executorHarness(descriptor);
    const { database } = harness.authority;
    // Run 1 executes fresh, writing the original checkpoint at attempt 1.
    database.authority.runs.enqueue(queuedRunFor(descriptor));
    const first = claim(database, descriptor);
    const original = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
    assert.equal(original.state, "done");

    // Run 2 resumes the item at attempt 2 carrying the accepted patch.
    database.authority.runs.enqueue(queuedRunFor(descriptor, RUN2_ID, 2, [PATCH]));
    const second = claim(database, descriptor);
    const corrected = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.equal(corrected.state, "done");


    const row = database.authority.runCheckpoints.get(
      String(descriptor.id),
      QUEUED_RUN.envelope.itemId,
      "extract",
      2,
      second.claim.claimGeneration,
    );
    assert.ok(row !== undefined);
    assert.equal(row.claimGeneration, second.claim.claimGeneration);
    assert.deepEqual(row.output.value, { ...OUTPUT_VALUE, eid: "10999999" });
    const fact = row.provenance.find((entry) => String(entry.path) === "eid");
    assert.equal(fact?.source, "operator");
    assert.equal(fact?.correctedAt, PATCH.correctedAt);
  });

  it("refuses a patch naming a node this run does not replay — a fresh read supersedes it", async () => {
    const descriptor = editDescriptor();
    const harness = executorHarness(descriptor);
    const { database } = harness.authority;

    database.authority.runs.enqueue(queuedRunFor(descriptor, undefined, 1, [PATCH]));
    const claimed = claim(database, descriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    const failureId = run?.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    assert.match(
      database.authority.failures.get(failureId)?.summary ?? "",
      /does not replay from a checkpoint/u,
    );
  });

  it("refuses an injected value the producing schema rejects at replay", async () => {
    const descriptor = editDescriptor();
    const harness = executorHarness(descriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(descriptor));
    const first = claim(database, descriptor);
    assert.equal((await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL })).state, "done");

    database.authority.runs.enqueue(
      queuedRunFor(descriptor, RUN2_ID, 2, [{ ...PATCH, value: "not-an-eid" }]),
    );
    const second = claim(database, descriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN2_ID);
    const failureId = run?.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    assert.match(
      database.authority.failures.get(failureId)?.summary ?? "",
      /injected correction for node "extract" was refused/u,
    );
  });
});
