/**
 * Cross-date run search: the strict browser/server contract over durable run
 * authority. Search never receives row titles, person identifiers, or
 * artifact content; its closed scopes are identifiers and workflow identity.
 */
import { z } from "zod";
import {
  IsoInstantSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
} from "../ids.js";
import { RunPrioritySchema } from "../run/envelope.js";
import { deepFreeze } from "../immutability.js";
import { DashboardWireVersionSchema } from "./primitives.js";

export const CrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow"]);
export const CROSS_DATE_SEARCH_PAGE_LIMIT = 50;
export const CROSS_DATE_SEARCH_QUERY_LIMIT = 160;

/** D283: the exact facet vocabulary measured in the current separations run corpus. */
export const CrossDateSearchWorkflowFacetSchema = z.literal("separations");
export const CrossDateSearchStateFacetSchema = z.enum(["done", "failed", "parked-gate"]);
export const CrossDateSearchShapeFacetSchema = z.literal("single");
export const CrossDateSearchDryRunFacetSchema = z.literal(true);
export const CrossDateSearchSystemFacetSchema = z.enum(["kuali", "new-kronos", "ucpath"]);

export const CrossDateSearchFacetsSchema = z.strictObject({
  workflow: CrossDateSearchWorkflowFacetSchema.optional(),
  day: z.iso.date().optional(),
  state: CrossDateSearchStateFacetSchema.optional(),
  shape: CrossDateSearchShapeFacetSchema.optional(),
  dryRun: CrossDateSearchDryRunFacetSchema.optional(),
  system: CrossDateSearchSystemFacetSchema.optional(),
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
export type CrossDateSearchQueryInput = z.input<typeof CrossDateSearchQuerySchema>;

/**
 * The current bounded corpus is a shared search contract, not a dashboard
 * branch. Browser surfaces consume this exact authority-shaped default without
 * carrying a registered workflow identity of their own.
 */
export function currentCorpusSearchQuery(query: string): CrossDateSearchQueryInput {
  return {
    q: query.trim(),
    scope: "all",
    facets: {
      workflow: CrossDateSearchWorkflowFacetSchema.value,
      shape: CrossDateSearchShapeFacetSchema.value,
      dryRun: CrossDateSearchDryRunFacetSchema.value,
    },
    limit: 20,
  };
}

export const CROSS_DATE_SEARCH_ORDER = "match-strength/enqueued-desc/run-id-asc:v1" as const;
export const CrossDateSearchSnapshotTokenSchema = z.string().min(1).max(2_048);

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

const CrossDateSearchSystemsSchema = z.array(CrossDateSearchSystemFacetSchema)
  .length(CrossDateSearchSystemFacetSchema.options.length)
  .superRefine((systems, context) => {
    for (const [index, expected] of CrossDateSearchSystemFacetSchema.options.entries()) {
      if (systems[index] !== expected) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "resolved systems must exactly match the measured separations registration",
        });
        return;
      }
    }
  });

export const CrossDateSearchRegistrationSchema = z.strictObject({
  state: z.literal("registered"),
  label: z.literal("Separations"),
  code: z.literal("sp"),
  categoryId: z.literal("separation"),
});

export const CrossDateSearchMatchSchema = z.strictObject({
  field: z.enum(["run", "trace", "workflow"]),
  strength: z.enum(["exact", "prefix", "contains"]),
});
export type CrossDateSearchMatch = z.infer<typeof CrossDateSearchMatchSchema>;

/** The one rank vocabulary shared by authority selection and wire validation. */
export const CROSS_DATE_SEARCH_MATCH_ORDER: readonly CrossDateSearchMatch[] = deepFreeze([
  { field: "run", strength: "exact" },
  { field: "trace", strength: "exact" },
  { field: "workflow", strength: "exact" },
  { field: "run", strength: "prefix" },
  { field: "trace", strength: "prefix" },
  { field: "workflow", strength: "prefix" },
  { field: "run", strength: "contains" },
  { field: "trace", strength: "contains" },
  { field: "workflow", strength: "contains" },
] satisfies readonly CrossDateSearchMatch[]);
export const CROSS_DATE_SEARCH_MAX_MATCH_RANK = CROSS_DATE_SEARCH_MATCH_ORDER.length - 1;

export const CrossDateSearchResultSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: CrossDateSearchWorkflowFacetSchema,
  registration: CrossDateSearchRegistrationSchema,
  partitionDay: z.iso.date(),
  state: CrossDateSearchStateFacetSchema,
  shape: CrossDateSearchShapeFacetSchema,
  dryRun: CrossDateSearchDryRunFacetSchema,
  priority: RunPrioritySchema,
  systems: CrossDateSearchSystemsSchema,
  runNumber: CrossDateSearchRunNumberSchema,
  retryOf: CrossDateSearchRetrySchema,
  enqueuedAt: IsoInstantSchema,
  endedAt: CrossDateSearchEndSchema,
  match: CrossDateSearchMatchSchema,
});

export type CrossDateSearchResult = z.infer<typeof CrossDateSearchResultSchema>;

function searchMatchRank(result: CrossDateSearchResult): number {
  const rank = CROSS_DATE_SEARCH_MATCH_ORDER.findIndex(
    (match) => match.field === result.match.field && match.strength === result.match.strength,
  );
  if (rank < 0) throw new Error("search result names a match outside the shared rank vocabulary");
  return rank;
}

export function compareCrossDateSearchResults(
  left: CrossDateSearchResult,
  right: CrossDateSearchResult,
): number {
  return searchMatchRank(left) - searchMatchRank(right)
    || Date.parse(right.enqueuedAt) - Date.parse(left.enqueuedAt)
    || left.runId.localeCompare(right.runId);
}

export const CrossDateSearchPageSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  generatedAt: IsoInstantSchema,
  snapshot: z.strictObject({
    authorityGeneration: NonNegativeIntSchema,
    order: z.literal(CROSS_DATE_SEARCH_ORDER),
    token: CrossDateSearchSnapshotTokenSchema,
  }),
  totalMatches: NonNegativeIntSchema,
  results: z.array(CrossDateSearchResultSchema).max(CROSS_DATE_SEARCH_PAGE_LIMIT),
  nextCursor: CrossDateSearchCursorStateSchema,
}).superRefine((page, context) => {
  if (page.totalMatches < page.results.length) {
    context.addIssue({
      code: "custom",
      path: ["totalMatches"],
      message: "totalMatches cannot be smaller than the returned result count",
    });
  }
  const seen = new Set<string>();
  for (const [index, result] of page.results.entries()) {
    if (seen.has(result.runId)) {
      context.addIssue({
        code: "custom",
        path: ["results", index, "runId"],
        message: `search page repeats run ${result.runId}`,
      });
    }
    seen.add(result.runId);
    const previous = page.results[index - 1];
    if (previous !== undefined && compareCrossDateSearchResults(previous, result) > 0) {
      context.addIssue({
        code: "custom",
        path: ["results", index],
        message: `search page is not ordered by ${CROSS_DATE_SEARCH_ORDER}`,
      });
    }
  }
  if (page.nextCursor.state === "present" && page.results.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["nextCursor"],
      message: "an empty search page cannot carry a continuation cursor",
    });
  }
});

export type CrossDateSearchPage = z.infer<typeof CrossDateSearchPageSchema>;
