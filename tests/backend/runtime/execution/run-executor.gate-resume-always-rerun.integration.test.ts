import { testWorkerPorts, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/backend/runs/commands/command-kernel.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { CrmReadOnboardingRecord } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { resolvePersonLookupIdentity } from "../../../../src/rules/matching/person-lookup.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { EidSchema,NodeIdSchema,TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,RUN_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
EXECUTOR_EID,
ManualScheduler,
happySessionHarness,
openAuthorityHarness,
recordingEmitter,
recordingLogger,
sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
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

  .step("live-status", ReadActiveStatus, {
    dependsOn: ["searching", "cross-verify"],
    replay: "always-rerun",
    bind: ({ outputs }) => ({
      input: PersonLookupInput.parse({ emplId: EXECUTOR_EID }),
      identity: resolvePersonLookupIdentity({ input: PersonLookupInput.parse({ emplId: EXECUTOR_EID }), person: outputs.searching }),
    }),
  })
  .gate("approval", {
    dependsOn: ["live-status"],
    label: "Identity approval",
    resolvedBy: "operator",
    result: ApprovalSchema,
  })

  .step("after-approval", CrmReadOnboardingRecord, {
    dependsOn: ["searching", "approval"],
    when: { kind: "is-present", of: { from: "node", nodeId: "approval", path: "approved" } },
    replay: "checkpoint",
    bind: ({ outputs }) => {
      const selected = outputs.searching.selection.selected;
      if (selected === null) throw new Error("fixture: searching resolved nobody");
      return { eid: selected.emplId, name: selected.name };
    },
  })
  .build({
    schema: z.strictObject({ hdh: z.boolean(), reReadState: z.string() }),

    dependsOn: ["live-status", "after-approval"],
    derive: ({ outputs }) => ({
      hdh: outputs["live-status"].state === "active",
      reReadState: outputs["after-approval"]?.state ?? "not-run",
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

async function harness(): Promise<Readonly<{
  database: AuthorityDatabase;
  clock: TestClock;
  now: () => string;
  emitter: ReturnType<typeof recordingEmitter>;
  deps: RunExecutorDependencies;
}>> {
  const authority = await openAuthorityHarness();
  testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: gateResumeDescriptor, poolIndex: 1 });
  disposers.push(authority.dispose);
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: gateResumeDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: await sessionManagerFor(happySessionHarness(), authority.clock),
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
      parsed: { protectedBindings: [],
        schemaHash: deriveSchemaHash(GateCanonicalInput, "output"),
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

/** The command service's resolve-gate arm, reduced to the rows it writes. */
function approve(database: AuthorityDatabase, version: number, now: string): void {
  const result = { schemaHash: deriveSchemaHash(ApprovalSchema, "output"), value: { approved: true } };
  database.authority.gateResults.insert({ nodeId: "approval",
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

describe("a gate resume re-executes an always-rerun node without colliding", () => {
  it("walks park → approve → resume to terminal done, storing BOTH executions", async () => {
    const h = await harness();
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
    const h = await harness();
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

    assert.deepEqual([...new Set(paths)], [
      taskSpanPath(trace, node, 1, first.claim.claimGeneration),
      taskSpanPath(trace, node, 1, second.claim.claimGeneration),
    ]);
  });

  it("resolves terminal evidence to the LATEST execution, and authority re-reads that exact row", async () => {
    const h = await harness();
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
