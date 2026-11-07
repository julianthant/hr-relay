/** Compare the complete observed options so a changed control refuses immediately. */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import {
  TerminationClassificationSchema,
  UcpathTerminationTemplateSchema,
} from "../../../rules/separations/termination-type.js";
import { KualiOptionFieldSchema } from "../../ui/kuali-separation-document.js";
import { defineTaskContract } from "../../task/task-contract.js";

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
    /* A pure transform can never be fresher than its inputs, so it carries no freshness budget of its own. */
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
