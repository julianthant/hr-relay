/**
 * D307 — step-omission invariants, swept over every registered workflow
 * descriptor.
 *
 * `src/domain/workflow/step-omission.ts` is pure: the factory
 * (`deriveStepOmissions`, `src/base/workflow.ts`) enforces at DEFINITION TIME
 * that a producer names only TASK nodes of its own step, and the planner
 * (`planStepOmissions`)/cascade (`stepOmissionCascade`) enforce the rest at
 * plan time.
 *
 * The production registry DOES declare omissions: `separations` declares three
 * — `kronos-timecard`, `ucpath-transaction` and `kuali-finalization`, each
 * authored in its own step folder's `omission.ts` and carried onto the
 * descriptor by that folder's `nodes.category(..., { omission })`. Every sweep
 * below therefore pins those three BY NAME (a declaration that disappears, is
 * renamed, or stops reaching the registry turns the sweep red rather than
 * quietly shrinking it), and pins the exact row each one yields.
 *
 * The in-test fixture — shaped like Separations' write half: a read, the
 * `identity-approval` operator gate, a post-gate task and a transaction, across
 * the same `reading`/`identity-check`/`writing` step keys — exists for the arms
 * the registry cannot reach: the definition-time refusals (no registered
 * descriptor may contain them and still import) and the `blocked` cascade arm
 * Separations has no instance of.
 *
 * (a) an omission can never produce a gate or a transaction node; the factory
 *     throws at `defineWorkflowDescriptor()` call time.
 * (b) every production omittable step's `stepOmissionCascade` row equals the
 *     exact pinned row (Separations: three `{ state: "omittable", forces: [] }`
 *     rows); the fixture keeps the `omittable`-or-`blocked` union assertion,
 *     because the cascade never throws is what the un-caught call proves there.
 * (c) every RAW step-folder declaration (`KRONOS_TIMECARD_OMISSION` and its two
 *     siblings, imported from the `omission.ts` files themselves, not read back
 *     off an already-parsed `spec.form`) parses through `StepOmissionFormSchema`
 *     with the exact pinned field keys and no duplicate key, declares exactly
 *     the pinned `produces` node ids, and reaches the descriptor unchanged.
 * (d) `planStepOmissions` never classifies ANY gate node as `asserted` or
 *     `omitted` — the ALWAYS-GATE rule (D77) is a planner invariant, not a
 *     per-descriptor promise — for three plan shapes per declaration: the step
 *     alone, the step together with its cascade `forces` set, and every
 *     omittable step of the descriptor at once. Separations' `identity-approval`
 *     gate is required to be present and to EXECUTE (classified neither way,
 *     under a refusal-free plan) in all three, and each plan's asserted/omitted
 *     node ids are pinned: `dates` and `receipt` are the only asserted nodes,
 *     while `clear-pending`, `file-termination` and `finalize-kuali` are only
 *     ever omitted.
 *
 * There is no separate "no separations omission produces identity-approval"
 * arm: a declaration naming the gate throws at import, so that test could not
 * fail — the invariant lives in (c)'s exact `produces` pinning (a producer
 * ADDED for a task node is a reachable red) and in (d)'s planner sweep.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { defineTaskContract } from "../../../src/domain/contracts/base.js";
import { EidSchema, FingerprintSchema, ScenarioIdSchema, TaskIdSchema } from "../../../src/domain/ids.js";
import {
  planStepOmissions,
  stepOmissionCascade,
  stepOmissionPlaceholderFacts,
  StepOmissionFormSchema,
  type StepOmissionCascadeRow,
  type StepOmissionDeclaration,
  type StepOmissionGraphView,
  type StepOmissionPlan,
} from "../../../src/domain/workflow/step-omission.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import { KRONOS_TIMECARD_OMISSION } from "../../../src/workflows/separations/kronos-timecard/omission.js";
import { KUALI_FINALIZATION_OMISSION } from "../../../src/workflows/separations/kuali-finalization/omission.js";
import { UCPATH_TRANSACTION_OMISSION } from "../../../src/workflows/separations/ucpath-transaction/omission.js";
import { FixtureCommit, FixtureStage } from "./helpers/descriptor-fixtures.js";

const FixtureInput = z.strictObject({ eid: EidSchema });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }],
);

const ReadContract = defineTaskContract({
  id: TaskIdSchema.parse("ocr/read-step-omission-guard"),
  title: "Step omission guard fixture read",
  effect: "read",
  input: FixtureInput,
  output: z.strictObject({ value: z.string().min(1) }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: { kind: "none", reason: "step omission guard fixture" },
  scenarios: [ScenarioIdSchema.parse("step-omission-guard/happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { value: "observed" },
});

const ApproveContract = defineTaskContract({
  id: TaskIdSchema.parse("ocr/verify-step-omission-guard"),
  title: "Step omission guard fixture approve",
  effect: "read",
  input: FixtureInput,
  output: z.strictObject({ approved: z.boolean() }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: { kind: "none", reason: "step omission guard fixture" },
  scenarios: [ScenarioIdSchema.parse("step-omission-guard/happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { approved: true },
});

/**
 * A fixture graph shaped like Separations' write half: a read, the
 * `identity-approval` operator gate, a post-gate task, and a transaction —
 * split across the SAME three step keys Separations uses (`reading`,
 * `identity-check`, `writing`) so the fixture stands in for the real
 * descriptor's omission-free `identity-check` step.
 */
function buildStepOmissionFixture(
  id: string,
  code: string,
  overrides: {
    identityCheckOmission?: StepOmissionDeclaration;
    writingOmission?: StepOmissionDeclaration;
  } = {},
): AnyWorkflowDescriptor {
  const fixtureFlow = flow(FixtureInput)
    .step("read", ReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .gate("identity-approval", {
      dependsOn: ["read"],
      label: "Identity Approval",
      statusKey: "needsReview",
      resolvedBy: "operator",
      result: z.strictObject({ approved: z.boolean() }),
    })
    .step("approve", ApproveContract, {
      dependsOn: ["read", "identity-approval"],
      replay: "checkpoint",
      bind: ({ input }) => ({ eid: input.eid }),
    })
    .transaction("submit", {
      dependsOn: ["approve"],
      prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    })
    .build({
      schema: z.strictObject({ transactionId: z.string().min(1) }),
      dependsOn: ["submit"],
      derive: ({ outputs }) => ({ transactionId: outputs.submit.output.transactionId }),
    });

  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: FingerprintSchema.parse("f".repeat(64)),
    code,
    label: "Step omission invariants fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` },
    presentation: { title: (input) => `Fixture ${input.eid}` },
    scenarios: [`${id}/happy`],
    timeline: [
      { key: "reading", label: "Reading", nodes: ["read"] },
      {
        key: "identity-check",
        label: "Identity Check",
        nodes: ["identity-approval", "approve"],
        ...(overrides.identityCheckOmission === undefined ? {} : { omission: overrides.identityCheckOmission }),
      },
      {
        key: "writing",
        label: "Writing",
        nodes: ["submit"],
        ...(overrides.writingOmission === undefined ? {} : { omission: overrides.writingOmission }),
      },
    ],
    flow: fixtureFlow,
  });
}

const VALID_OMISSION: StepOmissionDeclaration = {
  form: { fields: [{ key: "approvedFlag", label: "Approved", kind: "boolean" }] },
  produces: { approve: ({ facts }) => ({ approved: facts.approvedFlag }) },
};

/** The two descriptor ids this guard names explicitly: the real registry's only omission author, and the fixture's. */
const SEPARATIONS_ID = "separations";
const FIXTURE_ID = "step-omission-guard-valid";

/** The one legitimate fixture descriptor every positive check runs against too. */
const validFixture = buildStepOmissionFixture(FIXTURE_ID, "sov", {
  identityCheckOmission: VALID_OMISSION,
});

function graphViewOf(descriptor: AnyWorkflowDescriptor): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(descriptor),
    timeline: descriptor.timeline,
    stepOmissions: descriptor.stepOmissions,
  };
}

/**
 * The production registry's declarations, pinned BY NAME. Each row names the
 * step folder that authors it, the RAW declaration that folder exports, the
 * exact form field keys and the exact task node ids its `produces` map
 * rebuilds. A declaration that is deleted, renamed, or given another producer
 * fails here — `audited > 0` counting would not have noticed, because the
 * in-test fixture alone satisfies it.
 */
const PRODUCTION_DECLARATIONS: readonly Readonly<{
  descriptor: string;
  step: string;
  declaration: StepOmissionDeclaration;
  fieldKeys: readonly string[];
  produces: readonly string[];
}>[] = [
  {
    descriptor: SEPARATIONS_ID, step: "kronos-timecard", declaration: KRONOS_TIMECARD_OMISSION,
    fieldKeys: ["lastDayWorked", "separationDate"], produces: ["dates"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "ucpath-transaction", declaration: UCPATH_TRANSACTION_OMISSION,
    fieldKeys: ["transactionNumber", "approvalStatus"], produces: ["receipt"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "kuali-finalization", declaration: KUALI_FINALIZATION_OMISSION,
    fieldKeys: [], produces: [],
  },
];

/** Every `<descriptor>::<step>` row a complete sweep MUST have visited — the three production declarations plus the fixture's one. */
const REQUIRED_SWEEP_ROWS: readonly string[] = [
  ...PRODUCTION_DECLARATIONS.map(({ descriptor, step }) => `${descriptor}::${step}`),
  `${FIXTURE_ID}::identity-check`,
];

/** The exact cascade row each production step yields today (check b). */
const PRODUCTION_CASCADE_ROWS: Readonly<Record<string, StepOmissionCascadeRow>> = {
  "separations::kronos-timecard": { state: "omittable", forces: [] },
  "separations::ucpath-transaction": { state: "omittable", forces: [] },
  "separations::kuali-finalization": { state: "omittable", forces: [] },
};

/**
 * The exact node classification each production single-step omission yields
 * (check d): the browser reads and the transactions are OMITTED — never
 * asserted — and only the two pure folds are rebuilt from typed facts.
 */
const PRODUCTION_PLANS: Readonly<Record<string, Readonly<{ asserted: readonly string[]; omitted: readonly string[] }>>> = {
  "separations::kronos-timecard": { asserted: ["dates"], omitted: ["timecard", "timecard-search"] },
  "separations::ucpath-transaction": { asserted: ["receipt"], omitted: ["clear-pending", "file-termination"] },
  "separations::kuali-finalization": { asserted: [], omitted: ["finalize-kuali"] },
};

/** The same pinning for the whole-descriptor plan: every omittable step of a descriptor omitted at once. */
const PRODUCTION_WHOLE_DESCRIPTOR_PLANS: Readonly<Record<string, Readonly<{ asserted: readonly string[]; omitted: readonly string[] }>>> = {
  [SEPARATIONS_ID]: {
    asserted: ["dates", "receipt"],
    omitted: ["clear-pending", "file-termination", "finalize-kuali", "timecard", "timecard-search"],
  },
};

/** Every descriptor this guard sweeps: the whole production registry plus the one legitimate fixture. */
const SWEPT_DESCRIPTORS: readonly AnyWorkflowDescriptor[] = [...DESCRIPTORS, validFixture];

function isFixture(descriptor: AnyWorkflowDescriptor): boolean {
  return String(descriptor.id) === FIXTURE_ID;
}

function sorted(ids: Iterable<string>): readonly string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

/**
 * Plan the named steps of one descriptor with the CASCADE's own placeholder
 * facts (`stepOmissionPlaceholderFacts`, exported by the domain module so this
 * guard cannot drift from a hand-copied second generator).
 */
function planSteps(descriptor: AnyWorkflowDescriptor, steps: readonly string[]): StepOmissionPlan {
  const view = graphViewOf(descriptor);
  const specByStep = new Map(view.stepOmissions.map((spec) => [spec.step, spec]));
  return planStepOmissions(view, steps.map((step) => {
    const spec = specByStep.get(step);
    if (spec === undefined) throw new Error(`${String(descriptor.id)}: step "${step}" declares no omission`);
    return { step, facts: stepOmissionPlaceholderFacts(spec.form) };
  }));
}

/** Every sweep ends here: the rows it actually visited must be EXACTLY the declarations this tree has. */
function assertSweptEveryDeclaration(audited: readonly string[], sweep: string): void {
  assert.deepEqual(
    sorted(audited),
    sorted(REQUIRED_SWEEP_ROWS),
    `${sweep}: the sweep did not visit exactly the declared omissions — a production declaration went missing, `
      + "or a new one was added without pinning it here",
  );
}

describe("step-omission invariants (D307)", () => {
  it("throws at definition time when an omission produces the gate node of its own step", () => {
    const gateOmission: StepOmissionDeclaration = {
      form: { fields: [] },
      produces: { "identity-approval": () => ({ approved: true }) },
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-gate", "sog", { identityCheckOmission: gateOmission }),
      /identity-check" omission produces gate node "identity-approval"; only task nodes are ever asserted \(D307\)/u,
    );
  });

  it("throws at definition time when an omission produces the transaction node of its own step", () => {
    const transactionOmission: StepOmissionDeclaration = {
      form: { fields: [] },
      produces: { submit: () => ({ transactionId: "T1" }) },
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-txn", "sot", { writingOmission: transactionOmission }),
      /writing" omission produces transaction node "submit"; only task nodes are ever asserted \(D307\)/u,
    );
  });

  it("refuses a descriptor whose omission form declares a duplicate field key (negative arm for check c)", () => {
    const duplicateFieldOmission: StepOmissionDeclaration = {
      form: { fields: [{ key: "value", label: "V1", kind: "text" }, { key: "value", label: "V2", kind: "text" }] },
      produces: { approve: () => ({ approved: true }) },
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-dup", "sod", { identityCheckOmission: duplicateFieldOmission }),
      /declared twice/u,
    );
  });

  it("yields the exact pinned cascade row for every production omittable step, and a non-throwing omittable/blocked row for the fixture", () => {
    const audited: string[] = [];
    for (const descriptor of SWEPT_DESCRIPTORS) {
      const view = graphViewOf(descriptor);
      if (view.stepOmissions.length === 0) continue;
      // stepOmissionCascade computes planStepOmissions to a fixpoint for
      // EVERY omittable step and throws internally the moment a refusal
      // other than "dependency-omitted" appears (step-omission.ts). Letting
      // it run un-caught IS the "never throws for any refusal but
      // dependency-omitted" proof for a single-step omission with
      // placeholder facts.
      const rows = stepOmissionCascade(view);
      for (const spec of view.stepOmissions) {
        const key = `${String(descriptor.id)}::${spec.step}`;
        audited.push(key);
        const row = rows.get(spec.step);
        assert.ok(row !== undefined, `${key}: no cascade row for this step`);
        if (isFixture(descriptor)) {
          // The fixture's job is the arms the registry cannot reach; only the
          // union is promised of it.
          assert.ok(
            row?.state === "omittable" || row?.state === "blocked",
            `${key}: cascade row is neither omittable nor blocked`,
          );
          continue;
        }
        const expected = PRODUCTION_CASCADE_ROWS[key];
        assert.ok(expected !== undefined, `${key}: a production step declares an omission with no pinned cascade row`);
        assert.deepEqual(row, expected, `${key}: cascade row changed`);
      }
    }
    assertSweptEveryDeclaration(audited, "cascade sweep");
  });

  it("parses every RAW step-folder declaration through StepOmissionFormSchema, with exactly the pinned keys and producers", () => {
    const audited: string[] = [];
    const raw: readonly Readonly<{ key: string; declaration: StepOmissionDeclaration; fieldKeys: readonly string[]; produces: readonly string[] }>[] = [
      ...PRODUCTION_DECLARATIONS.map(({ descriptor, step, declaration, fieldKeys, produces }) => ({
        key: `${descriptor}::${step}`, declaration, fieldKeys, produces,
      })),
      { key: `${FIXTURE_ID}::identity-check`, declaration: VALID_OMISSION, fieldKeys: ["approvedFlag"], produces: ["approve"] },
    ];
    for (const { key, declaration, fieldKeys, produces } of raw) {
      audited.push(key);
      // The RAW declaration the step folder exports — not `spec.form`, which
      // the factory already parsed, so re-parsing it would prove nothing.
      const parsed = StepOmissionFormSchema.parse(declaration.form);
      const keys = parsed.fields.map((field) => field.key);
      assert.deepEqual(keys, fieldKeys, `${key}: declared form field keys changed`);
      assert.equal(new Set(keys).size, keys.length, `${key}: declares a duplicate form field key`);
      assert.deepEqual(Object.keys(declaration.produces), produces, `${key}: declared producers changed`);
    }
    assertSweptEveryDeclaration(audited, "raw declaration sweep");

    // The raw declarations are the ones the registry actually carries: a folder
    // could otherwise export a pristine declaration the descriptor never sees.
    for (const descriptor of SWEPT_DESCRIPTORS) {
      for (const spec of descriptor.stepOmissions) {
        const key = `${String(descriptor.id)}::${spec.step}`;
        const declared = raw.find((row) => row.key === key);
        assert.ok(declared !== undefined, `${key}: the registry carries an omission this guard does not pin`);
        assert.deepEqual(spec.form, StepOmissionFormSchema.parse(declared?.declaration.form), `${key}: the registry's form is not the folder's`);
        assert.deepEqual(Object.keys(spec.produces), declared?.produces, `${key}: the registry's producers are not the folder's`);
      }
    }
  });

  it("never classifies a gate node as asserted or omitted — alone, with its cascade forces, or with every omittable step of its descriptor", () => {
    const audited: string[] = [];
    const wholeDescriptorsAudited: string[] = [];
    for (const descriptor of SWEPT_DESCRIPTORS) {
      const view = graphViewOf(descriptor);
      if (view.stepOmissions.length === 0) continue;
      const id = String(descriptor.id);
      const gateIds = view.nodes.filter((node) => node.kind === "gate").map((node) => node.id);
      assert.ok(gateIds.length > 0, `${id}: declares an omission but has no gate — the ALWAYS-GATE sweep would be vacuous here`);
      if (id === SEPARATIONS_ID) {
        assert.ok(gateIds.includes("identity-approval"), "separations must still carry the identity-approval gate");
      }
      const cascade = stepOmissionCascade(view);

      const assertGatesExecute = (plan: StepOmissionPlan, shape: string): void => {
        for (const gateId of gateIds) {
          assert.ok(!plan.asserted.has(gateId), `${id} (${shape}): asserts gate "${gateId}"`);
          assert.ok(!plan.omitted.has(gateId), `${id} (${shape}): omits gate "${gateId}"`);
        }
      };

      for (const spec of view.stepOmissions) {
        const key = `${id}::${spec.step}`;
        audited.push(key);
        const row = cascade.get(spec.step);
        assert.ok(row !== undefined, `${key}: no cascade row`);

        const alone = planSteps(descriptor, [spec.step]);
        assertGatesExecute(alone, `step "${spec.step}" alone`);
        // The step TOGETHER with everything its cascade forces out with it —
        // the set the Steps screen would actually lock, which a single-step
        // plan never exercises.
        const withForces = planSteps(descriptor, [spec.step, ...(row?.forces ?? [])]);
        assertGatesExecute(withForces, `step "${spec.step}" + forces`);
        if (row?.state === "omittable") {
          assert.deepEqual(alone.refusals, [], `${key}: an omittable step refuses on its own`);
          assert.deepEqual(withForces.refusals, [], `${key}: an omittable step refuses with its own forced set`);
        }
        if (isFixture(descriptor)) continue;
        const expected = PRODUCTION_PLANS[key];
        assert.ok(expected !== undefined, `${key}: a production step declares an omission with no pinned plan`);
        assert.deepEqual(sorted(alone.asserted.keys()), expected?.asserted, `${key}: asserted nodes changed`);
        assert.deepEqual(sorted(alone.omitted.keys()), expected?.omitted, `${key}: omitted nodes changed`);
      }

      // Every omittable step of the descriptor, omitted at once.
      const everyStep = view.stepOmissions.map(({ step }) => step);
      const whole = planSteps(descriptor, everyStep);
      wholeDescriptorsAudited.push(id);
      assertGatesExecute(whole, "every omittable step at once");
      if (isFixture(descriptor)) continue;
      assert.deepEqual(whole.refusals, [], `${id}: omitting every omittable step at once refuses`);
      const expectedWhole = PRODUCTION_WHOLE_DESCRIPTOR_PLANS[id];
      assert.ok(expectedWhole !== undefined, `${id}: a production descriptor declares omissions with no pinned whole-descriptor plan`);
      assert.deepEqual(sorted(whole.asserted.keys()), expectedWhole?.asserted, `${id}: whole-descriptor asserted nodes changed`);
      assert.deepEqual(sorted(whole.omitted.keys()), expectedWhole?.omitted, `${id}: whole-descriptor omitted nodes changed`);
    }
    assertSweptEveryDeclaration(audited, "planner sweep");
    assert.deepEqual(sorted(wholeDescriptorsAudited), sorted([SEPARATIONS_ID, FIXTURE_ID]), "the whole-descriptor sweep visited the wrong descriptors");
  });
});
