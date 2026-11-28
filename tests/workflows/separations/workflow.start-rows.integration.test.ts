import { expectedReferenceStages } from "../../support/fixtures/reference-check-graph.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { planStepOmissions, StepOmissionsSchema } from "../../../src/models/workflow/step-omission.js";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, StartStepOmissionRefusedError } from "../../../src/backend/runs/start/step-selection.js";
import { SeparationsVerifyTerminationReceipt } from "../../../src/models/workflows/separations/verify-termination-receipt.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

const referenceStages = expectedReferenceStages(["start", "document", "subject", "job-summary", "approval"]);
const descriptor = separationsDescriptor;
const allSteps = () => projectStartSteps(descriptor).map(step => step.key);

it("serves the seven Separations rows in execution order, every one a switch", () => {
  assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, target, members }) => ({ key, label, kind, lockReason: lockReason ?? null, target: target ?? null, members })), [
    { key: "kuali-extraction", label: "Read Kuali document", kind: "switch", lockReason: null, target: { step: "kuali-extraction" }, members: [{ step: "kuali-extraction" }] },
    { key: "identity-check", label: "Verify employee identity", kind: "switch", lockReason: null, target: { step: "identity-check" }, members: [{ step: "identity-check" }, { step: "reference-check" }] },
    { key: "kronos-timecard", label: "Read timecard", kind: "switch", lockReason: null, target: { step: "kronos-timecard" }, members: [{ step: "kronos-timecard" }] },
    { key: "identity-review", label: "Approve identity", kind: "switch", lockReason: null, target: { step: "identity-review" }, members: [{ step: "identity-review" }] },
    { key: "pending-termination", label: "Check pending termination", kind: "switch", lockReason: null, target: { step: "pending-termination" }, members: [{ step: "pending-termination" }] },
    { key: "submit-termination", label: "Submit termination", kind: "switch", lockReason: null, target: { step: "ucpath-transaction" }, members: [{ step: "ucpath-transaction" }] },
    { key: "kuali-finalization", label: "Finalize Kuali document", kind: "switch", lockReason: null, target: { step: "kuali-finalization" }, members: [{ step: "kuali-finalization" }] },
  ]);
});

it("takes a typed receipt for Submit termination and nothing for the steps done outside Relay", () => {
  const steps = allSteps().filter(step => !["pending-termination", "ucpath-transaction", "kuali-finalization"].includes(step));
  const typed = resolveStartStepOmissions(descriptor, steps, StepOmissionsSchema.parse([
    { step: "pending-termination", facts: {} },
    { step: "ucpath-transaction", facts: { transactionNumber: "T123456", approvalStatus: "Approved", effectiveDate: "06/20/2026" } },
    { step: "kuali-finalization", facts: {} },
  ]));
  assert.deepEqual(typed?.map(({ step }) => step), ["pending-termination", "ucpath-transaction", "kuali-finalization"]);
  assert.throws(
    () => resolveStartStepOmissions(descriptor, steps, StepOmissionsSchema.parse([
      { step: "pending-termination", facts: {} },
      { step: "ucpath-transaction", facts: { transactionNumber: "123", approvalStatus: "Approved", effectiveDate: "06/20/2026" } },
      { step: "kuali-finalization", facts: {} },
    ])),
    (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid",
  );
});

it("keeps Read timecard's two typed dates standing for the dates node's leaves", () => {
  const timecard = descriptor.stepOmissions.find(({ step }) => step === "kronos-timecard");
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
    ["reference-check", referenceStages.flatMap(stage => stage.ids)],
    ["kuali-extraction", ["resolve-action", "document", "plan", "termination-type"]],
    ["identity-check", ["name-search", "subject", "job-summary", "employment", "department-option"]],
    ["kronos-timecard", ["timecard-search", "timecard", "dates"]],
    ["identity-review", ["comparison", "identity-approval", "approval"]],
    ["pending-termination", ["pending-set", "clear-pending"]],
    ["ucpath-transaction", ["file-termination", "receipt"]],
    ["kuali-finalization", ["filing-presence", "finalize-kuali"]],
  ]);
});

it("both write steps keep their own existing-record probes, and the receipt accepts an already-present filing", () => {
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
