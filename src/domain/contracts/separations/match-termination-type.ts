/**
 * `workflow:separations/match-termination-type` — §4a's refusal, as a real
 * node.
 *
 * The mapping is pure (`src/domain/separations/termination-type.ts`); this
 * contract is what makes an unmapped type a **run outcome** instead of a
 * thrown derivation. That distinction is the whole reason it is a task and not
 * a fold inside the descriptor's `derive`: a `derive` produces a terminal
 * result and has nowhere to put "this run refuses, and here is the closed code
 * and the verbatim value" — but a task does, and its `FailureRecord.code` is
 * the durable fact an operator queries on.
 *
 * It is the `separations` pure workflow mini-store's first task
 * (`separations.md` §2.5): sessionless, artifact-free, provider-free, a fold
 * over a prior node's output. The shape is `person-lookup`'s
 * `read-active-status`.
 *
 * ## Two inputs, and the second one is not decoration
 *
 * The task takes the verbatim type AND the complete option list the run
 * actually observed. The option list is checked against the captured one FIRST,
 * so §4a's accepted operational cost ("if Kuali adds or renames an option, runs
 * on that option fail until the map is extended") fires on the FIRST run that
 * stands in front of a changed control — not on the first run that happens to
 * select the new option. Without it, an added option is invisible until
 * somebody uses it, which is exactly the shape of failure §4a exists to
 * prevent.
 */
import { z } from "zod";
import { taskId } from "../../ids.js";
import {
  TerminationClassificationSchema,
  UcpathTerminationTemplateSchema,
} from "../../separations/termination-type.js";
import { KualiOptionFieldSchema } from "../../ui/kuali-separation-document.js";
import { defineTaskContract } from "../base.js";

export const MatchTerminationTypeOutputSchema = z.strictObject({
  /** The Kuali option text this resolution was keyed by, verbatim. */
  terminationType: z.string().min(1),
  classification: TerminationClassificationSchema,
  template: UcpathTerminationTemplateSchema,
  reasonCode: z.string().min(1),
  /** How many options the observed control carried — the drift check's evidence. */
  observedOptionCount: z.number().int().positive(),
});
export type MatchTerminationTypeOutput = z.infer<typeof MatchTerminationTypeOutputSchema>;

export const SeparationsMatchTerminationType = defineTaskContract({
  id: taskId("workflow:separations/match-termination-type"),
  title: "Match Termination Type",
  effect: "read",
  input: z.strictObject({
    /** The read's own field arm, so a blank type arrives as `absent`, not `""`. */
    terminationType: KualiOptionFieldSchema,
    observedOptions: z.array(z.string().min(1)).min(1),
    documentNumber: z.string().min(1),
  }),
  output: MatchTerminationTypeOutputSchema,
  errorCodes: [
    "blank-termination-type",
    "unmapped-termination-type",
    "unknown-termination-type",
    "termination-type-options-drifted",
  ],
  subject: {
    kind: "none",
    reason: "a pure fold over the separation document this run already read",
  },
  /**
   * A pure transform can never be fresher than its inputs, so it carries no
   * freshness budget of its own; doc 02 §5.5 ages the Kuali checkpoint that
   * feeds it. `Infinity` is written explicitly for that reason.
   */
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: [
    "separations-kuali-read/reads-a-real-separation-document",
    "separations-kuali-read/unknown-termination-type",
  ],
  example: {
    terminationType: "Graduated/No longer a Student",
    classification: "involuntary",
    template: "UC_INVOL_TERM",
    reasonCode: "No Longer Student",
    observedOptionCount: 17,
  },
});
