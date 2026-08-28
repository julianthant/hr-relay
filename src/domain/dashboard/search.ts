/**
 * Cross-date run search: the strict browser/server contract over durable run
 * authority. Search never receives row titles, person identifiers, or
 * artifact content; its closed scopes are identifiers and workflow identity.
 */
import { z } from "zod";
import { BrowserSystemIdSchema, WorkflowIdSchema } from "../ids.js";
import { RunPrioritySchema, RunShapeSchema } from "../run/envelope.js";

export const CrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow"]);
export const CROSS_DATE_SEARCH_PAGE_LIMIT = 50;
export const CROSS_DATE_SEARCH_QUERY_LIMIT = 160;

/** `terminal` is not a searchable answer; its exact durable outcome is. */
export const CrossDateSearchStateSchema = z.enum([
  "queued", "claimed", "validating", "running", "parked-gate", "parked-write",
  "done", "failed", "cancelled", "discarded", "interrupted", "superseded",
]);

export const CrossDateSearchFacetsSchema = z.strictObject({
  workflow: WorkflowIdSchema.optional(),
  day: z.iso.date().optional(),
  state: CrossDateSearchStateSchema.optional(),
  shape: RunShapeSchema.optional(),
  dryRun: z.boolean().optional(),
  priority: RunPrioritySchema.optional(),
  system: BrowserSystemIdSchema.optional(),
});

export const CrossDateSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1)
    .max(CROSS_DATE_SEARCH_QUERY_LIMIT, "query must be at most 160 characters"),
  scope: CrossDateSearchScopeSchema.default("all"),
  facets: CrossDateSearchFacetsSchema.default({}),
  limit: z.number().int().positive()
    .max(CROSS_DATE_SEARCH_PAGE_LIMIT, "page limit must be less than or equal to 50")
    .default(20),
});

export type CrossDateSearchQuery = z.infer<typeof CrossDateSearchQuerySchema>;
