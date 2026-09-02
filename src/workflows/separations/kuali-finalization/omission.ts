/**
 * D307 — omitting the Kuali finalization step.
 *
 * Nothing downstream reads the finalization but the terminal result, so the
 * step needs no typed fact: the transaction is simply not run, and the result
 * carries an `omitted` arm where the saved-state proof would be. The operator
 * finalizes the document by hand.
 */
import type { StepOmissionDeclaration } from "../../../domain/workflow/step-omission.js";

export const KUALI_FINALIZATION_OMISSION: StepOmissionDeclaration = {
  form: { fields: [] },
  produces: {},
};
