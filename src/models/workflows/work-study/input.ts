import { z } from "zod";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { InputParserSpecSchema, TypedInputSurfaceSchema } from "../../workflow/ingress.js";

export const WorkStudyInput = z.strictObject({
  emplId: CANONICAL_FIELDS.eid.schema,
  effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
});
export const WorkStudyCanonicalInput = defineCanonicalInput(WorkStudyInput, WorkStudyInput, [
  { emplId: "10000001", effectiveDate: "2026-08-03" },
]);
export type WorkStudyInputValue = z.output<typeof WorkStudyInput>;
export const WORK_STUDY_INPUT_PARSER = InputParserSpecSchema.parse({
  split: { kind: "delimited", delimiters: [",", ";", "\n"] },
  rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
});
export const WORK_STUDY_TYPED_INPUT = TypedInputSurfaceSchema.parse({
  modeField: "mode", modeLabel: "Input", initialMode: "employee-ids", submitsMode: false,
  description: "Each Employee ID starts one run; every run uses the one effective date.",
  modes: [{
    value: "employee-ids", label: "Employee IDs", inputLabel: "Employee IDs", hint: "Separate IDs with commas, semicolons or new lines.",
    placeholder: "10000001, 10000002", defaults: [], parser: { kind: "entries", spec: WORK_STUDY_INPUT_PARSER },
    display: { kind: "first-present", fields: ["emplId"] }, identityFields: ["emplId"],
  }],
  controls: [{ kind: "date", field: "effectiveDate", label: "Effective date", placement: "input", modes: ["employee-ids"], requires: [],
    required: true, refusal: "Choose a valid effective date." }],
});
