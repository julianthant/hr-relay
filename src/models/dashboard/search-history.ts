/** Cross-date run search: the strict browser/server contract over durable run authority; search never receives row titles, person identifiers, or artifact content. */
import { z } from "zod";
import {
  IsoInstantSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
} from "../../rules/identity/ids.js";
import { RunPrioritySchema } from "../run/envelope.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { DashboardWireVersionSchema } from "./primitives.js";

export const HistoricalCrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow"]);
export const HISTORICAL_CROSS_DATE_SEARCH_PAGE_LIMIT = 50;
export const HISTORICAL_CROSS_DATE_SEARCH_QUERY_LIMIT = 160;

/** The exact facet vocabulary measured in the current separations run corpus. */
export const HistoricalCrossDateSearchWorkflowFacetSchema = z.literal("separations");
export const HistoricalCrossDateSearchStateFacetSchema = z.enum(["done", "failed", "parked-gate"]);
export const HistoricalCrossDateSearchShapeFacetSchema = z.literal("single");
export const HistoricalCrossDateSearchDryRunFacetSchema = z.literal(true);
export const HistoricalCrossDateSearchSystemFacetSchema = z.enum(["kuali", "new-kronos", "ucpath"]);

export const HistoricalCrossDateSearchFacetsSchema = z.strictObject({
  workflow: HistoricalCrossDateSearchWorkflowFacetSchema.optional(),
  day: z.iso.date().optional(),
  state: HistoricalCrossDateSearchStateFacetSchema.optional(),
  shape: HistoricalCrossDateSearchShapeFacetSchema.optional(),
  dryRun: HistoricalCrossDateSearchDryRunFacetSchema.optional(),
  system: HistoricalCrossDateSearchSystemFacetSchema.optional(),
});

export const HistoricalCrossDateSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1)
    .max(HISTORICAL_CROSS_DATE_SEARCH_QUERY_LIMIT, "query must be at most 160 characters"),
  scope: HistoricalCrossDateSearchScopeSchema.default("all"),
  facets: HistoricalCrossDateSearchFacetsSchema.default({}),
  limit: z.number().int().positive()
    .max(HISTORICAL_CROSS_DATE_SEARCH_PAGE_LIMIT, "page limit must be less than or equal to 50")
    .default(20),
  cursor: z.string().min(1).max(2_048).optional(),
});

export type HistoricalCrossDateSearchQuery = z.infer<typeof HistoricalCrossDateSearchQuerySchema>;
export type HistoricalCrossDateSearchQueryInput = z.input<typeof HistoricalCrossDateSearchQuerySchema>;

/** The current bounded corpus is a shared search contract, not a dashboard branch. */
export function historicalCorpusSearchQuery(query: string): HistoricalCrossDateSearchQueryInput {
  return {
    q: query.trim(),
    scope: "all",
    facets: {
      workflow: HistoricalCrossDateSearchWorkflowFacetSchema.value,
      shape: HistoricalCrossDateSearchShapeFacetSchema.value,
      dryRun: HistoricalCrossDateSearchDryRunFacetSchema.value,
    },
    limit: 20,
  };
}

export const HISTORICAL_CROSS_DATE_SEARCH_ORDER = "match-strength/enqueued-desc/run-id-asc:v1" as const;
export const HistoricalCrossDateSearchSnapshotTokenSchema = z.string().min(1).max(2_048);

const HistoricalCrossDateSearchCursorStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1).max(2_048) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const HistoricalCrossDateSearchRunNumberSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: PositiveIntSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const HistoricalCrossDateSearchRetrySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: RunIdSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const HistoricalCrossDateSearchEndSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const HistoricalCrossDateSearchSystemsSchema = z.array(HistoricalCrossDateSearchSystemFacetSchema)
  .length(HistoricalCrossDateSearchSystemFacetSchema.options.length)
  .superRefine((systems, context) => {
    for (const [index, expected] of HistoricalCrossDateSearchSystemFacetSchema.options.entries()) {
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

export const HistoricalCrossDateSearchRegistrationSchema = z.strictObject({
  state: z.literal("registered"),
  label: z.literal("Separations"),
  code: z.literal("sp"),
  categoryId: z.literal("separation"),
});

export const HistoricalCrossDateSearchMatchSchema = z.strictObject({
  field: z.enum(["run", "trace", "workflow"]),
  strength: z.enum(["exact", "prefix", "contains"]),
});
export type HistoricalCrossDateSearchMatch = z.infer<typeof HistoricalCrossDateSearchMatchSchema>;

/** The one rank vocabulary shared by authority selection and wire validation. */
export const HISTORICAL_CROSS_DATE_SEARCH_MATCH_ORDER: readonly HistoricalCrossDateSearchMatch[] = deepFreeze([
  { field: "run", strength: "exact" },
  { field: "trace", strength: "exact" },
  { field: "workflow", strength: "exact" },
  { field: "run", strength: "prefix" },
  { field: "trace", strength: "prefix" },
  { field: "workflow", strength: "prefix" },
  { field: "run", strength: "contains" },
  { field: "trace", strength: "contains" },
  { field: "workflow", strength: "contains" },
] satisfies readonly HistoricalCrossDateSearchMatch[]);
export const HISTORICAL_CROSS_DATE_SEARCH_MAX_MATCH_RANK = HISTORICAL_CROSS_DATE_SEARCH_MATCH_ORDER.length - 1;

export const HistoricalCrossDateSearchResultSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: HistoricalCrossDateSearchWorkflowFacetSchema,
  registration: HistoricalCrossDateSearchRegistrationSchema,
  partitionDay: z.iso.date(),
  state: HistoricalCrossDateSearchStateFacetSchema,
  shape: HistoricalCrossDateSearchShapeFacetSchema,
  dryRun: HistoricalCrossDateSearchDryRunFacetSchema,
  priority: RunPrioritySchema,
  systems: HistoricalCrossDateSearchSystemsSchema,
  runNumber: HistoricalCrossDateSearchRunNumberSchema,
  retryOf: HistoricalCrossDateSearchRetrySchema,
  enqueuedAt: IsoInstantSchema,
  endedAt: HistoricalCrossDateSearchEndSchema,
  match: HistoricalCrossDateSearchMatchSchema,
});

export type HistoricalCrossDateSearchResult = z.infer<typeof HistoricalCrossDateSearchResultSchema>;

function searchMatchRank(result: HistoricalCrossDateSearchResult): number {
  const rank = HISTORICAL_CROSS_DATE_SEARCH_MATCH_ORDER.findIndex(
    (match) => match.field === result.match.field && match.strength === result.match.strength,
  );
  if (rank < 0) throw new Error("search result names a match outside the shared rank vocabulary");
  return rank;
}

export function compareHistoricalCrossDateSearchResults(
  left: HistoricalCrossDateSearchResult,
  right: HistoricalCrossDateSearchResult,
): number {
  return searchMatchRank(left) - searchMatchRank(right)
    || Date.parse(right.enqueuedAt) - Date.parse(left.enqueuedAt)
    || left.runId.localeCompare(right.runId);
}

export const HistoricalCrossDateSearchPageSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  generatedAt: IsoInstantSchema,
  snapshot: z.strictObject({
    authorityGeneration: NonNegativeIntSchema,
    order: z.literal(HISTORICAL_CROSS_DATE_SEARCH_ORDER),
    token: HistoricalCrossDateSearchSnapshotTokenSchema,
  }),
  totalMatches: NonNegativeIntSchema,
  results: z.array(HistoricalCrossDateSearchResultSchema).max(HISTORICAL_CROSS_DATE_SEARCH_PAGE_LIMIT),
  nextCursor: HistoricalCrossDateSearchCursorStateSchema,
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
    if (previous !== undefined && compareHistoricalCrossDateSearchResults(previous, result) > 0) {
      context.addIssue({
        code: "custom",
        path: ["results", index],
        message: `search page is not ordered by ${HISTORICAL_CROSS_DATE_SEARCH_ORDER}`,
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

export type HistoricalCrossDateSearchPage = z.infer<typeof HistoricalCrossDateSearchPageSchema>;
