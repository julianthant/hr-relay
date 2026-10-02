import { seedSyntheticRuntimeConfig } from "../fixtures/operator-command-fixtures.js";
import { RunRecordService } from "../../src/backend/runs/run-record-service.js";
import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";
/**
 * D221 — a RETRY of a failed item re-executes its `always-rerun` nodes without
 * colliding with the run it retries.
 *
 * D214 closed the collision one ATTEMPT could hold (a gate park and its resume).
 * This is the same collision one level up, across RUNS of one item, and chunk 6c
 * found it live: `run`/`retry` minted a new run for the same logical item born at
 * attempt 1 and claim generation 1, so the retry's `always-rerun` node
 * re-executed against the ORIGINAL run's key and the immutable insert refused it:
 *
 *   run checkpoint separations\0…\0timecard-search\0 1 \0 1 already exists with
 *   different content
 *
 * Run `555ba4b4` died that way in 1.89 s retrying `12a5cd3e`, having replayed the
 * whole read chain from the first run's checkpoints — so a separations run that
 * failed at or after `timecard-search` could not be retried at all
 * (`docs/rebuild/migrations/separations.md` §9.17 item 8).
 *
 * This file is that exact shape as a fixture walk — a read → an `always-rerun`
 * node → a node that FAILS on the first run and succeeds on the retry — over the
 * REAL interpreter, the REAL authority database, the REAL command kernel's retry
 * arm and REAL task contracts. Every assertion is about durable rows and emitted
 * spans:
 *
 *   1. the retry reaches terminal `done`, and both executions of the
 *      `always-rerun` node are stored, distinct, and neither overwritten;
 *   2. cross-run replay still works — the `replay:"checkpoint"` ancestor replays
 *      the FAILED run's row and never re-opens its browser;
 *   3. terminal evidence cites the RETRY's execution, and `latest` agrees;
 *   4. the two runs' executions are distinguishable in the span stream;
 *   5. the pre-fix shape is refused at the door, and the immutable insert is
 *      still the backstop underneath it.
 *
 * It reproduces the live failure rather than describing it: with D221 reverted
 * (the retry minted at `attempt: 1`, the enqueue refusal removed) case 1 dies
 * exactly where `555ba4b4` did, verbatim —
 * `run checkpoint retry-attempt-fixture …\0live-probe\0 1 \0 1 already exists
 * with different content` — checked 2026-08-14 before this file was committed.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../src/base/workflow.js";
import { createCommandKernel } from "../../src/backend/runs/command-kernel.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/backend/runtime/run-executor.js";
import { taskSpanPath } from "../../src/backend/logs/span-emitter.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { CrmReadOnboardingRecord } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { EidSchema, NodeIdSchema, TraceIdSchema } from "../../src/domain/ids.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { checkpointLookupKey } from "../../src/domain/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import type { AuthorityDatabase } from "../../src/backend/storage/sqlite/index.js";
import { taskStoreRegistry } from "../../src/backend/app/task-registry.js";
import { HASH_A, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";
import {
  NO_INTAKE_PROJECTIONS,
  UNSTORED_CONFIG_IDENTITY,
  UNWIRED_INTAKE_PARSER,
} from "../fixtures/intake-kernel-seams.js";
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
} from "../helpers/phase1f-executor-harness.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
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
  /**
   * The `timecard-search` stand-in: a node whose product is BROWSER state, so
   * chunk 1's rule makes it `always-rerun` and it re-executes on every run of the
   * item by design (§5.3). This is the node the live retry died on.
   */
  .step("live-probe", SearchPersonOrg, {
    dependsOn: ["searching"],
    replay: "always-rerun",
    bind: ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }),
  })
  /**
   * The `clear-pending` stand-in: the node the first run FAILS at, which is what
   * makes the run retryable in the first place. It sits downstream of the
   * always-rerun node — the whole point of §9.17 item 8 is that a failure at or
   * after such a node made the item permanently unretryable.
   */
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
    // `live-probe` is a terminal dependency ON PURPOSE: D110/D114 evidence must
    // resolve the execution THIS run consumed, across two runs of one item.
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

/**
 * One CRM session factory that explodes on its FIRST open and is healthy on its
 * second: the first run fails at `cross-verify`, the retry gets through. UCPath
 * counts its searches so a replayed ancestor is provable rather than assumed.
 */
function harness(): Readonly<{
  database: AuthorityDatabase;
  now: () => string;
  emitter: ReturnType<typeof recordingEmitter>;
  deps: RunExecutorDependencies;
  ucpathOpens: () => number;
  kernel: ReturnType<typeof createCommandKernel>;
}> {
  const authority = openAuthorityHarness();
  seedSyntheticRuntimeConfig(authority.database);
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
    sessions: sessionManagerFor(sessions, authority.clock),
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
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
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
    workerRuntime: {
      planWorkerCount: unreachable("plan-worker-count"),
      spawnWorker: unreachable("spawn-worker"),
      refreshBrowser: unreachable("refresh-browser"),
      reopenBrowser: unreachable("reopen-browser"),
    },
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
      parsed: {
        schemaHash: deriveSchemaHash(RetryCanonicalInput, "output"),
        value: { emplId: EXECUTOR_EID },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

function claim(database: AuthorityDatabase, now: string) {
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
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
function failThenRetry(h: ReturnType<typeof harness>): Promise<Readonly<{
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

describe("D221 — a retry re-executes an always-rerun node without colliding", () => {
  it("walks fail → retry → terminal done, storing BOTH executions of the item", async () => {
    const h = harness();
    const { first, retried } = await failThenRetry(h);

    assert.equal(retried.envelope.retryOf, RUN_ID);
    assert.equal(first.envelope.attempt, 1);
    assert.equal(retried.envelope.attempt, 2, "a retry takes the ITEM's next attempt");
    assert.equal(retried.envelope.itemId, first.envelope.itemId, "and it is the SAME logical item");

    // The failed run's always-rerun row, captured byte for byte BEFORE the
    // retry runs: nothing may rewrite it (D144/D199).
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
    // Same claim generation on both — which is exactly why D214's component
    // could not tell these two apart, and why the attempt had to become the
    // item's. The pre-fix key `(item, node, 1, 1)` still names the FIRST row.
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
    // `latest` agrees — `attempt DESC, claim_generation DESC` is a real order
    // now, where two runs at attempt 1 were a tie SQLite broke arbitrarily.
    const latest = h.database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, "live-probe");
    assert.equal(latest?.attempt, 2);
    assert.equal(latest?.runId, retried.envelope.runId);
  });

  it("makes the two runs' executions distinguishable in the span stream", async () => {
    const h = harness();
    const { first, retried } = await failThenRetry(h);
    const second = claim(h.database, h.now());
    assert.equal((await executeClaimedRun(h.deps, { ...second, signal: SIGNAL })).state, "done");

    const node = NodeIdSchema.parse("live-probe");
    const paths = [...new Set(h.emitter.events()
      .filter((event) => event.spanPath.includes("/live-probe#"))
      .map((event) => event.spanPath))];
    /*
     * D123 one level up: the projector folds by `(runId, attempt, spanPath)`.
     * Two runs of one item already differ in every one of those — a span path is
     * rooted in the run's OWN trace id — and the attempt now differs too, so no
     * surface can report a retry as another attempt 1.
     */
    assert.deepEqual(paths, [
      taskSpanPath(TraceIdSchema.parse(first.envelope.traceId), node, 1, 1),
      taskSpanPath(TraceIdSchema.parse(retried.envelope.traceId), node, 1, 1),
    ]);
    assert.notEqual(first.envelope.traceId, retried.envelope.traceId);
  });

  it("refuses the PRE-FIX shape at the door, with the immutable insert still underneath", async () => {
    const h = harness();
    const { first, retried } = await failThenRetry(h);
    const itemId = first.envelope.itemId;

    /*
     * The pre-fix shape, stated exactly: a second run of this item born at the
     * attempt the item already spent. Authority refuses it at the insert —
     * before a worker, a browser, or a checkpoint — naming the item and the
     * attempt.
     */
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

    /*
     * And the backstop the live run actually hit is still there: a row that
     * names an execution some other row already owns is refused by content, not
     * folded. This is §9.17's verbatim message, reproduced through the same
     * repository — which is what a pre-fix retry ran into on its first
     * `always-rerun` node.
     */
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
    // D133 read-forward: the key that row was written under is unchanged by
    // this decision — the key SHAPE never moved, so nothing stored had to.
    assert.equal(
      checkpointLookupKey(WORKFLOW_ID, itemId, "live-probe", 1, 1),
      [WORKFLOW_ID, itemId, "live-probe", "1", "1"].join("\u0000"),
    );
  });
});
