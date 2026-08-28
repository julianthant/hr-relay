import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { localDatePart } from "../../../domain/clock.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  NonNegativeIntSchema,
} from "../../../domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../domain/run/record.js";
import {
  CROSS_DATE_SEARCH_PAGE_LIMIT,
  CrossDateSearchPageSchema,
  CrossDateSearchQuerySchema,
  type CrossDateSearchPage,
  type CrossDateSearchResult,
} from "../../../domain/dashboard/search.js";

export interface CrossDateSearchDescriptorView {
  readonly id: string;
  readonly label: string;
  readonly code: string;
  readonly category: string;
}

export interface CrossDateSearchAuthoritySnapshot {
  readonly authorityGeneration: number;
  readonly searchRuns: (input: unknown) => unknown;
}

export interface CrossDateSearchQueryDeps {
  readonly clock: Clock;
  readonly sourceIdentity: string;
  readonly descriptors: {
    resolve(workflowId: string): CrossDateSearchDescriptorView | undefined;
  };
  readonly authority: {
    readSnapshot<Result>(read: (snapshot: CrossDateSearchAuthoritySnapshot) => Result): Result;
  };
}

const RunSearchAuthorityPageSchema = z.strictObject({
  totalMatches: NonNegativeIntSchema,
  rows: z.array(z.strictObject({
    record: RunRecordSchema,
    matchRank: z.number().int().min(0).max(8),
  })).max(CROSS_DATE_SEARCH_PAGE_LIMIT + 1),
});

function matchOf(rank: number): CrossDateSearchResult["match"] {
  switch (rank) {
    case 0: return { field: "run", strength: "exact" };
    case 1: return { field: "trace", strength: "exact" };
    case 2: return { field: "workflow", strength: "exact" };
    case 3: return { field: "run", strength: "prefix" };
    case 4: return { field: "trace", strength: "prefix" };
    case 5: return { field: "workflow", strength: "prefix" };
    case 6: return { field: "run", strength: "contains" };
    case 7: return { field: "trace", strength: "contains" };
    case 8: return { field: "workflow", strength: "contains" };
    default: throw new Error(`authority search returned unsupported match rank ${String(rank)}`);
  }
}

function stateOf(record: RunRecord): CrossDateSearchResult["state"] {
  return record.lifecycle.state === "terminal" ? record.lifecycle.outcome : record.lifecycle.state;
}

function resultOf(
  deps: CrossDateSearchQueryDeps,
  record: RunRecord,
  matchRank: number,
): CrossDateSearchResult {
  const descriptor = deps.descriptors.resolve(record.envelope.workflow);
  const systems = Object.keys(record.envelope.resolvedInstance)
    .map((system) => BrowserSystemIdSchema.parse(system))
    .sort((left, right) => left.localeCompare(right));
  return {
    runId: record.envelope.runId,
    traceId: record.envelope.traceId,
    workflowId: record.envelope.workflow,
    registration: descriptor === undefined
      ? {
        state: "unregistered",
        reason: `workflow ${record.envelope.workflow} is not registered in this build`,
      }
      : {
        state: "registered",
        label: descriptor.label,
        code: descriptor.code,
        categoryId: descriptor.category,
      },
    partitionDay: localDatePart(new Date(record.envelope.enqueuedAt)),
    state: stateOf(record),
    shape: record.envelope.shape,
    dryRun: record.envelope.dryRun,
    priority: record.envelope.priority,
    systems,
    runNumber: record.runNumber === undefined
      ? { state: "absent", reason: "this historical run has no durable workflow ordinal" }
      : { state: "present", value: record.runNumber },
    retryOf: record.envelope.retryOf === undefined
      ? { state: "absent", reason: "this run is not a retry" }
      : { state: "present", value: record.envelope.retryOf },
    enqueuedAt: record.envelope.enqueuedAt,
    endedAt: record.lifecycle.state === "terminal"
      ? { state: "present", value: record.lifecycle.endedAt }
      : { state: "absent", reason: `run ${record.envelope.runId} is ${record.lifecycle.state}, not terminal` },
    match: matchOf(matchRank),
  };
}

export function createCrossDateSearchService(deps: CrossDateSearchQueryDeps): Readonly<{
  search(input: unknown): CrossDateSearchPage;
}> {
  FingerprintSchema.parse(deps.sourceIdentity);
  return Object.freeze({
    search(input: unknown): CrossDateSearchPage {
      const query = CrossDateSearchQuerySchema.parse(input);
      return deps.authority.readSnapshot((snapshot) => {
        const authorityGeneration = NonNegativeIntSchema.parse(snapshot.authorityGeneration);
        const authorityPage = RunSearchAuthorityPageSchema.parse(snapshot.searchRuns({
          q: query.q,
          scope: query.scope,
          facets: query.facets,
          limit: Math.min(query.limit + 1, CROSS_DATE_SEARCH_PAGE_LIMIT + 1),
        }));
        if (authorityPage.rows.length > query.limit) {
          throw new Error("cross-date search pagination requires a cursor before it can serve this page");
        }
        return CrossDateSearchPageSchema.parse({
          wireVersion: 1,
          generatedAt: deps.clock.now().toISOString(),
          snapshot: {
            authorityGeneration,
            order: "match-strength/enqueued-desc/run-id-asc:v1",
          },
          totalMatches: authorityPage.totalMatches,
          results: authorityPage.rows.map(({ record, matchRank }) => resultOf(deps, record, matchRank)),
          nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
        });
      });
    },
  });
}
