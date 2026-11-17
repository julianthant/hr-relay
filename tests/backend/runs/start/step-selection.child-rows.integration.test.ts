import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  applyStartStepSelection,
  projectStartRows,
  resolveStartStepOmissions,
  StartStepOmissionRefusedError,
  stepOmissionGraphView,
} from "../../../../src/backend/runs/start/step-selection.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import {
  delegatedStepOmissions,
  planStepOmissions,
  type StartRowDeclaration,
  type StepManualDeclaration,
} from "../../../../src/models/workflow/step-omission.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { Plan1Output, plan1Contract } from "../../../support/fixtures/plan1-operation-workflows.js";
import { WriteFixtureCommit, WriteFixturePrepare } from "../../../support/fixtures/write-sequencer-fixtures.js";

const Input = z.strictObject({ emplId: EidSchema, text: z.string(), mode: z.enum(["ok", "fail", "repeat", "confirmed"]), extra: z.boolean() });
const CanonicalInput = defineCanonicalInput(Input, Input, [{ emplId: "10800000", text: "same", mode: "ok", extra: true }]);
const Result = z.strictObject({ eid: EidSchema });
const CHILD = "child-rows-member";
const SUBMISSION = { emplId: "10800000", text: "same", mode: "ok" };
const common = {
  version: 1, icon: "Search", category: "operations", input: Input, canonicalInput: CanonicalInput, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, details: [],
  scenarios: ["write-fixture/happy"], role: defineWorkflowRole({ kind: "standalone" }),
  identity: { matchKey: (input: { emplId: string }) => `eid:${input.emplId}` }, presentation: { title: (input: { emplId: string }) => `EID ${input.emplId}` },
  surfaces: { inputRun: { placeholder: "Enter an EID", parser: {
    split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
    constants: [{ field: "extra", value: { kind: "boolean", value: true } }],
  } } },
} as const;

const READ_TYPED: StepManualDeclaration = {
  form: { fields: [{ key: "disposition", label: "Disposition", kind: "text", replaces: { nodeId: "read", path: "disposition" } }] },
  produces: { read: ({ facts, scope }) => Plan1Output.parse({ eid: (scope.input as { emplId: string }).emplId, disposition: facts.disposition, providerState: "typed" }) },
  skips: ["search"],
};

/** reading: search -> read (typed by hand); saving: save (a transaction) -> receipt; extra: one read, no typed values. */
function memberFixture() {
  return compileWorkflow(defineWorkflow({
    ...common, id: CHILD, code: "crm", label: "Child rows member",
    steps: ({ task, transaction, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }));
      const read = task({ id: "read", contract: plan1Contract, replay: "checkpoint" }, [search], ({ input }) => input);
      const save = transaction({ id: "save", label: "Save", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
        dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [read], {
        prepareBind: ({ input }) => ({ eid: input.emplId }), commitBind: ({ input }) => ({ eid: input.emplId }),
      });
      const receipt = task({ id: "receipt", contract: plan1Contract, replay: "checkpoint" }, [save], ({ input }) => input);
      const more = task({ id: "more", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
      return {
        steps: [
          [group({ key: "reading", label: "Reading" }, { manual: READ_TYPED }), [search, read]],
          [{ key: "saving", label: "Saving" }, [save, receipt]],
          [{ key: "extra", label: "Extra" }, [more]],
        ],
        result: result(Result, [read, receipt, more], ({ input }) => ({ eid: input.emplId })),
      };
    },
  })).descriptor;
}

const ROWS: readonly StartRowDeclaration[] = [
  { key: "members-row", label: "Members row", members: [{ step: "members" }] },
  { key: "child-read-row", label: "Child read row", members: [{ workflow: CHILD, step: "reading" }], target: { workflow: CHILD, step: "reading" } },
  { key: "child-fill-row", label: "Child fill row", members: [{ workflow: CHILD, step: "saving", nodes: ["save"], phase: "prepare" }] },
  { key: "child-save-row", label: "Child save row", members: [{ workflow: CHILD, step: "saving", nodes: ["save"], phase: "commit" },
    { workflow: CHILD, step: "saving", nodes: ["receipt"] }] },
  { key: "child-extra-row", label: "Child extra row", members: [{ workflow: CHILD, step: "extra" }] },
];
const [MEMBERS, READ, FILL, SAVE, EXTRA] = ROWS as [StartRowDeclaration, StartRowDeclaration, StartRowDeclaration, StartRowDeclaration, StartRowDeclaration];

/** A parent whose one step delegates each person to the member fixture, bound to it as the registry binds them. */
function parentFixture(rows: readonly StartRowDeclaration[] = ROWS) {
  const member = memberFixture();
  const parent = compileWorkflow(defineWorkflow({
    ...common, id: "child-rows-parent", code: "crp", label: "Child rows parent", rows,
    steps: ({ delegate, result }) => {
      const members = delegate({ id: "members", target: { id: CHILD, input: Input, result: Result }, edgeId: "members",
        cardinality: "many", await: "terminal", join: "all",
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } }, [], {
        bind: ({ input }) => [input],
        deriveChildItemId: (_input, identity) => identity.canonicalItemId,
      });
      return { steps: [[{ key: "members", label: "Members" }, [members]]], result: result(Result, [], ({ input }) => ({ eid: input.emplId })) };
    },
  })).descriptor;
  bindWorkflowDelegationTargets([member, parent]);
  return parent;
}

describe("child row definition checks", () => {
  it("refuses a child member or target naming a workflow the definition does not delegate to", () => {
    assert.throws(() => parentFixture([MEMBERS, { ...READ, members: [{ workflow: "elsewhere", step: "reading" }], target: undefined }, FILL, SAVE, EXTRA]),
      /start row "child-read-row" names child workflow "elsewhere", which this workflow does not delegate to/u);
    assert.throws(() => parentFixture([MEMBERS, { ...READ, target: { workflow: "elsewhere", step: "reading" } }, FILL, SAVE, EXTRA]),
      /start row "child-read-row" targets child workflow "elsewhere", which this workflow does not delegate to/u);
  });

  it("refuses a child target on a step without typed values, a child step targeted twice, and a typed child step no row targets", () => {
    assert.throws(() => parentFixture([MEMBERS, READ, FILL, SAVE, { ...EXTRA, target: { workflow: CHILD, step: "extra" } }]),
      /targets step "extra" of child workflow "child-rows-member", which declares no manual entry/u);
    assert.throws(() => parentFixture([MEMBERS, READ, FILL, SAVE, EXTRA,
      { key: "again", label: "Again", members: [{ workflow: CHILD, step: "reading" }], target: { workflow: CHILD, step: "reading" } }]),
    /start rows "child-read-row" and "again" both target step "reading" of child workflow "child-rows-member"/u);
    assert.throws(() => parentFixture([MEMBERS, { ...READ, members: [{ workflow: CHILD, step: "reading", nodes: ["read"] }, { workflow: CHILD, step: "reading", nodes: ["search"] }] }, FILL, SAVE, EXTRA]),
      /start row "child-read-row" targets step "reading", which is not one of its whole-step members/u);
    assert.throws(() => parentFixture([MEMBERS, { ...READ, target: undefined }, FILL, SAVE, EXTRA]),
      /step "reading" of child workflow "child-rows-member" takes typed values, but no start row targets it/u);
  });

  it("refuses child members that leave a node of a named child unshown, show it twice, or name a missing step", () => {
    assert.throws(() => parentFixture([MEMBERS, READ, FILL, EXTRA]),
      /no start row shows the commit phase of node "save" of step "saving" of child workflow "child-rows-member"/u);
    assert.throws(() => parentFixture([MEMBERS, READ, FILL, SAVE, EXTRA, { key: "twice", label: "Twice", members: [{ workflow: CHILD, step: "saving", nodes: ["receipt"] }] }]),
      /start rows "child-save-row" and "twice" both show node "receipt" of child workflow "child-rows-member"/u);
    assert.throws(() => parentFixture([MEMBERS, READ, FILL, SAVE, { ...EXTRA, members: [{ workflow: CHILD, step: "nowhere" }] }]),
      /names step "nowhere", which is not on the timeline of child workflow "child-rows-member"/u);
  });
});

describe("child rows at start", () => {
  it("serves rows over the child's steps beside the parent's own, with kinds, lock reasons and one child target", () => {
    assert.deepEqual(projectStartRows(parentFixture()).map(({ key, kind, lockReason, target, manual, selection }) =>
      ({ key, kind, lockReason, target, form: manual?.form, selection })), [
      { key: "members-row", kind: "locked", lockReason: undefined, target: undefined, form: undefined, selection: undefined },
      { key: "child-read-row", kind: "switch", lockReason: undefined, target: { workflow: CHILD, step: "reading" }, form: READ_TYPED.form, selection: undefined },
      { key: "child-fill-row", kind: "locked", lockReason: "form-action", target: undefined, form: undefined, selection: undefined },
      { key: "child-save-row", kind: "locked", lockReason: "form-action", target: undefined, form: undefined, selection: undefined },
      { key: "child-extra-row", kind: "locked", lockReason: undefined, target: undefined, form: undefined, selection: undefined },
    ]);
  });

  it("stores a typed child entry with its labels, plans nothing for it on the parent and keeps child keys out of the selection", () => {
    const parent = parentFixture();
    const typed = resolveStartStepOmissions(parent, ["members"], [{ workflow: CHILD, step: "reading", facts: { disposition: "typed" } }]);
    assert.deepEqual(typed, [{ workflow: CHILD, step: "reading", facts: { disposition: "typed" }, labels: { disposition: "Disposition" } }]);
    assert.ok(typed !== undefined);
    const plan = planStepOmissions(stepOmissionGraphView(parent), typed);
    assert.deepEqual([plan.asserted.size, plan.omitted.size, plan.refusals], [0, 0, []]);
    assert.deepEqual(applyStartStepSelection(parent, SUBMISSION, ["members"], typed), SUBMISSION);
    assert.throws(() => applyStartStepSelection(parent, SUBMISSION, ["members", "reading"], typed), /has no start step reading/u);
    assert.equal(resolveStartStepOmissions(parent, ["members"], undefined), undefined);
  });

  it("refuses a child entry no row targets, a repeated one, and child facts the child's form refuses", () => {
    const parent = parentFixture();
    const refused = (entries: Parameters<typeof resolveStartStepOmissions>[2], code: string) => assert.throws(
      () => resolveStartStepOmissions(parent, ["members"], entries),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === code);
    refused([{ workflow: CHILD, step: "extra", facts: { disposition: "x" } }], "unknown-step");
    refused([{ workflow: "elsewhere", step: "reading", facts: { disposition: "x" } }], "unknown-step");
    refused([{ workflow: CHILD, step: "reading", facts: { disposition: 1 } }], "facts-invalid");
    refused([{ workflow: CHILD, step: "reading", facts: { disposition: "x" } }, { workflow: CHILD, step: "reading", facts: { disposition: "y" } }], "duplicate-step");
  });

  it("hands a released child the parent's entries for its workflow only, without the workflow", () => {
    const entries = [
      { step: "members", facts: { own: "x" } },
      { workflow: CHILD, step: "reading", facts: { disposition: "typed" }, labels: { disposition: "Disposition" } },
      { workflow: "other", step: "reading", facts: { disposition: "no" } },
    ];
    assert.deepEqual(delegatedStepOmissions(entries, CHILD), [{ step: "reading", facts: { disposition: "typed" }, labels: { disposition: "Disposition" } }]);
    assert.equal(delegatedStepOmissions(entries, "absent"), undefined);
    assert.equal(delegatedStepOmissions(undefined, CHILD), undefined);
  });
});
