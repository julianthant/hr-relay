/**
 * Cross-date run search: the strict browser/server contract over durable run
 * authority. Search never receives row titles, person identifiers, or
 * artifact content; its closed scopes are identifiers and workflow identity.
 */
import { z } from "zod";

export const CrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow"]);

export const CrossDateSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1),
  scope: CrossDateSearchScopeSchema.default("all"),
  facets: z.strictObject({}).default({}),
  limit: z.number().int().positive().default(20),
});

export type CrossDateSearchQuery = z.infer<typeof CrossDateSearchQuerySchema>;
