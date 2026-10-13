/** Declared cross-source verification obligations: the receipt carries the SERVER's verdict on a declared obligation, so the operator never has to open UCPath to compare two numbers. */
import { z } from "zod";
import { NodeIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import { EvidenceLeafPathSchema } from "./evidence-classification.js";

export const EvidenceObligationSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-result"), path: EvidenceLeafPathSchema }),
  z.strictObject({ kind: z.literal("workflow-input"), path: EvidenceLeafPathSchema }),
  z.strictObject({ kind: z.literal("node-output"), nodeId: NodeIdSchema, path: z.union([EvidenceLeafPathSchema, z.literal("records.0.emplId")]) }),
]);
export type EvidenceObligationSource = z.infer<typeof EvidenceObligationSourceSchema>;

/** Ref operator-trust's `VerificationEvidence.obligation` grammar. */
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
    /* person-lookup: `cross-verify` exists so a second system independently displays the same EID, and the receipt states that verdict. */
  {
    rule: "all-equal",
    workflowId: "person-lookup",
    obligation: "identity.eid-agrees-across-sources",
    mandatory: true,
    sources: [
      { kind: "workflow-result", path: "activeStatus.details.eid" },
      { kind: "node-output", nodeId: "crm-selected-record", path: "records.0.emplId" },
    ],
    summary: "the EID UCPath selected and the EID the CRM record displays are the same person",
  },
  {
    rule: "equals-literal",
    workflowId: "person-lookup",
    obligation: "identity.ucpath-selection-is-unambiguous",
    mandatory: true,
    sources: [{ kind: "workflow-result", path: "activeStatus.ucpathSelection" }],
    literal: "resolved",
    summary: "UCPath resolved exactly one person; an ambiguous or empty search is not a selection",
  },

    /* separations-kuali-finalization: these obligations bind the durable reload proof back to the ingress rather than trusting the click. */
  {
    rule: "all-equal",
    workflowId: "separations-kuali-finalization",
    obligation: "write.timekeeper-matches-request",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "timekeeperName" },
      { kind: "node-output", nodeId: "finalize-kuali", path: "savedState.fields.timekeeperName" },
    ],
    summary: "the finalization proof holds the exact timekeeper name that was requested",
  },
  {
    rule: "all-equal",
    workflowId: "separations-kuali-finalization",
    obligation: "identity.eid-agrees-across-sources",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "emplId" },
      { kind: "node-output", nodeId: "finalize-kuali", path: "savedState.observedEid" },
    ],
    summary: "the finalized document displays the EID identity authority established",
  },
  {
    rule: "all-equal",
    workflowId: "separations-kuali-finalization",
    obligation: "write.document-matches-request",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "documentNumber" },
      { kind: "node-output", nodeId: "finalize-kuali", path: "savedState.documentNumber" },
    ],
    summary: "the reload proof names the document that was requested",
  },
  {
    rule: "all-equal",
    workflowId: "separations-kuali-finalization",
    obligation: "write.transaction-matches-request",
    mandatory: true,
    sources: [
      { kind: "workflow-input", path: "transactionNumber" },
      { kind: "node-output", nodeId: "finalize-kuali", path: "savedState.fields.transactionNumber" },
    ],
    summary: "the reload proof holds the UCPath transaction number that was requested",
  },
  {
    rule: "equals-literal",
    workflowId: "separations-kuali-finalization",
    obligation: "write.proof-is-a-read-back",
    mandatory: true,
    sources: [{ kind: "node-output", nodeId: "finalize-kuali", path: "savedState.source" }],
    literal: "reload-read-back",
    summary: "the finalization was proved by reloading the document and reading it back, not by a click",
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
