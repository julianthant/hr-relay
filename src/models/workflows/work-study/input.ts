import { z } from "zod";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { InputParserSpecSchema } from "../../workflow/ingress.js";

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
