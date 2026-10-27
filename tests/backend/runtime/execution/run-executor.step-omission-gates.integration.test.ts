import { testWorkerPorts, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createOmissionDefinitionFixtures } from "../../../support/helpers/workflow/omission-definition-fixtures.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";

import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { StartStepOmissionRefusedError,resolveStartStepOmissions } from "../../../../src/backend/runs/start/step-selection.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";

import { CrmReadOnboardingRecord } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";


import { type StepOmissionDeclaration } from "../../../../src/models/workflow/step-omission.js";



import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { compileFixtureWorkflow } from "../../../support/fixtures/workflow-definition-fixtures.js";
import {
ManualScheduler,
healthyCrmDriver,
healthyUcpathDriver,
openAuthorityHarness,
personLookupQueuedRun,
recordingLogger,
recordingTimelineEmitter,
sessionFactoryHarness,
sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const SIGNAL = new AbortController().signal;

const { ReviewResultSchema, FixtureResultSchema, VERIFY_OMISSION, fixture, gateInsideOmittableStep } = createOmissionDefinitionFixtures();

describe("definition-time omission completeness", () => {
  it("refuses an omittable step whose gate is read from outside the step, naming the mandatory-verifier rule", () => {
    assert.throws(() => fixture("omission-gate-read-outside", "dgr", ({ task, gate, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const review = gate({ id: "review", label: "Review", result: ReviewResultSchema }, [search]);
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      // `after` sits OUTSIDE the omittable step and reads its gate.
      const after = task({ id: "after", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [review], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { omission: VERIFY_OMISSION }), [review, verify]],
          [{ key: "after", label: "After" }, [after]],
        ],
        result: result(FixtureResultSchema, [after], ({ outputs }) => ({ verified: outputs.after.state === "found" })),
      };
    }), /step "deciding" is omittable, but workflow entry "after" in step "after" reads its gate entry "review", which omitting the step leaves unread; .*declare the check as its own entry outside the omitted step/u);
  });

  it("refuses an omittable step whose unproduced task is read from outside, and a producer naming a non-member or a gate", () => {
    const unproduced: StepOmissionDeclaration = { form: { fields: [] }, produces: {} };
    assert.throws(() => fixture("omission-task-read-outside", "dtr", ({ task, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      const after = task({ id: "after", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [verify], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { omission: unproduced }), [verify]],
          [{ key: "after", label: "After" }, [after]],
        ],
        result: result(FixtureResultSchema, [after], ({ outputs }) => ({ verified: outputs.after.state === "found" })),
      };
    }), /reads its task entry "verify", which omitting the step leaves unread; rebuild "verify" from the step's omission form/u);

    const foreignProducer: StepOmissionDeclaration = { form: { fields: [] }, produces: { search: () => ({}) } };
    assert.throws(() => fixture("omission-foreign-producer", "dfp", ({ task, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { omission: foreignProducer }), [verify]],
        ],
        result: result(FixtureResultSchema, [verify], ({ outputs }) => ({ verified: outputs.verify.state === "found" })),
      };
    }), /step "deciding" omission produces "search", which is not an entry of that step/u);

    const gateProducer: StepOmissionDeclaration = { form: { fields: [] }, produces: { review: () => ({ approved: true }) } };
    assert.throws(() => fixture("omission-gate-producer", "dgp", ({ task, gate, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const review = gate({ id: "review", label: "Review", result: ReviewResultSchema }, [search]);
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { omission: gateProducer }), [review]],
        ],
        result: result(FixtureResultSchema, [search], ({ outputs }) => ({ verified: outputs.search.selection.selected !== null })),
      };
    }), /omission produces "review", which is a gate entry; only task entries are ever rebuilt from operator facts/u);
  });
});

describe("the executor runs no entry of an omitted step and never asks for values", () => {
  const compiled = compileFixtureWorkflow(gateInsideOmittableStep);
  const { descriptor } = compiled;

  function queuedRun(stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.workflow = String(descriptor.id);
    envelope.traceId = `${descriptor.code}-170000-4444`;
    envelope.contractFingerprint = descriptor.contractFingerprint;
    envelope.descriptorVersion = descriptor.version;
    if (stepOmissions !== undefined) envelope.stepOmissions = stepOmissions;
    const input = run.input as { raw: unknown; parsed: Record<string, unknown> };
    input.raw = { emplId: "10873698", expectedName: "Fixture, Person" };
    input.parsed.schemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
    input.parsed.value = { emplId: "10873698", expectedName: "Fixture, Person" };
    return run;
  }

  async function harness() {
    const authority = await openAuthorityHarness();
    testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: descriptor, poolIndex: 1 });
    disposers.push(authority.dispose);
    const sessions = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver(), crm: () => healthyCrmDriver() });
    const emitter = recordingTimelineEmitter(authority.database, authority.clock);
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(authority.database, authority.clock),
      descriptor,
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
    return { authority, sessions, emitter, deps };
  }

  function claim(harnessed: Awaited<ReturnType<typeof harness>>) {
    const { workerId, workerLifetime } = testWorkerLifetime(harnessed.authority.database, descriptor.id, 1);
    const claimed = harnessed.authority.database.authority.runs.claimNext({
      workerLifetime, workflow: descriptor.id,
      workerId: workerId,
      now: harnessed.authority.clock.now().toISOString(),
    });
    if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
    return { run: claimed.run, claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration }, signal: SIGNAL };
  }

  it("omits the gate with its step: no gate.opened span, no gate_results row, no park, the read is asserted with operator provenance", async () => {
    const h = await harness();
    h.authority.database.authority.runs.enqueue(queuedRun([{ step: "deciding", facts: { verifiedByHand: true } }]));
    const claimed = claim(h);
    const outcome = await executeClaimedRun(h.deps, claimed);
    assert.equal(outcome.state, "done");
    assert.equal(h.sessions.opens("crm"), 0, "the omitted read opens no CRM session");
    assert.equal(h.sessions.opens("ucpath"), 1);
    assert.deepEqual(h.authority.database.authority.gateResults.listByRun(claimed.run.envelope.runId), []);
    const events = h.emitter.events();
    assert.ok(!events.some((event) => event.t === "gate.opened"), "an omitted gate never opens");
    const gateSpan = events.find((event) => event.t === "span.ended" && event.spanPath.includes("/review#"));
    assert.ok(gateSpan !== undefined && gateSpan.t === "span.ended" && gateSpan.outcome === "skipped");
    assert.ok("notRunReason" in gateSpan && gateSpan.notRunReason === "step-omitted");
    const verify = h.authority.database.authority.runCheckpoints.latest(descriptor.id, claimed.run.envelope.itemId, "verify");
    assert.ok(verify !== undefined);
    assert.equal(verify.assertion?.step, "deciding");
    assert.ok(verify.provenance.every((leaf) => leaf.source === "operator"));
    const result = h.authority.database.authority.runResults.get(claimed.run.envelope.runId);
    assert.ok(result);
    assert.equal(result.dependencies.find((dependency) => dependency.nodeId === "verify")?.state, "asserted");
    assert.deepEqual(result.result.value, { verified: false });
  });

  it("runs every entry, parks at the gate and records a real decision only when the step is NOT omitted", async () => {
    const h = await harness();
    h.authority.database.authority.runs.enqueue(queuedRun());
    const claimed = claim(h);
    const outcome = await executeClaimedRun(h.deps, claimed);
    assert.equal(outcome.state, "parked-gate");
    assert.ok(h.emitter.events().some((event) => event.t === "gate.opened"));
  });

  it("refuses an incomplete omission bundle at the start plan, and fails loud at the executor before any session if one reaches it", async () => {
    assert.throws(
      () => resolveStartStepOmissions(descriptor, ["reads"], [{ step: "deciding", facts: {} }]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && /facts are invalid at: verifiedByHand/u.test(error.message),
    );
    const h = await harness();
    h.authority.database.authority.runs.enqueue(queuedRun([{ step: "deciding", facts: { verifiedByHand: "yes" } }]));
    const claimed = claim(h);
    const outcome = await executeClaimedRun(h.deps, claimed);
    assert.equal(outcome.state, "failed", "an invalid bundle fails the run; nothing prompts for values");
    assert.equal(h.sessions.opens("ucpath"), 0);
    assert.equal(h.sessions.opens("crm"), 0);
    assert.deepEqual(h.authority.database.authority.gateResults.listByRun(claimed.run.envelope.runId), []);
  });
});
