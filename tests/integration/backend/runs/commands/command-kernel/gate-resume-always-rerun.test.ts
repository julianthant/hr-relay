import { testRunLifecycle } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
/**
 * D214 — a run ATTEMPT is not one execution of its graph, and the composed
 * separations graph is the proof: chunk 6b's run `00419600` read thirteen nodes
 * live, parked at the ALWAYS-GATE, took a real approval, resumed, and then died
 * one node later with
 *
 *   run checkpoint separations 2ebcfbf7… timecard-search 1 already exists with
 *   different content
 *
 * because a gate resume advances no attempt, `timecard-search` is `always-rerun`
 * by chunk 1's rule, and the checkpoint key was `(workflow, item, node,
 * attempt)`. The sibling run `6a6c6f44` only survived by accident: a killed
 * worker bumped the attempt, so its re-execution landed under a key nothing
 * owned. A crash is not a recovery path.
 *
 * This file is that exact shape as a fixture walk — read → read → an
 * `always-rerun` node → a gate → a node downstream of the gate — over the REAL
 * interpreter, the REAL authority database and REAL task contracts. Every
 * assertion is about durable rows and emitted spans, never about a log line:
 *
 *   1. the gate resume passes on the NORMAL path, with no crash and no attempt
 *      bump, and both executions of the always-rerun node are stored;
 *   2. the two executions are distinguishable in the span stream;
 *   3. terminal evidence cites the LATEST execution, and authority re-reads that
 *      exact row before it will settle the run;
 *   4. a node that did NOT re-run keeps replaying its single stored checkpoint.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../../../src/backend/runtime/execution/run-executor.js";
import { taskSpanPath } from "../../../../../../src/backend/logs/span-emitter.js";
import { CrmReadOnboardingRecord } from "../../../../../../src/models/systems/crm/read-onboarding-record.js";
import { ReadActiveStatus } from "../../../../../../src/models/workflows/person-lookup/read-active-status.js";
import { SearchPersonOrg } from "../../../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema, NodeIdSchema, TraceIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import type { TestClock } from "../../../../../../src/rules/time/clock.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../src/models/workflow/presentation.js";
import type { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/index.js";
import { taskStoreRegistry } from "../../../../../../src/backend/app/registries/task-registry.js";
import { HASH_A, UUID_7 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  EXECUTOR_EID,
  ManualScheduler,
  happySessionHarness,
  openAuthorityHarness,
  recordingEmitter,
  recordingLogger,
  sessionManagerFor,
} from "../../../../../support/helpers/phase1f-executor-harness.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;
const WORKFLOW_ID = "gate-resume-fixture";

/* ── the 6b shape: reads → always-rerun → GATE → a node past the gate ────── */

const GateInput = z.strictObject({ emplId: EidSchema });
const GateCanonicalInput = defineCanonicalInput(
  GateInput,
  z.strictObject({ emplId: EidSchema }),
  [{ emplId: EXECUTOR_EID }],
);
const ApprovalSchema = z.strictObject({ approved: z.boolean() });

const gateResumeFlow = flow(GateInput)
  .step("searching", SearchPersonOrg, {
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }),
  })
  .step("cross-verify", CrmReadOnboardingRecord, {
    dependsOn: ["searching"],
    replay: "checkpoint",
    bind: ({ outputs }) => {
      const selected = outputs.searching.selection.selected;
      if (selected === null) throw new Error("fixture: searching resolved nobody");
      return { eid: selected.emplId, name: selected.name };
    },
  })
  /**
   * The `timecard-search` stand-in. Chunk 1's rule — a node whose product is
   * BROWSER state may not be `replay:"checkpoint"` — is what puts an
   * `always-rerun` node upstream of the gate in the first place.
   */
  .step("live-status", ReadActiveStatus, {
    dependsOn: ["searching", "cross-verify"],
    replay: "always-rerun",
    bind: ({ outputs }) => ({
      person: outputs.searching,
      crm: outputs["cross-verify"],
      keepNonHdh: false,
    }),
  })
  .gate("approval", {
    dependsOn: ["live-status"],
    label: "Identity approval",
    resolvedBy: "operator",
    result: ApprovalSchema,
  })
  /**
   * The `clear-pending` stand-in: a node the resume must actually REACH. Without
   * one the gate would be the last node, `resumeAt` would fold back onto the
   * gate itself, and the walk would never exercise a replayed gate result.
   */
  .step("after-approval", CrmReadOnboardingRecord, {
    dependsOn: ["searching", "approval"],
    replay: "checkpoint",
    bind: ({ outputs }) => {
      const selected = outputs.searching.selection.selected;
      if (selected === null) throw new Error("fixture: searching resolved nobody");
      return { eid: selected.emplId, name: selected.name };
    },
  })
  .build({
    schema: z.strictObject({ hdh: z.boolean(), reReadState: z.string() }),
    // `live-status` is a terminal dependency ON PURPOSE: D110/D114 evidence must
    // resolve the LATEST execution of a node that ran twice. (A GATE is not a
    // terminal dependency — it owns no checkpoint, which is D203's whole point —
    // so the post-gate READ carries the approved half of the result.)
    dependsOn: ["live-status", "after-approval"],
    derive: ({ outputs }) => ({
      hdh: outputs["live-status"].state === "active",
      reReadState: outputs["after-approval"].state,
    }),
  });

const gateResumeDescriptor = defineWorkflowDescriptor({
  id: WORKFLOW_ID,
  version: 1,
  contractFingerprint: HASH_A,
  code: "gr",
  label: "Gate resume fixture",
  icon: "Search",
  category: "operations",
  canonicalInput: GateCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input: z.output<typeof GateInput>) => `eid:${input.emplId}` },
  presentation: { title: (input: z.output<typeof GateInput>) => input.emplId },
  scenarios: [`${WORKFLOW_ID}/happy`],
  flow: gateResumeFlow,
});

/* ── harness ─────────────────────────────────────────────────────────────── */

function harness(): Readonly<{
  database: AuthorityDatabase;
  clock: TestClock;
  now: () => string;
  emitter: ReturnType<typeof recordingEmitter>;
  deps: RunExecutorDependencies;
}> {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: gateResumeDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: sessionManagerFor(happySessionHarness(), authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("e"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
  return {
    database: authority.database,
    clock: authority.clock,
    now: () => authority.clock.now().toISOString(),
    emitter,
    deps,
  };
}

function queuedRun() {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: WORKFLOW_ID,
      traceId: TraceIdSchema.parse("gr-090000-1111"),
      contractFingerprint: gateResumeDescriptor.contractFingerprint,
      descriptorVersion: gateResumeDescriptor.version,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
    },
    input: {
      raw: { emplId: EXECUTOR_EID },
      parsed: {
        schemaHash: deriveSchemaHash(GateCanonicalInput, "output"),
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

/** The command service's resolve-gate arm, reduced to the rows it writes. */
function approve(database: AuthorityDatabase, version: number, now: string): void {
  const result = { schemaHash: deriveSchemaHash(ApprovalSchema, "output"), value: { approved: true } };
  database.authority.gateResults.insert({
    runId: RUN_ID,
    gateId: "approval",
    commandId: UUID_7,
    expectedVersion: version,
    resolvedBy: "local-operator",
    resolvedAt: now,
    checkpointFingerprint: deriveGateResultCheckpointFingerprint(result),
    result,
  });
}

describe("D214 — a gate resume re-executes an always-rerun node without colliding", () => {
  it("walks park → approve → resume to terminal done, storing BOTH executions", async () => {
    const h = harness();
    h.database.authority.runs.enqueue(queuedRun());

    /* ── first claim: the read chain, then the park ───────────────────────── */
    const first = claim(h.database, h.now());
    const parked = await executeClaimedRun(h.deps, { ...first, signal: SIGNAL });
    assert.deepEqual(parked, { state: "parked-gate", runId: RUN_ID, gateId: "approval" });

    const parkedRun = h.database.authority.runs.get(RUN_ID);
    assert.ok(parkedRun && parkedRun.lifecycle.state === "parked-gate");
    const resumeAt = parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : undefined;
    assert.equal(resumeAt, "after-approval", "the resume starts at the node AFTER the gate");

    /* ── the real approval, then the resume ───────────────────────────────── */
    approve(h.database, parkedRun.version, h.now());
    const resumed = h.database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parkedRun.version,
      startAt: resumeAt,
      now: h.now(),
    });
    assert.equal(resumed.state, "applied");

    /*
     * Time passes while a run sits parked — that is the whole point of a gate —
     * so the re-execution's observation is genuinely DIFFERENT bytes, exactly as
     * a real second read of a live page is. Without this the two rows would be
     * byte-identical and the immutable insert would fold them into one, which
     * would make this test pass for a reason that has nothing to do with the
     * defect.
     */
    h.clock.advanceWall(90_000);
    const second = claim(h.database, h.now());
    // The attempt did NOT move — this is the same attempt, re-claimed. That is
    // exactly the condition run 00419600 died under.
    assert.equal(second.run.envelope.attempt, first.run.envelope.attempt);
    assert.equal(second.claim.claimGeneration, first.claim.claimGeneration + 1);

    const outcome = await executeClaimedRun(h.deps, { ...second, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });

    /* ── both executions are durable, and they are DIFFERENT rows ─────────── */
    const executions = h.database.authority.runCheckpoints.listByAttempt(
      WORKFLOW_ID,
      second.run.envelope.itemId,
      "live-status",
      second.run.envelope.attempt,
    );
    assert.equal(executions.length, 2, "an always-rerun node ran once per claim, and both rows are stored");
    assert.deepEqual(
      executions.map((record) => record.claimGeneration),
      [first.claim.claimGeneration, second.claim.claimGeneration],
    );
    /*
     * And they are genuinely different bytes — which is what made the old key a
     * REFUSAL rather than a harmless duplicate. Nothing was overwritten: the
     * parked execution's row still says exactly what it said (D144/D199).
     */
    assert.notEqual(executions[0]?.writtenAt, executions[1]?.writtenAt);
    assert.equal(executions[0]?.runId, RUN_ID);
    assert.equal(executions[1]?.runId, RUN_ID);

    /* ── the node that did NOT re-run has exactly ONE row, replayed ───────── */
    const searching = h.database.authority.runCheckpoints.listByAttempt(
      WORKFLOW_ID,
      second.run.envelope.itemId,
      "searching",
      second.run.envelope.attempt,
    );
    assert.equal(searching.length, 1, "a replay:checkpoint node replays; it does not write a second row");
  });

  it("makes the two executions distinguishable in the span stream", async () => {
    const h = harness();
    h.database.authority.runs.enqueue(queuedRun());
    const first = claim(h.database, h.now());
    await executeClaimedRun(h.deps, { ...first, signal: SIGNAL });
    const parkedRun = h.database.authority.runs.get(RUN_ID);
    assert.ok(parkedRun && parkedRun.lifecycle.state === "parked-gate");
    approve(h.database, parkedRun.version, h.now());
    h.database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parkedRun.version,
      startAt: parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : "after-approval",
      now: h.now(),
    });
    h.clock.advanceWall(90_000);
    const second = claim(h.database, h.now());
    await executeClaimedRun(h.deps, { ...second, signal: SIGNAL });

    const trace = TraceIdSchema.parse(second.run.envelope.traceId);
    const node = NodeIdSchema.parse("live-status");
    const paths = h.emitter.events()
      .filter((event) => event.spanPath.includes("/live-status#"))
      .map((event) => event.spanPath);
    /*
     * D123's lesson one level in: the projector folds by `(runId, attempt,
     * spanPath)` and the timeline seeds React by the same triple, so two
     * executions that share a span path are one row on every surface. Before
     * D214 both of these read `…/live-status#1`.
     */
    assert.deepEqual([...new Set(paths)], [
      taskSpanPath(trace, node, 1, first.claim.claimGeneration),
      taskSpanPath(trace, node, 1, second.claim.claimGeneration),
    ]);
  });

  it("resolves terminal evidence to the LATEST execution, and authority re-reads that exact row", async () => {
    const h = harness();
    h.database.authority.runs.enqueue(queuedRun());
    const first = claim(h.database, h.now());
    await executeClaimedRun(h.deps, { ...first, signal: SIGNAL });
    const parkedRun = h.database.authority.runs.get(RUN_ID);
    assert.ok(parkedRun && parkedRun.lifecycle.state === "parked-gate");
    approve(h.database, parkedRun.version, h.now());
    h.database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parkedRun.version,
      startAt: parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : "after-approval",
      now: h.now(),
    });
    h.clock.advanceWall(90_000);
    const second = claim(h.database, h.now());
    assert.equal((await executeClaimedRun(h.deps, { ...second, signal: SIGNAL })).state, "done");

    const result = h.database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    const dependency = result.dependencies.find(({ nodeId }) => nodeId === "live-status");
    assert.ok(dependency?.state === "resolved");
    assert.equal(
      dependency.checkpoint.claimGeneration,
      second.claim.claimGeneration,
      "the terminal record cites the execution this run actually consumed, not the parked one",
    );
    // `#assertStoredTerminalDependencies` already re-read that exact key inside
    // the settling transaction — the run could not have reached `done` otherwise
    // — and `latest` agrees with it.
    const latest = h.database.authority.runCheckpoints.latest(
      WORKFLOW_ID,
      second.run.envelope.itemId,
      "live-status",
    );
    assert.equal(latest?.claimGeneration, second.claim.claimGeneration);
    assert.equal(
      h.database.authority.runCheckpoints.get(
        WORKFLOW_ID,
        second.run.envelope.itemId,
        "live-status",
        second.run.envelope.attempt,
        dependency.checkpoint.claimGeneration,
      )?.claimGeneration,
      second.claim.claimGeneration,
    );
  });
});
