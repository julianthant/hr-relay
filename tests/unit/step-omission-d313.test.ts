import { testRunLifecycle } from "./fixtures/run-lifecycle-fixtures.js";
/**
 * D313 — the run modal is the complete omission authority.
 *
 * Four things this file proves, each red-capable:
 *
 * 1. DEFINITION TIME — an omittable group whose members are read from outside
 *    the group refuses at `defineWorkflow` unless the omission rebuilds them;
 *    a producer may name only the group's own task entries.
 * 2. PLAN TIME — a gate inside an omitted group is omitted with the group
 *    (no decision is manufactured or required), and a transaction outside the
 *    group that depends on it refuses by name.
 * 3. RUN TIME — the executor runs NO entry of the omitted group: the gate
 *    opens nothing and records no `gate_results` row, the omitted read opens
 *    no session, and the asserted task's checkpoint carries D307 provenance.
 * 4. NO MID-RUN PROMPT — a run whose envelope reaches the executor with an
 *    incomplete omission bundle fails loud before any session is acquired;
 *    the start plan refused the same bundle before a row existed.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { defineWorkflow, type WorkflowAuthor } from "../../src/base/workflow-definition.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/core/run-executor.js";
import { CrmReadOnboardingRecord } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { CANONICAL_FIELDS } from "../../src/domain/fields/registry.js";
import { EidSchema } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../src/domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { planStepOmissions, type StepOmissionDeclaration } from "../../src/domain/workflow/step-omission.js";
import { StartStepOmissionRefusedError, resolveStartStepOmissions, stepOmissionGraphView } from "../../src/services/start/step-selection.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { WORKER_ID, sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  ManualScheduler,
  healthyCrmDriver,
  healthyUcpathDriver,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
} from "./fixtures/phase1f-executor-harness.js";
import { compileFixtureWorkflow } from "./fixtures/workflow-definition-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;

const FixtureInput = z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema }),
  [{ emplId: "10800000", expectedName: "Fixture, Person" }],
);
const ReviewResultSchema = z.strictObject({ approved: z.boolean() });
const FixtureResultSchema = z.strictObject({ verified: z.boolean() });

type Author = WorkflowAuthor<typeof FixtureInput>;

/** Rebuilds the CRM verification read as a complete, schema-valid `absent` outcome from the typed flag. */
const VERIFY_OMISSION: StepOmissionDeclaration = {
  form: { fields: [{ key: "verifiedByHand", label: "Verified by hand", kind: "boolean" }] },
  produces: {
    verify: ({ facts, scope }) => {
      const input = scope.input as { emplId: string };
      return {
        state: "absent" as const,
        queriedEid: input.emplId,
        reason: facts.verifiedByHand === true ? "verified by the operator outside the CRM" : "not verified",
      };
    },
  },
};

function fixture(id: string, code: string, steps: (author: Author) => ReturnType<Parameters<typeof defineWorkflow<typeof FixtureInput, typeof FixtureResultSchema>>[0]["steps"]>) {
  return defineWorkflow({
    id,
    version: 1,
    code,
    label: "D313 fixture",
    icon: "Search",
    category: "operations",
    input: FixtureInput,
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.emplId}` },
    presentation: { title: (input) => `EID ${input.emplId}` },
    scenarios: [`${id}/happy`],
    role: defineWorkflowRole({ kind: "standalone" }),
    steps,
  });
}

/**
 * `search` (reads) → [`review` gate, `verify` task] (deciding, omittable) → result.
 * Omitting `deciding` runs neither the gate nor the read; `verify` is rebuilt.
 */
const gateInsideOmittableStep = fixture("d313-gate-inside-omitted-step", "dgo", ({ task, gate, group, result }) => {
  const search = task({ id: "search", contract: SearchPersonOrg, label: "Search", replay: "checkpoint" }, [], ({ input }) => ({
    kind: "by-eid" as const, emplId: input.emplId,
  }));
  const review = gate({ id: "review", label: "Review", statusKey: "awaitingReview", result: ReviewResultSchema }, [search]);
  const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, label: "Verify", replay: "checkpoint" }, [search, review], ({ input }) => ({
    eid: input.emplId, name: input.expectedName,
  }));
  return {
    steps: [
      [{ key: "reads", label: "Reads" }, [search]],
      [group({ key: "deciding", label: "Deciding" }, { omission: VERIFY_OMISSION }), [review, verify]],
    ],
    result: result(FixtureResultSchema, [verify], ({ outputs }) => ({ verified: outputs.verify.state === "found" })),
  };
});

describe("D313 — definition-time omission completeness", () => {
  it("refuses an omittable step whose gate is read from outside the step, naming the mandatory-verifier rule", () => {
    assert.throws(() => fixture("d313-gate-read-outside", "dgr", ({ task, gate, group, result }) => {
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
    }), /step "deciding" is omittable, but workflow entry "after" in step "after" reads its gate entry "review", which omitting the step leaves unread; .*declare the check as its own entry outside the omitted step \(D313\)/u);
  });

  it("refuses an omittable step whose unproduced task is read from outside, and a producer naming a non-member or a gate", () => {
    const unproduced: StepOmissionDeclaration = { form: { fields: [] }, produces: {} };
    assert.throws(() => fixture("d313-task-read-outside", "dtr", ({ task, group, result }) => {
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
    assert.throws(() => fixture("d313-foreign-producer", "dfp", ({ task, group, result }) => {
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
    assert.throws(() => fixture("d313-gate-producer", "dgp", ({ task, gate, group, result }) => {
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
    }), /omission produces "review", which is a gate entry; only task entries are ever rebuilt from operator facts \(D313\)/u);
  });

  it("admits the terminal result as the one reader of an omitted member and compiles the gate-inside-step shape", () => {
    const compiled = compileFixtureWorkflow(gateInsideOmittableStep);
    const plan = planStepOmissions(
      stepOmissionGraphView(compiled.descriptor),
      [{ step: "deciding", facts: { verifiedByHand: true } }],
    );
    assert.deepEqual(plan.refusals, []);
    assert.deepEqual([...plan.omitted.entries()], [["review", "deciding"]]);
    assert.deepEqual([...plan.asserted.keys()], ["verify"]);
  });
});

describe("D313 — the executor runs no entry of an omitted step and never asks for values", () => {
  const compiled = compileFixtureWorkflow(gateInsideOmittableStep);
  const { descriptor } = compiled;

  function queuedRun(stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.workflow = String(descriptor.id);
    envelope.traceId = `${descriptor.code}-170000-4444`;
    envelope.contractFingerprint = descriptor.contractFingerprint;
    if (stepOmissions !== undefined) envelope.stepOmissions = stepOmissions;
    const input = run.input as { raw: unknown; parsed: Record<string, unknown> };
    input.raw = { emplId: "10873698", expectedName: "Fixture, Person" };
    input.parsed.schemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
    input.parsed.value = { emplId: "10873698", expectedName: "Fixture, Person" };
    return run;
  }

  function harness() {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const sessions = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver(), crm: () => healthyCrmDriver() });
    const emitter = recordingEmitter();
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(authority.database, authority.clock),
      descriptor,
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
    return { authority, sessions, emitter, deps };
  }

  function claim(harnessed: ReturnType<typeof harness>) {
    const claimed = harnessed.authority.database.authority.runs.claimNext({
      workflow: descriptor.id,
      workerId: WORKER_ID,
      now: harnessed.authority.clock.now().toISOString(),
    });
    if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
    return { run: claimed.run, claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration }, signal: SIGNAL };
  }

  it("omits the gate with its step: no gate.opened span, no gate_results row, no park, the read is asserted with operator provenance", async () => {
    const h = harness();
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
    const h = harness();
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
    const h = harness();
    h.authority.database.authority.runs.enqueue(queuedRun([{ step: "deciding", facts: { verifiedByHand: "yes" } }]));
    const claimed = claim(h);
    const outcome = await executeClaimedRun(h.deps, claimed);
    assert.equal(outcome.state, "failed", "an invalid bundle fails the run; nothing prompts for values");
    assert.equal(h.sessions.opens("ucpath"), 0);
    assert.equal(h.sessions.opens("crm"), 0);
    assert.deepEqual(h.authority.database.authority.gateResults.listByRun(claimed.run.envelope.runId), []);
  });
});
