/**
 * Declared cross-source verification obligations (D140) — the half of doc 12
 * §2.3 that makes a receipt a double-check rather than a transcript.
 *
 * D82's bar is that the operator finishes their double-check WITHOUT opening
 * UCPath. Printing what each system said is not enough: the operator would
 * still have to compare the values themselves, and comparing two redacted
 * identifiers by eye is exactly the check a machine should have already done.
 *
 * So the receipt carries the SERVER's verdict on a declared obligation, with
 * the durable facts it compared. Each obligation names its sources by
 * `(nodeId | workflow input, dotted path)` — the same path vocabulary the
 * checkpoint provenance uses — and a closed rule. Nothing here inspects a
 * value's NAME to decide what it means; a comparison exists because it was
 * declared, and a workflow with no declared obligation truthfully carries none
 * rather than a fabricated green tick.
 *
 * A source that is absent (its node did not run, or its union arm does not
 * carry that path) is reported as absent. It never silently shrinks the
 * comparison to one side and calls the result agreement.
 */
import { z } from "zod";
import { NodeIdSchema, WorkflowIdSchema } from "../ids.js";
import { EvidenceLeafPathSchema } from "./evidence-classification.js";

export const EvidenceObligationSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-input"), path: EvidenceLeafPathSchema }),
  z.strictObject({ kind: z.literal("node-output"), nodeId: NodeIdSchema, path: EvidenceLeafPathSchema }),
]);
export type EvidenceObligationSource = z.infer<typeof EvidenceObligationSourceSchema>;

/** Doc 12's `VerificationEvidence.obligation` grammar. */
export const ObligationIdSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/,
  "obligation id must be dot/dash-delimited lowercase",
);

export const EvidenceObligationSchema = z.discriminatedUnion("rule", [
  z.strictObject({
    rule: z.literal("all-equal"),
    workflowId: WorkflowIdSchema,
    obligation: ObligationIdSchema,
    mandatory: z.boolean(),
    /** At least two, or "they all agree" would be a claim about one value. */
    sources: z.array(EvidenceObligationSourceSchema).min(2),
    summary: z.string().min(1),
  }),
  z.strictObject({
    rule: z.literal("equals-literal"),
    workflowId: WorkflowIdSchema,
    obligation: ObligationIdSchema,
    mandatory: z.boolean(),
    sources: z.array(EvidenceObligationSourceSchema).length(1),
    literal: z.string().min(1),
    summary: z.string().min(1),
  }),
]);
export type EvidenceObligation = z.infer<typeof EvidenceObligationSchema>;

export const EVIDENCE_OBLIGATIONS: readonly EvidenceObligation[] = Object.freeze([
  /* person-lookup: the whole point of `cross-verify` is that a second system
     independently displays the same EID. The receipt states that verdict, so
     the operator never has to open UCPath to compare two numbers. */
  {
    rule: "all-equal",
    workflowId: "person-lookup",
    obligation: "identity.eid-agrees-across-sources",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "emplId" },
      { kind: "node-output", nodeId: "searching", path: "selection.selected.emplId" },
      { kind: "node-output", nodeId: "cross-verify", path: "record.emplId" },
    ],
    summary: "the EID UCPath selected and the EID the CRM record displays are the same person",
  },
  {
    rule: "equals-literal",
    workflowId: "person-lookup",
    obligation: "identity.ucpath-selection-is-unambiguous",
    mandatory: true,
    sources: [{ kind: "node-output", nodeId: "searching", path: "selection.status" }],
    literal: "resolved",
    summary: "UCPath resolved exactly one person; an ambiguous or empty search is not a selection",
  },

  /* kuali-timekeeper-annotation: the operator authorized ONE value on ONE
     document for ONE person. All three are answerable from durable facts. */
  {
    rule: "all-equal",
    workflowId: "kuali-timekeeper-annotation",
    obligation: "write.value-matches-request",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "timekeeperName" },
      { kind: "node-output", nodeId: "annotate-timekeeper", path: "savedState.timekeeperName" },
    ],
    summary: "the value the document now holds is byte-identical to the value that was requested",
  },
  {
    rule: "all-equal",
    workflowId: "kuali-timekeeper-annotation",
    obligation: "identity.eid-agrees-across-sources",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "emplId" },
      { kind: "node-output", nodeId: "annotate-timekeeper", path: "savedState.observedEid" },
    ],
    summary: "the document the write landed on displays the EID the operator named",
  },
  {
    rule: "all-equal",
    workflowId: "kuali-timekeeper-annotation",
    obligation: "write.document-matches-request",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "documentNumber" },
      { kind: "node-output", nodeId: "annotate-timekeeper", path: "savedState.documentNumber" },
    ],
    summary: "the document number the page proved is the document number that was requested",
  },
  {
    rule: "equals-literal",
    workflowId: "kuali-timekeeper-annotation",
    obligation: "write.proof-is-a-read-back",
    mandatory: true,
    sources: [{ kind: "node-output", nodeId: "annotate-timekeeper", path: "savedState.source" }],
    literal: "reload-read-back",
    summary: "the saved value was proved by reloading the document and reading it back, not by a click",
  },
].map((entry) => Object.freeze(EvidenceObligationSchema.parse(entry))));

const BY_WORKFLOW = new Map<string, EvidenceObligation[]>();
for (const obligation of EVIDENCE_OBLIGATIONS) {
  const existing = BY_WORKFLOW.get(obligation.workflowId);
  if (existing === undefined) BY_WORKFLOW.set(obligation.workflowId, [obligation]);
  else {
    if (existing.some((entry) => entry.obligation === obligation.obligation)) {
      throw new Error(
        `workflow ${obligation.workflowId} declares obligation ${obligation.obligation} twice`,
      );
    }
    existing.push(obligation);
  }
}

export function obligationsFor(workflowId: string): readonly EvidenceObligation[] {
  return Object.freeze([...(BY_WORKFLOW.get(workflowId) ?? [])]);
}
