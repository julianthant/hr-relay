import { z } from "zod";
import { deepFreeze } from "./immutability.js";

export const UnscopedCommitReasonIdSchema = z.enum([
  "catalog-global-write",
  "system-global-configuration",
  "document-without-person-scope",
]);

export const UnscopedCommitReasonSpecSchema = z.strictObject({
  id: UnscopedCommitReasonIdSchema,
  reviewed: z.literal(true),
  rationale: z.string().min(1),
});

export const UNSCOPED_COMMIT_REASON_REGISTRY = deepFreeze(UnscopedCommitReasonSpecSchema.array().parse([
  { id: "catalog-global-write", reviewed: true, rationale: "The target is an explicitly global catalog record with no person or artifact subject." },
  { id: "system-global-configuration", reviewed: true, rationale: "The target is a reviewed system-wide configuration surface." },
  { id: "document-without-person-scope", reviewed: true, rationale: "The destination accepts one document whose staged page exposes no stronger subject identity." },
]));

export type UnscopedCommitReasonId = z.infer<typeof UnscopedCommitReasonIdSchema>;
