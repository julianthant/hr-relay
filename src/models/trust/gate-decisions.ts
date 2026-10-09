/** Declared gate decisions: how a stored `gate_results` row becomes the receipt's decision-evidence row, with each gate decision scoped by its own workflow and gate. */
import { z } from "zod";
import { GateIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
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
    /* The leaf whose value names the arm the operator took, in the same vocabulary the redaction table and the provenance rows use, so a declaration naming an absent path fails at parse. */
  decisionPath: EvidenceLeafPathSchema,
  arms: z.array(GateDecisionArmSchema).min(1),
    /* The leaf carrying the evidence the decision was bound to, when the gate declares one; the identity gate does, and the digest is the load-bearing half. */
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
    /* The name-resolved identity approval: a supplied EID creates no gate row, and when this gate does open, `rejected` terminalizes the run, so both arms are real outcomes. */
  {
    workflowId: "separations-identity-check",
    gateId: "identity-approval",
    decisionPath: "decision",
    arms: [
      {
        value: "approved",
        outcome: "approved",
        summary: "an operator approved this name-resolved identity",
      },
      {
        value: "rejected",
        outcome: "rejected",
        summary: "an operator REJECTED this name-resolved identity",
      },
    ],
    boundEvidencePath: "evidenceDigest",
  },
  {
      /* This gate needs its own declaration rather than inheriting another's, because a gate decision is scoped by `(workflow, gate)` on purpose. */
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
      /* This gate declares its own answer for its workflow; what `rejected` means here is different again, because no separation is recorded on the source document when it fires. */
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
      /* The composition declares its own answer, and the repetition earns the most here because this gate dominates THREE real writes across two systems. */
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
