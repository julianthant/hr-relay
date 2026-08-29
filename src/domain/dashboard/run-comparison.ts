import { z } from "zod";
import { JsonValueSchema } from "../canonical-json.js";
import {
  EvidenceReceiptIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { ReceiptComparisonFactIdSchema } from "../trust/receipt-comparison.js";
import { DashboardWireVersionSchema } from "./primitives.js";

const ComparisonFactBase = {
  factId: ReceiptComparisonFactIdSchema,
  label: z.string().min(1),
} as const;

export const ReceiptComparisonFactWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...ComparisonFactBase,
    state: z.literal("added"),
    after: JsonValueSchema,
  }),
  z.strictObject({
    ...ComparisonFactBase,
    state: z.literal("removed"),
    before: JsonValueSchema,
  }),
  z.strictObject({
    ...ComparisonFactBase,
    state: z.literal("changed"),
    before: JsonValueSchema,
    after: JsonValueSchema,
  }),
  z.strictObject({
    ...ComparisonFactBase,
    state: z.literal("withheld"),
  }),
]);

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
