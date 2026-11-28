import assert from "node:assert/strict";
import { it } from "vitest";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, StartStepOmissionRefusedError, startRowWire } from "../../../src/backend/runs/start/step-selection.js";
import { startRowsOf } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { emergencyContactMemberModule } from "../../support/helpers/registered-workflows.js";

const { descriptor } = emergencyContactMemberModule;

it("serves a switch for every Emergency Contact member Start row", () => {
  assert.deepEqual(projectStartRows(descriptor).map(({ key, kind, lockReason, off }) => [
    key, kind, lockReason ?? null, off,
  ]), [
    ["contact-plan", "switch", null, "values"],
    ["reference-check", "switch", null, "values"],
    ["contact-preview", "switch", null, "manual"],
    ["onbase-filing", "switch", null, "manual"],
  ]);
});

it("requires typed values when the reference read is switched off", () => {
  const selected = descriptor.timeline.filter(({ key }) => key !== "reference-check").map(({ key }) => key);
  assert.throws(
    () => resolveStartStepOmissions(descriptor, selected, undefined),
    (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-missing",
  );
  assert.throws(
    () => resolveStartStepOmissions(descriptor, selected, [{ step: "reference-check", facts: { referenceResult: "unknown" } }]),
    (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid",
  );
});

it("shows the contact-plan cascade and refuses a direct start that keeps either write", () => {
  const rows = startRowsOf({ steps: projectStartSteps(descriptor), rows: projectStartRows(descriptor).map(startRowWire) });
  assert.equal(rows.find(({ key }) => key === "contact-plan")?.note,
    "Also skips: Preview primary contact changes, Import to OnBase");
  for (const selected of ["contact-preview", "onbase-filing"]) {
    assert.throws(
      () => resolveStartStepOmissions(descriptor, ["reference-check", selected], [
        { step: "contact-plan", facts: { emplId: EMERGENCY_CONTACT_MEMBER_EXAMPLE.record.assertedEid } },
        ...(selected === "contact-preview" ? [{ step: "onbase-filing", facts: {} }] : [{ step: "contact-preview", facts: {} }]),
      ]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "cascade-refused",
    );
  }
});
