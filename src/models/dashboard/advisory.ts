/**
 * The run-advisory wire (ref operator-trust §4.4, D178).
 *
 * It is deliberately NOT a run-detail section. A section is fetched whenever
 * the server advertises it, and an advisory SPENDS a provider budget — so a
 * section would mean every operator who opened a failed run silently made a
 * model call. §4.4 says on-demand, and the wire says it: this document is the
 * answer to one explicit request, and there is no `availableSections` entry
 * that could cause it to be fetched on its own.
 *
 * The document carries the whole invocation record beside the outcome so the
 * surface can frame the advice honestly — which template asked, which model
 * answered, what was digested, when — without a second round trip. It carries
 * no action, no command and no run transition, because an advisory has none
 * to offer.
 */
import { z } from "zod";
import { FailureIdSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { FailureTriageOutcomeSchema } from "../trust/advisory.js";
import { DashboardWireVersionSchema } from "./primitives.js";

export const RunAdvisoryWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  runId: RunIdSchema,
  /** The exact failure the advice is about; a run has no advisory without one. */
  failureId: FailureIdSchema,
  outcome: FailureTriageOutcomeSchema,
});

export type RunAdvisoryWire = z.infer<typeof RunAdvisoryWireSchema>;
