/**
 * Declared gate decisions (D204) — how a stored `gate_results` row becomes the
 * receipt's `DecisionEvidence` row, ref operator-trust §2.3 over ref write-safety §14.6 risk 6.
 *
 * ## Why this is declared rather than derived
 *
 * A gate's result payload is authored on the gate node, so its shape is
 * workflow-specific: `IdentityApprovalResultSchema` happens to discriminate on
 * `decision`, and the next gate this program grows will not. The receipt's
 * `DecisionEvidence.outcome` is a CLOSED five-value enum, so turning one into
 * the other is a mapping, and there are only two honest ways to have one:
 *
 * 1. Sniff the payload for a field called `decision` and hope its values line
 *    up with the enum. That is the "plausible-but-wrong value" this program
 *    forbids: a gate whose payload said `{ decision: "deferred" }` would land
 *    on the receipt as `approved` or as nothing at all, and both read as a
 *    statement about a human decision that the human did not make.
 * 2. Declare it, once, beside the redaction and obligation tables it sits with
 *    — which is exactly D140's shape for the same reason.
 *
 * So a gate is declared here or its rows do not reach the receipt: an
 * undeclared gate, and an arm value no declaration lists, both fail LOUD. That
 * is the same rule `classifyEvidenceLeaf` applies to an undeclared leaf, and it
 * costs one reviewed entry per gate — of which this tree has exactly one.
 *
 * ## What is NOT here
 *
 * The approver and the instant. They are not payload facts and never become
 * one: the command kernel writes `resolvedBy`/`resolvedAt` onto the durable row
 * inside the same transaction that stores the result (`executeResolveGate`,
 * D202), and the receipt reads them from there. Nothing in this file can move
 * them.
 */
import { z } from "zod";
import { GateIdSchema, WorkflowIdSchema } from "../ids.js";
import { EvidenceLeafPathSchema } from "./evidence-classification.js";

/** Exactly `DecisionEvidenceSchema.outcome`'s arms — no wider, no narrower. */
export const GateDecisionOutcomeSchema = z.enum([
  "taken", "not-taken", "blocked", "approved", "rejected",
]);
export type GateDecisionOutcome = z.infer<typeof GateDecisionOutcomeSchema>;

export const GateDecisionArmSchema = z.strictObject({
  /** The exact stored value at `decisionPath`, compared verbatim. */
  value: z.string().min(1),
  outcome: GateDecisionOutcomeSchema,
  /** The receipt sentence this arm leads with, in the operator's language. */
  summary: z.string().min(1),
});

export const GateDecisionDeclarationSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  gateId: GateIdSchema,
  /**
   * The leaf whose value names the arm the operator took. It is a leaf path in
   * the same vocabulary the redaction table and the provenance rows use, so a
   * declaration that names a path the payload does not carry fails at
   * derivation time rather than producing a decision about nothing.
   */
  decisionPath: EvidenceLeafPathSchema,
  arms: z.array(GateDecisionArmSchema).min(1),
  /**
   * The leaf carrying the evidence the decision was bound to, when the gate
   * declares one. The identity gate does: an approval is an observation of a
   * SPECIFIC packet (ref write-safety §14.5), so the digest is the load-bearing half of
   * "what did they actually approve".
   */
  boundEvidencePath: EvidenceLeafPathSchema.optional(),
}).superRefine((declaration, context) => {
  const values = declaration.arms.map((arm) => arm.value);
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path: ["arms"],
      message: "a gate decision arm value is declared twice; one stored value has one outcome",
    });
  }
});
export type GateDecisionDeclaration = z.infer<typeof GateDecisionDeclarationSchema>;

export const GATE_DECISIONS: readonly GateDecisionDeclaration[] = Object.freeze([
  /**
   * The ALWAYS-GATE identity approval (ref write-safety §14.4). `rejected` terminalizes
   * the run, so both arms are real outcomes an operator-facing record must be
   * able to state — a receipt that could only describe approvals would be a
   * receipt that never shows a refusal.
   */
  {
    workflowId: "separations-identity-check",
    gateId: "identity-approval",
    decisionPath: "decision",
    arms: [
      {
        value: "approved",
        outcome: "approved",
        summary: "an operator approved this identity at the ALWAYS-GATE",
      },
      {
        value: "rejected",
        outcome: "rejected",
        summary: "an operator REJECTED this identity at the ALWAYS-GATE",
      },
    ],
    boundEvidencePath: "evidenceDigest",
  },
  {
    /**
     * Chunk 4's write carries the SAME ALWAYS-GATE, and it needs its own
     * declaration rather than inheriting chunk 3's: a gate decision is scoped by
     * `(workflow, gate)` on purpose (D204), because the payload is authored per
     * gate and a second workflow reusing a schema is not the same thing as a
     * second workflow having answered the question.
     *
     * Here the stakes are also higher: this gate stands in front of a real
     * UCPath termination rather than in front of a read-only chunk's result, so
     * `rejected` means an operator refused to let a person be separated.
     */
    workflowId: "separations-ucpath-termination",
    gateId: "identity-approval",
    decisionPath: "decision",
    arms: [
      {
        value: "approved",
        outcome: "approved",
        summary: "an operator approved this identity before the UCPath termination was filed",
      },
      {
        value: "rejected",
        outcome: "rejected",
        summary: "an operator REJECTED this identity, so no UCPath termination was filed",
      },
    ],
    boundEvidencePath: "evidenceDigest",
  },
  {
    /**
     * Chunk 5's Kuali finalization, declaring its own answer for the third time
     * — and the repetition is the contract, not an oversight (D204). What
     * `rejected` means here is different again: no separation is recorded on the
     * source document, so the UCPath termination this run was going to cite
     * stays unattributed on the Kuali record an auditor reads.
     */
    workflowId: "separations-kuali-finalization",
    gateId: "identity-approval",
    decisionPath: "decision",
    arms: [
      {
        value: "approved",
        outcome: "approved",
        summary: "an operator approved this identity before the Kuali document was finalized",
      },
      {
        value: "rejected",
        outcome: "rejected",
        summary: "an operator REJECTED this identity, so the Kuali document was not finalized",
      },
    ],
    boundEvidencePath: "evidenceDigest",
  },
  {
    /**
     * Chunk 6's COMPOSITION, declaring its own answer for the fourth time — and
     * here the repetition earns the most, because this gate is the only one
     * whose approval dominates THREE real writes across two systems. What
     * `rejected` means: no pending sweep, no UCPath termination and no Kuali
     * finalization happen at all, so the separation the department filed stays
     * exactly as they left it.
     */
    workflowId: "separations",
    gateId: "identity-approval",
    decisionPath: "decision",
    arms: [
      {
        value: "approved",
        outcome: "approved",
        summary: "an operator approved this identity, and the write plan it consumes, before any "
          + "termination was filed",
      },
      {
        value: "rejected",
        outcome: "rejected",
        summary: "an operator REJECTED this identity, so no termination was filed and the Kuali "
          + "document was left untouched",
      },
    ],
    boundEvidencePath: "evidenceDigest",
  },
].map((entry) => Object.freeze(GateDecisionDeclarationSchema.parse(entry))));

const BY_WORKFLOW_AND_GATE = new Map<string, GateDecisionDeclaration>();
for (const declaration of GATE_DECISIONS) {
  const key = `${declaration.workflowId}\u0000${declaration.gateId}`;
  if (BY_WORKFLOW_AND_GATE.has(key)) {
    throw new Error(
      `gate decision for ${declaration.workflowId}/${declaration.gateId} is declared twice`,
    );
  }
  BY_WORKFLOW_AND_GATE.set(key, declaration);
}

export function findGateDecision(
  workflowId: string,
  gateId: string,
): GateDecisionDeclaration | undefined {
  return BY_WORKFLOW_AND_GATE.get(`${workflowId}\u0000${gateId}`);
}

/** The declaration, or a loud refusal naming the exact gap. */
export function gateDecisionFor(workflowId: string, gateId: string): GateDecisionDeclaration {
  const declaration = findGateDecision(workflowId, gateId);
  if (declaration === undefined) {
    throw new Error(
      `no declared gate decision for ${workflowId}/${gateId}; add it to `
      + "src/domain/trust/gate-decisions.ts — a receipt never guesses what a human decided",
    );
  }
  return declaration;
}

/** The arm the stored value took, or a loud refusal naming what was stored. */
export function gateDecisionArm(
  declaration: GateDecisionDeclaration,
  storedValue: unknown,
): z.infer<typeof GateDecisionArmSchema> {
  const arm = typeof storedValue === "string"
    ? declaration.arms.find((candidate) => candidate.value === storedValue)
    : undefined;
  if (arm === undefined) {
    throw new Error(
      `gate ${declaration.workflowId}/${declaration.gateId} stored `
      + `${JSON.stringify(storedValue)} at "${declaration.decisionPath}", and no declared arm `
      + `matches it (declared: ${declaration.arms.map((candidate) => candidate.value).join(", ")}); `
      + "refusing to describe a human decision this build does not recognise",
    );
  }
  return arm;
}
