/**
 * Cross-date run search: the strict browser/server contract over durable run
 * authority. Search never receives row titles, person identifiers, or
 * artifact content; its closed scopes are identifiers and workflow identity.
 */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  IsoInstantSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { RunPrioritySchema, RunShapeSchema } from "../run/envelope.js";
import { ActivityWorkflowRegistrationSchema } from "./activity.js";
import { DashboardWireVersionSchema } from "./primitives.js";

export const CrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow"]);
export const CROSS_DATE_SEARCH_PAGE_LIMIT = 50;
export const CROSS_DATE_SEARCH_QUERY_LIMIT = 160;

/** `terminal` is not a searchable answer; its exact durable outcome is. */
export const CrossDateSearchStateSchema = z.enum([
  "queued", "claimed", "validating", "running", "parked-gate", "parked-write",
  "done", "failed", "cancelled", "partial", "discarded", "interrupted", "superseded",
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
  cursor: z.string().min(1).max(2_048).optional(),
});

export type CrossDateSearchQuery = z.infer<typeof CrossDateSearchQuerySchema>;

export const CROSS_DATE_SEARCH_ORDER = "match-strength/enqueued-desc/run-id-asc:v1" as const;

const CrossDateSearchCursorStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1).max(2_048) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const CrossDateSearchRunNumberSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: PositiveIntSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const CrossDateSearchRetrySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: RunIdSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const CrossDateSearchEndSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const CrossDateSearchSystemsSchema = z.array(BrowserSystemIdSchema)
  .max(BrowserSystemIdSchema.options.length)
  .superRefine((systems, context) => {
    for (let index = 1; index < systems.length; index += 1) {
      if (systems[index - 1] >= systems[index]) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "resolved systems must be unique and sorted",
        });
        return;
      }
    }
  });

export const CrossDateSearchResultSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  registration: ActivityWorkflowRegistrationSchema,
  partitionDay: z.iso.date(),
  state: CrossDateSearchStateSchema,
  shape: RunShapeSchema,
  dryRun: z.boolean(),
  priority: RunPrioritySchema,
  systems: CrossDateSearchSystemsSchema,
  runNumber: CrossDateSearchRunNumberSchema,
  retryOf: CrossDateSearchRetrySchema,
  enqueuedAt: IsoInstantSchema,
  endedAt: CrossDateSearchEndSchema,
  match: z.strictObject({
    field: z.enum(["run", "trace", "workflow"]),
    strength: z.enum(["exact", "prefix", "contains"]),
  }),
});

export type CrossDateSearchResult = z.infer<typeof CrossDateSearchResultSchema>;

export const CrossDateSearchPageSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  generatedAt: IsoInstantSchema,
  snapshot: z.strictObject({
    authorityGeneration: NonNegativeIntSchema,
    order: z.literal(CROSS_DATE_SEARCH_ORDER),
  }),
  totalMatches: NonNegativeIntSchema,
  results: z.array(CrossDateSearchResultSchema).max(CROSS_DATE_SEARCH_PAGE_LIMIT),
  nextCursor: CrossDateSearchCursorStateSchema,
});

export type CrossDateSearchPage = z.infer<typeof CrossDateSearchPageSchema>;
