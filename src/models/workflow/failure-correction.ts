import { z } from "zod";
import { assertSchemaOffersPath } from "../validation/contract-boundary.js";
import type { RuntimeFlowNode } from "./graph.js";

export const FailureCorrectionSchema = z.strictObject({
  nodeId: z.string().min(1),
  code: z.string().min(1),
  inputField: z.string().regex(/^[a-z][A-Za-z0-9]*$/u),
  label: z.string().min(1),
  actionLabel: z.string().min(1),
  pattern: z.string().min(1).optional(),
  placeholder: z.string().min(1).optional(),
  /** The rejected value is already shown elsewhere on the wire, so the correction card may prefill it. */
  displaySafe: z.literal(true).optional(),
});
export type FailureCorrection = z.infer<typeof FailureCorrectionSchema>;

export function validateFailureCorrections(input: z.ZodType, nodes: readonly RuntimeFlowNode[], declarations: readonly FailureCorrection[]): readonly FailureCorrection[] {
  const parsed = z.array(FailureCorrectionSchema).parse(declarations);
  const keys = new Set<string>();
  for (const correction of parsed) {
    const node = nodes.find(node => node.id === correction.nodeId);
    if (node?.kind !== "task" || !node.uses.errorCodes.includes(correction.code)) throw new Error("failure correction names an unknown node or failure code");
    assertSchemaOffersPath(input, correction.inputField, "failure correction input");
    if (correction.pattern !== undefined) new RegExp(correction.pattern, "u");
    const key = `${correction.nodeId}/${correction.code}`;
    if (keys.has(key)) throw new Error("duplicate failure correction");
    keys.add(key);
  }
  return Object.freeze(parsed.map(value => Object.freeze(value)));
}

/** A gate whose operator may type this input instead of picking a served row; the typed value starts a lookup, never an answer. */
export const GateCorrectionSchema = z.strictObject({
  gateId: z.string().min(1),
  inputField: FailureCorrectionSchema.shape.inputField,
  label: z.string().min(1),
  placeholder: z.string().min(1),
  pattern: z.string().min(1),
});
export type GateCorrection = z.infer<typeof GateCorrectionSchema>;

export function validateGateCorrections(input: z.ZodType, nodes: readonly RuntimeFlowNode[], declarations: readonly GateCorrection[]): readonly GateCorrection[] {
  const parsed = z.array(GateCorrectionSchema).parse(declarations);
  const gates = new Set<string>();
  for (const correction of parsed) {
    if (nodes.find(node => String(node.id) === correction.gateId)?.kind !== "gate") throw new Error("gate correction names an unknown gate");
    assertSchemaOffersPath(input, correction.inputField, "gate correction input");
    new RegExp(correction.pattern, "u");
    if (gates.has(correction.gateId)) throw new Error("duplicate gate correction");
    gates.add(correction.gateId);
  }
  return Object.freeze(parsed.map(value => Object.freeze(value)));
}
