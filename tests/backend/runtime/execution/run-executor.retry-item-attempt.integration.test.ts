import { testWorkerPorts, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { CrmReadOnboardingRecord } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { checkpointLookupKey } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema,NodeIdSchema,TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import {
NO_INTAKE_PROJECTIONS,
UNSTORED_CONFIG_IDENTITY,
UNWIRED_INTAKE_PARSER,
} from "../../../support/fixtures/intake-kernel-seams.js";
import { HASH_A,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,RUN_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
EXECUTOR_EID,
ManualScheduler,
healthyCrmDriver,
healthyUcpathDriver,
openAuthorityHarness,
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const SIGNAL = new AbortController().signal;
const WORKFLOW_ID = "retry-attempt-fixture";

/* ── the 6c shape: a read → an always-rerun node → a node that fails once ─── */

const RetryInput = z.strictObject({ emplId: EidSchema });
const RetryCanonicalInput = defineCanonicalInput(
  RetryInput,
  z.strictObject({ emplId: EidSchema }),
  [{ emplId: EXECUTOR_EID }],
);

const retryFlow = flow(RetryInput)
  .step("searching", SearchPersonOrg, {
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }),
  })
  // Browser-state nodes always rerun; their outputs cannot be replay checkpoints.
  .step("live-probe", SearchPersonOrg, {
    dependsOn: ["searching"],
    replay: "always-rerun",
    bind: ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }),
  })

  .step("cross-verify", CrmReadOnboardingRecord, {
    dependsOn: ["searching", "live-probe"],
    replay: "checkpoint",
    bind: ({ outputs }) => {
      const selected = outputs.searching.selection.selected;
      if (selected === null) throw new Error("fixture: searching resolved nobody");
      return { eid: selected.emplId, name: selected.name };
    },
  })
  .build({
    schema: z.strictObject({ probed: z.boolean(), crmState: z.string() }),
    // Retain the probe as a terminal dependency so evidence resolves the execution consumed by this run.
    dependsOn: ["live-probe", "cross-verify"],
    derive: ({ outputs }) => ({
      probed: outputs["live-probe"].selection.selected !== null,
      crmState: outputs["cross-verify"].state,
    }),
  });

const retryDescriptor = defineWorkflowDescriptor({
  id: WORKFLOW_ID,
  version: 1,
  contractFingerprint: HASH_A,
  code: "ra",
  label: "Retry attempt fixture",
  icon: "Search",
  category: "operations",
  canonicalInput: RetryCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input: z.output<typeof RetryInput>) => `eid:${input.emplId}` },
  presentation: { title: (input: z.output<typeof RetryInput>) => input.emplId },
  scenarios: [`${WORKFLOW_ID}/happy`],
  flow: retryFlow,
});

/* ── harness ─────────────────────────────────────────────────────────────── */

function unreachable(arm: string): () => never {
  return () => {
    throw new Error(`fixture: command arm ${arm} is not reachable from a retry`);
  };
}


async function harness(): Promise<Readonly<{
  database: AuthorityDatabase;
  now: () => string;
  emitter: ReturnType<typeof recordingEmitter>;
  deps: RunExecutorDependencies;
  ucpathOpens: () => number;
  kernel: ReturnType<typeof createCommandKernel>;
}>> {
  const authority = await openAuthorityHarness();
  testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: retryDescriptor, poolIndex: 1 });
  disposers.push(authority.dispose);
  const sessions = sessionFactoryHarness({
    ucpath: () => healthyUcpathDriver(),
    crm: (openIndex) => (openIndex === 1
      ? Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: (): Promise<never> => Promise.reject(new Error("CRM exploded")),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      })
      : healthyCrmDriver()),
  });
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: retryDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: await sessionManagerFor(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("e"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: authority.database, clock: authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => authority.database.withAuthorityTransaction(work),
    },
    clock: authority.clock,
    ids: sequentialIdFactory("d"),
    descriptors: {
      resolve: (workflowId) => (workflowId === WORKFLOW_ID ? retryDescriptor : undefined),
    },
    // Neither seam is reachable from a retry; both refuse loudly rather than
    // standing in as a no-op that a mis-routed command could pass through.
    writeResolution: {
      resolvePresent: unreachable("resolve-write-present"),
      resolveAbsent: unreachable("resolve-write-absent"),
    },
    workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker command"); }, spawnPoolWorker: () => { throw new Error("unexpected worker command"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker command"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker command"); }, stopPoolWorker: () => { throw new Error("unexpected worker command"); }, pausePoolWorker: () => { throw new Error("unexpected worker command"); }, resumePoolWorker: () => { throw new Error("unexpected worker command"); } } },
  });
  return {
    database: authority.database,
    now: () => authority.clock.now().toISOString(),
    emitter,
    deps,
    ucpathOpens: () => sessions.opens("ucpath"),
    kernel,
  };
}

function queuedRun() {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: WORKFLOW_ID,
      traceId: TraceIdSchema.parse("ra-090000-1111"),
      contractFingerprint: retryDescriptor.contractFingerprint,
      descriptorVersion: retryDescriptor.version,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
    },
    input: {
      raw: { emplId: EXECUTOR_EID },
      parsed: { protectedBindings: [],
        schemaHash: deriveSchemaHash(RetryCanonicalInput, "output"),
        value: { emplId: EXECUTOR_EID },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

function claim(database: AuthorityDatabase, now: string) {
  const { workerId, workerLifetime } = testWorkerLifetime(database, WORKFLOW_ID, 1);
  const claimed = database.authority.runs.claimNext({ workerLifetime, workflow: WORKFLOW_ID, workerId, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId, claimGeneration: claimed.run.claimGeneration },
  };
}

let commandSequence = 0;
function retryCommand(runId: string, expectedVersion: number) {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return {
    commandId: `cccccccc-${tail}-4000-8000-${tail}00000000`,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type: "retry",
    target: { runId, expectedVersion },
  };
}

/** Run the whole failing first run, then take the REAL retry command. */
function failThenRetry(h: Awaited<ReturnType<typeof harness>>): Promise<Readonly<{
  first: RunRecord;
  retried: RunRecord;
}>> {
  return (async () => {
    h.database.authority.runs.enqueue(queuedRun());
    const claimed = claim(h.database, h.now());
    const failed = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
    assert.equal(failed.state, "failed", "the first run must fail at cross-verify");
    const first = h.database.authority.runs.get(RUN_ID);
    assert.ok(first !== undefined && first.lifecycle.state === "terminal");

    const applied = h.kernel.execute(retryCommand(RUN_ID, first.version));
    assert.equal(applied.state, "applied", applied.state === "rejected" ? applied.message : "refused");
    if (applied.state !== "applied") throw new Error("unreachable");
    const target = applied.affectedTargets.find(
      (candidate) => candidate.family === "run" && candidate.runId !== RUN_ID,
    );
    if (target?.family !== "run") throw new Error("the retry reported no new run");
    const retried = h.database.authority.runs.get(target.runId);
    assert.ok(retried !== undefined);
    return { first, retried };
  })();
}

describe("a retry re-executes an always-rerun node without colliding", () => {
  it("walks fail → retry → terminal done, storing BOTH executions of the item", async () => {
    const h = await harness();
    const { first, retried } = await failThenRetry(h);

    assert.equal(retried.envelope.retryOf, RUN_ID);
    assert.equal(first.envelope.attempt, 1);
    assert.equal(retried.envelope.attempt, 2, "a retry takes the ITEM's next attempt");
    assert.equal(retried.envelope.itemId, first.envelope.itemId, "and it is the SAME logical item");


    const itemId = first.envelope.itemId;
    const beforeRetry = h.database.authority.runCheckpoints.get(WORKFLOW_ID, itemId, "live-probe", 1, 1);
    assert.ok(beforeRetry !== undefined, "the failed run stored its always-rerun execution");
    const beforeBytes = canonicalJsonStringify(beforeRetry);

    const ucpathOpensAfterFirst = h.ucpathOpens();
    const second = claim(h.database, h.now());
    assert.equal(second.run.envelope.runId, retried.envelope.runId);
    const outcome = await executeClaimedRun(h.deps, { ...second, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: retried.envelope.runId });

    /* ── both executions are durable, and they are DIFFERENT rows ─────────── */
    const executions = h.database.authority.runCheckpoints
      .listByItem(WORKFLOW_ID, itemId)
      .filter((record) => record.nodeId === "live-probe");
    assert.equal(executions.length, 2, "the always-rerun node ran once per run, and both rows are stored");
    assert.deepEqual(
      executions.map((record) => [record.attempt, record.claimGeneration, record.runId]),
      [[1, 1, RUN_ID], [2, 1, retried.envelope.runId]],
    );

    assert.equal(
      canonicalJsonStringify(h.database.authority.runCheckpoints.get(WORKFLOW_ID, itemId, "live-probe", 1, 1)),
      beforeBytes,
      "the failed run's execution is untouched by the retry",
    );

    /* ── cross-run replay still works, and is what makes a retry cheap ────── */
    const searching = h.database.authority.runCheckpoints
      .listByItem(WORKFLOW_ID, itemId)
      .filter((record) => record.nodeId === "searching");
    assert.equal(searching.length, 1, "the checkpoint ancestor replayed; it did not write a second row");
    assert.equal(searching[0]?.runId, RUN_ID, "and the row it replayed is the FAILED run's");
    assert.equal(
      h.ucpathOpens(),
      ucpathOpensAfterFirst,
      "a replayed ancestor opens no browser — that is the point of an item-scoped checkpoint",
    );

    /* ── terminal evidence cites the RETRY's execution ────────────────────── */
    const result = h.database.authority.runResults.get(retried.envelope.runId);
    assert.ok(result);
    const dependency = result.dependencies.find(({ nodeId }) => nodeId === "live-probe");
    assert.ok(dependency?.state === "resolved");
    assert.equal(dependency.checkpoint.attempt, 2);
    assert.equal(dependency.checkpoint.runId, retried.envelope.runId);

    const latest = h.database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, "live-probe");
    assert.equal(latest?.attempt, 2);
    assert.equal(latest?.runId, retried.envelope.runId);
  });

  it("makes the two runs' executions distinguishable in the span stream", async () => {
    const h = await harness();
    const { first, retried } = await failThenRetry(h);
    const second = claim(h.database, h.now());
    assert.equal((await executeClaimedRun(h.deps, { ...second, signal: SIGNAL })).state, "done");

    const node = NodeIdSchema.parse("live-probe");
    const paths = [...new Set(h.emitter.events()
      .filter((event) => event.spanPath.includes("/live-probe#"))
      .map((event) => event.spanPath))];

    assert.deepEqual(paths, [
      taskSpanPath(TraceIdSchema.parse(first.envelope.traceId), node, 1, 1),
      taskSpanPath(TraceIdSchema.parse(retried.envelope.traceId), node, 1, 1),
    ]);
    assert.notEqual(first.envelope.traceId, retried.envelope.traceId);
  });

  it("refuses the PRE-FIX shape at the door, with the immutable insert still underneath", async () => {
    const h = await harness();
    const { first, retried } = await failThenRetry(h);
    const itemId = first.envelope.itemId;


    assert.throws(
      () => h.database.authority.runs.enqueue({
        ...queuedRun(),
        envelope: {
          ...queuedRun().envelope,
          runId: "bbbbbbbb-0009-4000-8000-000900000000",
          traceId: TraceIdSchema.parse("ra-090001-2222"),
          attempt: 1,
        },
      }),
      /at attempt 1, which that item has already spent/,
    );
    // A gap is not a collision, so it is allowed and never fabricated.
    assert.equal(
      h.database.authority.runs.nextItemAttempt({ workflow: WORKFLOW_ID, itemId }),
      3,
      "the item has spent attempts 1 and 2",
    );


    const stored = h.database.authority.runCheckpoints.get(WORKFLOW_ID, itemId, "live-probe", 1, 1);
    assert.ok(stored !== undefined);
    assert.throws(
      () => h.database.authority.runCheckpoints.insert({
        ...stored,
        runId: retried.envelope.runId,
        writtenAt: "2026-08-14T18:00:00.000Z",
      }),
      /already exists with different content/,
    );

    assert.equal(
      checkpointLookupKey(WORKFLOW_ID, itemId, "live-probe", 1, 1),
      [WORKFLOW_ID, itemId, "live-probe", "1", "1"].join("\u0000"),
    );
  });
});
