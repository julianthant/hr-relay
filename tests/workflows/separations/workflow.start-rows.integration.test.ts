import assert from "node:assert/strict";
import { it } from "vitest";
import { planStepOmissions, StepOmissionsSchema } from "../../../src/models/workflow/step-omission.js";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, StartStepOmissionRefusedError } from "../../../src/backend/runs/start/step-selection.js";
import { SeparationsVerifyTerminationReceipt } from "../../../src/models/workflows/separations/verify-termination-receipt.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

const descriptor = separationsDescriptor;
const allSteps = () => projectStartSteps(descriptor).map(step => step.key);

it("serves the seven Separations rows in execution order: six locked with their reasons, Read timecard a switch", () => {
  assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, target, members }) => ({ key, label, kind, lockReason: lockReason ?? null, target: target ?? null, members })), [
    { key: "kuali-extraction", label: "Read Kuali document", kind: "locked", lockReason: "bound-read", target: null, members: [{ step: "kuali-extraction" }] },
    { key: "identity-check", label: "Verify employee identity", kind: "locked", lockReason: "guard-read", target: null, members: [{ step: "identity-check" }, { step: "reference-check" }] },
    { key: "kronos-timecard", label: "Read timecard", kind: "switch", lockReason: null, target: { step: "kronos-timecard" }, members: [{ step: "kronos-timecard" }] },
    { key: "identity-review", label: "Approve identity", kind: "locked", lockReason: "approval", target: null, members: [{ step: "identity-review" }] },
    { key: "pending-termination", label: "Check pending termination", kind: "locked", lockReason: "form-action", target: null, members: [{ step: "ucpath-transaction", nodes: ["pending-set", "clear-pending"] }] },
    { key: "submit-termination", label: "Submit termination", kind: "locked", lockReason: "form-action", target: null, members: [{ step: "ucpath-transaction", nodes: ["file-termination", "receipt"] }] },
    { key: "kuali-finalization", label: "Finalize Kuali document", kind: "locked", lockReason: "form-action", target: null, members: [{ step: "kuali-finalization" }] },
  ]);
});

it("refuses typed facts for either write step; only Read timecard takes typed values", () => {
  assert.deepEqual(descriptor.stepOmissions.map(({ step }) => step), ["kronos-timecard"]);
  const steps = allSteps().filter(step => step !== "ucpath-transaction" && step !== "kuali-finalization");
  for (const [step, facts] of [
    ["ucpath-transaction", { transactionNumber: "T123456", approvalStatus: "Approved" }],
    ["kuali-finalization", {}],
  ] as const) {
    assert.throws(
      () => resolveStartStepOmissions(descriptor, steps, StepOmissionsSchema.parse([{ step, facts }])),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "step-not-omittable",
    );
    assert.deepEqual(planStepOmissions(descriptor, StepOmissionsSchema.parse([{ step, facts }])).refusals.map(({ code }) => code), ["step-not-omittable"]);
  }
  const ucpath = projectStartSteps(descriptor).find(step => step.key === "ucpath-transaction");
  const kuali = projectStartSteps(descriptor).find(step => step.key === "kuali-finalization");
  assert.equal(ucpath?.control.state, "required");
  assert.equal(kuali?.control.state, "required");
});

it("keeps Read timecard's two typed dates standing for the dates node's leaves", () => {
  const [timecard] = descriptor.stepOmissions;
  assert.deepEqual(timecard?.form.fields.map(({ key, kind, replaces }) => ({ key, kind, replaces })), [
    { key: "lastDayWorked", kind: "us-date", replaces: { nodeId: "dates", path: "lastDayWorked" } },
    { key: "separationDate", kind: "us-date", replaces: { nodeId: "dates", path: "separationDate" } },
  ]);
  const typed = resolveStartStepOmissions(descriptor, allSteps().filter(step => step !== "kronos-timecard"),
    [{ step: "kronos-timecard", facts: { lastDayWorked: "08/02/2026", separationDate: "08/02/2026" } }]);
  assert.deepEqual(typed, [{ step: "kronos-timecard", facts: { lastDayWorked: "08/02/2026", separationDate: "08/02/2026" }, labels: { lastDayWorked: "Last day worked", separationDate: "Separation date" } }]);
});

it("all switches on plans no omission and keeps today's steps and node ids", () => {
  assert.equal(resolveStartStepOmissions(descriptor, allSteps(), undefined), undefined);
  const plan = planStepOmissions(descriptor, []);
  assert.deepEqual([plan.asserted.size, plan.omitted.size, plan.refusals.length], [0, 0, 0]);
  assert.deepEqual(descriptor.timeline.map(({ key, nodes }) => [key, nodes.map(({ id }) => String(id))]), [
    ["kuali-extraction", ["resolve-action", "document", "plan", "termination-type"]],
    ["identity-check", ["name-search", "subject", "job-summary", "employment", "department-option"]],
    ["kronos-timecard", ["timecard-search", "timecard", "dates"]],
    ["identity-review", ["comparison", "identity-approval", "approval"]],
    ["reference-check", ["reference-check", "reference-stop", "reference-check-review"]],
    ["ucpath-transaction", ["pending-set", "clear-pending", "file-termination", "receipt"]],
    ["kuali-finalization", ["filing-presence", "finalize-kuali"]],
  ]);
});

it("the write steps always run, and an already filed termination or saved finalization ends already present through the step's own probe", () => {
  const probeOf = (nodeId: string) => {
    const node = descriptor.nodes.find(({ id }) => String(id) === nodeId);
    assert.ok(node?.kind === "transaction", `${nodeId} is a transaction`);
    return String(node.commit.uses.writeSafety.idempotency.probe.taskId);
  };
  assert.equal(probeOf("file-termination"), "ucpath/match-existing-termination");
  assert.equal(probeOf("finalize-kuali"), "kuali/match-separation-finalization");
  const receipt = descriptor.nodes.find(({ id }) => String(id) === "receipt");
  assert.ok(receipt?.kind === "task");
  assert.equal(String(receipt.uses.id), String(SeparationsVerifyTerminationReceipt.id));
  assert.equal(SeparationsVerifyTerminationReceipt.input.shape.disposition.safeParse("already-present").success, true);
});
