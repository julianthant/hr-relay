import { z } from "zod";

export const BoundarySourceSchema = z.enum([
  "config",
  "environment",
  "persistence",
  "http-request",
  "http-response",
  "subscription",
  "artifact",
  "scenario",
]);

export const BoundaryIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const BoundaryFailureSchema = z.strictObject({
  kind: z.literal("boundary-failure"),
  source: BoundarySourceSchema,
  summary: z.string().min(1),
  issues: z.array(BoundaryIssueSchema).min(1),
});

export type BoundaryFailure = z.infer<typeof BoundaryFailureSchema>;
