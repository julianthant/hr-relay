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
