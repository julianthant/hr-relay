/**
 * Cross-date run search: the strict browser/server contract over durable run
 * authority. Search never receives row titles, person identifiers, or
 * artifact content; its closed scopes are identifiers and workflow identity.
 */
import { z } from "zod";

export const CrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow"]);
export const CROSS_DATE_SEARCH_PAGE_LIMIT = 50;
export const CROSS_DATE_SEARCH_QUERY_LIMIT = 160;

export const CrossDateSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1)
    .max(CROSS_DATE_SEARCH_QUERY_LIMIT, "query must be at most 160 characters"),
  scope: CrossDateSearchScopeSchema.default("all"),
  facets: z.strictObject({}).default({}),
  limit: z.number().int().positive()
    .max(CROSS_DATE_SEARCH_PAGE_LIMIT, "page limit must be less than or equal to 50")
    .default(20),
});

export type CrossDateSearchQuery = z.infer<typeof CrossDateSearchQuerySchema>;
