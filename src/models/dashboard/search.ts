/**
 * Cross-date run search: the strict browser/server contract over durable run
 * authority. Public declared subject names and authentic recorded actors are
 * explicit metadata. Raw inputs, private person IDs, row titles and artifact
 * content never enter the index or matching surface.
 */
import { z } from "zod";
import {
  IsoInstantSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  ActorIdSchema,
  BrowserSystemIdSchema,
  ErrorCodeSchema,
} from "../../rules/identity/ids.js";
import { RunPrioritySchema, RunShapeSchema } from "../run/envelope.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { DashboardWireVersionSchema } from "./primitives.js";

export const CrossDateSearchScopeSchema = z.enum(["all", "run", "trace", "workflow", "subject", "actor"]);
export const CROSS_DATE_SEARCH_PAGE_LIMIT = 50;
export const CROSS_DATE_SEARCH_QUERY_LIMIT = 160;

/** Task 3.1.12: all registered/historical workflows and the closed supported metadata vocabulary. */
export const CrossDateSearchWorkflowFacetSchema = WorkflowIdSchema;
export const CrossDateSearchStateFacetSchema = z.enum(["queued", "claimed", "validating", "running", "parked-gate", "parked-write", "done", "failed", "cancelled", "discarded", "superseded", "interrupted"]);
export const CrossDateSearchShapeFacetSchema = RunShapeSchema;
export const CrossDateSearchDryRunFacetSchema = z.boolean();
export const CrossDateSearchSystemFacetSchema = BrowserSystemIdSchema;

export const CrossDateSearchFacetsSchema = z.strictObject({
  workflow: CrossDateSearchWorkflowFacetSchema.optional(),
  day: z.iso.date().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  subject: z.string().trim().min(1).max(160).optional(),
  actor: ActorIdSchema.optional(),
  version: PositiveIntSchema.optional(),
  failure: ErrorCodeSchema.optional(),
  evidence: z.enum(["receipt", "failure", "diagnostic", "none"]).optional(),
  state: CrossDateSearchStateFacetSchema.optional(),
  shape: CrossDateSearchShapeFacetSchema.optional(),
  dryRun: CrossDateSearchDryRunFacetSchema.optional(),
  system: CrossDateSearchSystemFacetSchema.optional(),
}).refine(facets => facets.from === undefined || facets.to === undefined || facets.from <= facets.to, { message: "search range ends before it starts" });

export const CrossDateSearchQuerySchema = z.strictObject({
  q: z.string().trim()
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
    facets: {},
    limit: 20,
  };
}

export const CROSS_DATE_SEARCH_ORDER = "match-strength/enqueued-desc/run-id-asc:v2" as const;
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

const CrossDateSearchSystemsSchema = z.array(CrossDateSearchSystemFacetSchema).max(BrowserSystemIdSchema.options.length);

export const CrossDateSearchRegistrationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("registered"), label: z.string().min(1), code: z.string().min(1), categoryId: z.string().min(1) }),
  z.strictObject({ state: z.literal("unregistered"), reason: z.string().min(1) }),
]);

export const SearchTextFactSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), value: z.string().min(1).max(500) }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.enum(["not-recorded", "declaration-unavailable", "subject-unavailable", "withheld"]) }),
]);
export const SearchMetadataSchema = z.strictObject({
  subject: SearchTextFactSchema,
  actor: SearchTextFactSchema,
  version: PositiveIntSchema,
  failureCode: ErrorCodeSchema.nullable(),
  evidence: z.strictObject({ receipt: z.boolean(), failure: z.boolean(), diagnostic: z.boolean() }),
});
export const SearchCoverageSchema = z.strictObject({
  matched: NonNegativeIntSchema,
  subjectUnavailable: NonNegativeIntSchema,
  actorUnavailable: NonNegativeIntSchema,
  candidateLimit: z.literal(10000),
});

export const CrossDateSearchMatchSchema = z.strictObject({
  field: z.enum(["run", "trace", "workflow", "subject", "actor"]),
  strength: z.enum(["exact", "prefix", "contains"]),
});
export type CrossDateSearchMatch = z.infer<typeof CrossDateSearchMatchSchema>;

/** The one rank vocabulary shared by authority selection and wire validation. */
export const CROSS_DATE_SEARCH_MATCH_ORDER: readonly CrossDateSearchMatch[] = deepFreeze(
  (["exact", "prefix", "contains"] as const).flatMap(strength =>
    (["run", "trace", "workflow", "subject", "actor"] as const).map(field => ({ field, strength }))),
);
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
  metadata: SearchMetadataSchema,
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
  coverage: SearchCoverageSchema,
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
