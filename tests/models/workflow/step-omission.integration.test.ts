
import assert_m0 from "node:assert/strict";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { z as z_m0 } from "zod";
import { stepOmissionGraphView as stepOmissionGraphView_m0 } from "../../../src/backend/runs/start/step-selection.js";
import { CANONICAL_FIELDS as CANONICAL_FIELDS_m0 } from "../../../src/models/fields/registry.js";
import { CrmReadOnboardingRecord as CrmReadOnboardingRecord_m0 } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg as SearchPersonOrg_m0 } from "../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput as defineCanonicalInput_m0 } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS as STANDARD_WORKFLOW_ACTIONS_m0 } from "../../../src/models/workflow/presentation.js";
import { planStepOmissions as planStepOmissions_m0,type StepOmissionDeclaration as StepOmissionDeclaration_m0 } from "../../../src/models/workflow/step-omission.js";
import { EidSchema as EidSchema_m0 } from "../../../src/rules/identity/ids.js";
import { defineWorkflowRole as defineWorkflowRole_m0 } from "../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow as defineWorkflow_m0,type WorkflowAuthor as WorkflowAuthor_m0 } from "../../../src/workflow-kit/workflow-definition.js";
import { compileFixtureWorkflow as compileFixtureWorkflow_m0 } from "../../support/fixtures/workflow-definition-fixtures.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import {
planStepOmissions as planStepOmissions_m1,
stepOmissionCascade as stepOmissionCascade_m1,
type StepOmissionGraphView as StepOmissionGraphView_m1
} from "../../../src/models/workflow/step-omission.js";
import { descriptorRuntimeNodes as descriptorRuntimeNodes_m1 } from "../../../src/workflow-kit/workflow.js";
import { separationsDescriptor as separationsDescriptor_m1 } from "../../support/helpers/registered-workflows.js";


{


const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const FixtureInput = z_m0.strictObject({ emplId: EidSchema_m0, expectedName: CANONICAL_FIELDS_m0.fullName.schema });
const FixtureCanonicalInput = defineCanonicalInput_m0(
  FixtureInput,
  z_m0.strictObject({ emplId: EidSchema_m0, expectedName: CANONICAL_FIELDS_m0.fullName.schema }),
  [{ emplId: "10800000", expectedName: "Fixture, Person" }],
);
const ReviewResultSchema = z_m0.strictObject({ approved: z_m0.boolean() });
const FixtureResultSchema = z_m0.strictObject({ verified: z_m0.boolean() });

type Author = WorkflowAuthor_m0<typeof FixtureInput>;

/** Rebuilds the CRM verification read as a complete, schema-valid `absent` outcome from the typed flag. */
const VERIFY_OMISSION: StepOmissionDeclaration_m0 = {
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

function fixture(id: string, code: string, steps: (author: Author) => ReturnType<Parameters<typeof defineWorkflow_m0<typeof FixtureInput, typeof FixtureResultSchema>>[0]["steps"]>) {
  return defineWorkflow_m0({
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
    actions: STANDARD_WORKFLOW_ACTIONS_m0,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.emplId}` },
    presentation: { title: (input) => `EID ${input.emplId}` },
    scenarios: [`${id}/happy`],
    role: defineWorkflowRole_m0({ kind: "standalone" }),
    steps,
  });
}


const gateInsideOmittableStep = fixture("omission-gate-inside-omitted-step", "dg", ({ task, gate, group, result }) => {
  const search = task({ id: "search", contract: SearchPersonOrg_m0, label: "Search", replay: "checkpoint" }, [], ({ input }) => ({
    kind: "by-eid" as const, emplId: input.emplId,
  }));
  const review = gate({ id: "review", label: "Review", statusKey: "awaitingReview", result: ReviewResultSchema }, [search]);
  const verify = task({ id: "verify", contract: CrmReadOnboardingRecord_m0, label: "Verify", replay: "checkpoint" }, [search, review], ({ input }) => ({
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

describe_m0("definition-time omission completeness", () => {
afterEach_m0(_afterEachFixture0);


  it_m0("admits the terminal result as the one reader of an omitted member and compiles the gate-inside-step shape", () => {
    const compiled = compileFixtureWorkflow_m0(gateInsideOmittableStep);
    const plan = planStepOmissions_m0(
      stepOmissionGraphView_m0(compiled.descriptor),
      [{ step: "deciding", facts: { verifiedByHand: true } }],
    );
    assert_m0.deepEqual(plan.refusals, []);
    assert_m0.deepEqual([...plan.omitted.entries()], [["review", "deciding"]]);
    assert_m0.deepEqual([...plan.asserted.keys()], ["verify"]);
  });
});
}

{


function graphView(): StepOmissionGraphView_m1 {
  return {
    nodes: descriptorRuntimeNodes_m1(separationsDescriptor_m1).map((node) => ({
      id: String(node.id), kind: node.kind, dependsOn: node.dependsOn.map(String),
    })),
    timeline: separationsDescriptor_m1.timeline,
    stepOmissions: separationsDescriptor_m1.stepOmissions,
  };
}

describe_m1("separations omittable write steps", () => {

  it_m1("forces no other step out and blocks on none", () => {
    const rows = stepOmissionCascade_m1(graphView());
    assert_m1.deepEqual([...rows.entries()], [
      ["kronos-timecard", { state: "omittable", forces: [] }],
      ["ucpath-transaction", { state: "omittable", forces: [] }],
      ["kuali-finalization", { state: "omittable", forces: [] }],
    ]);
  });

  it_m1("classifies each omission over the real graph: browser reads and transactions omitted, folds asserted", () => {
    const view = graphView();
    const kronos = planStepOmissions_m1(view, [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } }]);
    assert_m1.deepEqual(kronos.refusals, []);
    assert_m1.deepEqual([...kronos.omitted.keys()], ["timecard-search", "timecard"]);
    assert_m1.deepEqual([...kronos.asserted.keys()], ["dates"]);

    const ucpath = planStepOmissions_m1(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } }]);
    assert_m1.deepEqual(ucpath.refusals, []);
    assert_m1.deepEqual([...ucpath.omitted.keys()], ["pending-set", "clear-pending", "file-termination"]);
    assert_m1.deepEqual([...ucpath.asserted.keys()], ["receipt"]);

    const finalization = planStepOmissions_m1(view, [{ step: "kuali-finalization", facts: {} }]);
    assert_m1.deepEqual(finalization.refusals, []);
    assert_m1.deepEqual([...finalization.omitted.keys()], ["filing-presence", "finalize-kuali"]);
    assert_m1.equal(finalization.asserted.size, 0);

    const all = planStepOmissions_m1(view, [
      { step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } },
      { step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } },
      { step: "kuali-finalization", facts: {} },
    ]);
    assert_m1.deepEqual(all.refusals, []);


    const identity = planStepOmissions_m1(view, [{ step: "identity-check", facts: {} }]);
    assert_m1.deepEqual(identity.refusals.map(({ code }) => code), ["step-not-omittable"]);
    // The UCPath approval status is closed to the statuses a receipt may carry.
    const denied = planStepOmissions_m1(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Denied" } }]);
    assert_m1.deepEqual(denied.refusals.map(({ code }) => code), ["facts-invalid"]);
  });
});
}
