import { z } from "zod";
import {
  EvidenceReceiptIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { ReceiptComparisonFactSchema } from "../trust/receipt-comparison.js";
import { DashboardWireVersionSchema } from "./primitives.js";

export const ReceiptComparisonFactWireSchema = ReceiptComparisonFactSchema;

/** The current receipt selection the browser may use to request a comparison. */
export const RunReceiptComparisonTargetSchema = z.strictObject({
  runId: RunIdSchema,
  retryOf: RunIdSchema,
  workflowId: WorkflowIdSchema,
  currentReceiptId: EvidenceReceiptIdSchema,
});

export type RunReceiptComparisonTarget = z.infer<typeof RunReceiptComparisonTargetSchema>;

export const RunReceiptComparisonWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  runId: RunIdSchema,
  retryOf: RunIdSchema,
  workflowId: WorkflowIdSchema,
  currentReceiptId: EvidenceReceiptIdSchema,
  priorReceiptId: EvidenceReceiptIdSchema,
  facts: z.array(ReceiptComparisonFactWireSchema),
}).superRefine((comparison, context) => {
  const factIds = comparison.facts.map(({ factId }) => factId);
  if (new Set(factIds).size !== factIds.length) {
    context.addIssue({ code: "custom", path: ["facts"], message: "comparison fact ids must be unique" });
  }
});

export type RunReceiptComparisonWire = z.infer<typeof RunReceiptComparisonWireSchema>;
