import { default as assert } from "node:assert/strict";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { z } from "zod";
import { stepOmissionGraphView } from "../../../src/backend/runs/start/step-selection.js";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { planStepOmissions } from "../../../src/models/workflow/step-omission.js";
import type { StepOmissionDeclaration } from "../../../src/models/workflow/step-omission.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import type { WorkflowAuthor } from "../../../src/workflow-kit/workflow-definition.js";
import { compileFixtureWorkflow } from "../../support/fixtures/workflow-definition-fixtures.js";
import { stepOmissionCascade } from "../../../src/models/workflow/step-omission.js";
import type { StepOmissionGraphView } from "../../../src/models/workflow/step-omission.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

{

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const FixtureInput = z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema }),
  [{ emplId: "10800000", expectedName: "Fixture, Person" }],
);
const ReviewResultSchema = z.strictObject({ approved: z.boolean() });
const FixtureResultSchema = z.strictObject({ verified: z.boolean() });

type Author = WorkflowAuthor<typeof FixtureInput>;

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

const gateInsideOmittableStep = fixture("omission-gate-inside-omitted-step", "dg", ({ task, gate, group, result }) => {
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

describe("definition-time omission completeness", () => {
afterEach(_afterEachFixture0);

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
}

{

function graphView(): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(separationsDescriptor).map((node) => ({
      id: String(node.id), kind: node.kind, dependsOn: node.dependsOn.map(String),
    })),
    timeline: separationsDescriptor.timeline,
    stepOmissions: separationsDescriptor.stepOmissions,
  };
}

describe("separations omittable write steps", () => {

  it("forces no other step out and blocks on none", () => {
    const rows = stepOmissionCascade(graphView());
    assert.deepEqual([...rows.entries()], [
      ["kronos-timecard", { state: "omittable", forces: [] }],
      ["ucpath-transaction", { state: "omittable", forces: [] }],
      ["kuali-finalization", { state: "omittable", forces: [] }],
    ]);
  });

  it("classifies each omission over the real graph: browser reads and transactions omitted, folds asserted", () => {
    const view = graphView();
    const kronos = planStepOmissions(view, [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } }]);
    assert.deepEqual(kronos.refusals, []);
    assert.deepEqual([...kronos.omitted.keys()], ["timecard-search", "timecard"]);
    assert.deepEqual([...kronos.asserted.keys()], ["dates"]);

    const ucpath = planStepOmissions(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } }]);
    assert.deepEqual(ucpath.refusals, []);
    assert.deepEqual([...ucpath.omitted.keys()], ["pending-set", "clear-pending", "file-termination"]);
    assert.deepEqual([...ucpath.asserted.keys()], ["receipt"]);

    const finalization = planStepOmissions(view, [{ step: "kuali-finalization", facts: {} }]);
    assert.deepEqual(finalization.refusals, []);
    assert.deepEqual([...finalization.omitted.keys()], ["filing-presence", "finalize-kuali"]);
    assert.equal(finalization.asserted.size, 0);

    const all = planStepOmissions(view, [
      { step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } },
      { step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } },
      { step: "kuali-finalization", facts: {} },
    ]);
    assert.deepEqual(all.refusals, []);

    const identity = planStepOmissions(view, [{ step: "identity-check", facts: {} }]);
    assert.deepEqual(identity.refusals.map(({ code }) => code), ["step-not-omittable"]);

    const denied = planStepOmissions(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Denied" } }]);
    assert.deepEqual(denied.refusals.map(({ code }) => code), ["facts-invalid"]);
  });
});
}
