import { testWorkerPorts, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import {
CheckpointPatchSchema
} from "../../../../src/models/workflow/checkpoint.js";
import {
STANDARD_WORKFLOW_ACTIONS,
WorkflowCapabilitiesSchema,
} from "../../../../src/models/workflow/presentation.js";
import { ScenarioIdSchema,TraceIdSchema,taskId } from "../../../../src/rules/identity/ids.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineServiceStore,defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
QUEUED_RUN,
RUN_ID,
sequentialIdFactory,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
ManualScheduler,
happySessionHarness,
openAuthorityHarness,
recordingEmitter,
recordingLogger,
sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";
import type { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
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

/* ── 2. the kernel save ──────────────────────────────────────────────────── */

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
      parsed: { protectedBindings: [],
        schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie" },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

/* ── 3. the executor consume ─────────────────────────────────────────────── */

async function executorHarness(descriptor: AnyWorkflowDescriptor) {
  const authority = await openAuthorityHarness();
  testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: descriptor, poolIndex: 1 });
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
    sessions: await sessionManagerFor(sessions, authority.clock),
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
  const { workerId, workerLifetime } = testWorkerLifetime(database, descriptor.id, 1);
  const claimed = database.authority.runs.claimNext({
    workerLifetime, workflow: descriptor.id,
    workerId,
    now: new Date("2026-08-03T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId, claimGeneration: claimed.run.claimGeneration } };
}

describe("executor consume — injected corrections at replay", () => {
  it("applies the patch to the replayed checkpoint and lands the corrected row at the resuming attempt", async () => {
    const descriptor = editDescriptor();
    const harness = await executorHarness(descriptor);
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
    const harness = await executorHarness(descriptor);
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
    const harness = await executorHarness(descriptor);
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
