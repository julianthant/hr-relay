import { searchPartitionDay } from "../../../domain/dashboard/search-calendar.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NonNegativeIntSchema,
  RunIdSchema,
} from "../../../domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../domain/run/record.js";
import {
  CROSS_DATE_SEARCH_MATCH_ORDER,
  CROSS_DATE_SEARCH_MAX_MATCH_RANK,
  CROSS_DATE_SEARCH_PAGE_LIMIT,
  CROSS_DATE_SEARCH_ORDER,
  CrossDateSearchPageSchema,
  CrossDateSearchQuerySchema,
  CrossDateSearchResultSchema,
  CrossDateSearchSnapshotTokenSchema,
  CrossDateSearchStateFacetSchema,
  type CrossDateSearchPage,
  type CrossDateSearchQuery,
  type CrossDateSearchResult,
  SearchMetadataSchema, SearchCoverageSchema,
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
  readonly cursorSigningKey: Uint8Array;
  readonly descriptors: {
    resolve(workflowId: string): CrossDateSearchDescriptorView | undefined;
  };
  readonly authority: {
    readSnapshot<Result>(read: (snapshot: CrossDateSearchAuthoritySnapshot) => Result): Result;
  };
}

export interface CrossDateSearchQueryService {
  search(input: unknown): CrossDateSearchPage;
  searchSelected(input: unknown, snapshotToken: unknown): CrossDateSearchPage;
}

const RunSearchAuthorityPageSchema = z.strictObject({
  totalMatches: NonNegativeIntSchema,
  coverage: SearchCoverageSchema,
  rows: z.array(z.strictObject({
    record: RunRecordSchema,
    metadata: SearchMetadataSchema,
    matchRank: z.number().int().min(0).max(CROSS_DATE_SEARCH_MAX_MATCH_RANK),
  })).max(CROSS_DATE_SEARCH_PAGE_LIMIT + 1),
}).superRefine((page, context) => {
  if (page.totalMatches < page.rows.length) {
    context.addIssue({
      code: "custom",
      path: ["totalMatches"],
      message: "authority search total cannot be smaller than its selected rows",
    });
  }
});

const CrossDateSearchSelectionQuerySchema = CrossDateSearchQuerySchema.omit({ cursor: true });

const CrossDateSearchCursorPayloadSchema = z.strictObject({
  version: z.literal(1),
  queryHash: FingerprintSchema,
  sourceIdentity: FingerprintSchema,
  authorityGeneration: NonNegativeIntSchema,
  expiresAt: IsoInstantSchema,
  order: z.literal(CROSS_DATE_SEARCH_ORDER),
  after: z.strictObject({
    matchRank: z.number().int().min(0).max(CROSS_DATE_SEARCH_MAX_MATCH_RANK),
    enqueuedAt: IsoInstantSchema,
    runId: RunIdSchema,
  }),
});
type CrossDateSearchCursorPayload = z.infer<typeof CrossDateSearchCursorPayloadSchema>;
const CrossDateSearchSnapshotTokenPayloadSchema = z.strictObject({
  version: z.literal(1),
  queryHash: FingerprintSchema,
  sourceIdentity: FingerprintSchema,
  authorityGeneration: NonNegativeIntSchema,
  expiresAt: IsoInstantSchema,
  order: z.literal(CROSS_DATE_SEARCH_ORDER),
});
type CrossDateSearchSnapshotTokenPayload = z.infer<typeof CrossDateSearchSnapshotTokenPayloadSchema>;
const CursorSigningKeySchema = z.instanceof(Uint8Array).refine(
  (key) => key.byteLength === 32,
  "search cursor signing key must contain exactly 32 random bytes",
);

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const PACIFIC_INSTANT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dateParts(formatter: Intl.DateTimeFormat, at: Date): Readonly<Record<string, string>> {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return Object.freeze(parts);
}

function requireDatePart(parts: Readonly<Record<string, string>>, name: string): string {
  const value = parts[name];
  if (value === undefined) throw new Error(`Pacific date formatter omitted ${name}`);
  return value;
}

function pacificOffsetAt(epochMs: number): number {
  const parts = dateParts(PACIFIC_INSTANT_FORMATTER, new Date(epochMs));
  const projectedUtc = Date.UTC(
    Number(requireDatePart(parts, "year")),
    Number(requireDatePart(parts, "month")) - 1,
    Number(requireDatePart(parts, "day")),
    Number(requireDatePart(parts, "hour")),
    Number(requireDatePart(parts, "minute")),
    Number(requireDatePart(parts, "second")),
  );
  return projectedUtc - Math.floor(epochMs / 1_000) * 1_000;
}

function pacificMidnight(day: string): string {
  const utcCalendarMidnight = Date.parse(`${day}T00:00:00.000Z`);
  let candidate = utcCalendarMidnight - pacificOffsetAt(utcCalendarMidnight);
  candidate = utcCalendarMidnight - pacificOffsetAt(candidate);
  const instant = new Date(candidate);
  if (searchPartitionDay(instant) !== day) {
    throw new Error(`could not derive Pacific midnight for search day ${day}`);
  }
  return instant.toISOString();
}

function nextCalendarDay(day: string): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

function canonicalUtcInstant(instant: string): z.infer<typeof IsoInstantSchema> {
  return IsoInstantSchema.parse(new Date(Date.parse(instant)).toISOString());
}

function cursorRefusal(message: string): never {
  const refusal = z.string().superRefine((_value, context) => {
    context.addIssue({ code: "custom", path: ["cursor"], message });
  }).safeParse("cursor");
  if (refusal.success) throw new Error("cursor refusal schema accepted its deliberate issue");
  throw refusal.error;
}

function snapshotTokenRefusal(message: string): never {
  const refusal = z.string().superRefine((_value, context) => {
    context.addIssue({ code: "custom", path: ["snapshotToken"], message });
  }).safeParse("snapshotToken");
  if (refusal.success) throw new Error("snapshot token refusal schema accepted its deliberate issue");
  throw refusal.error;
}

function queryHashOf(query: CrossDateSearchQuery): z.infer<typeof FingerprintSchema> {
  return FingerprintSchema.parse(createHash("sha256").update(canonicalJsonStringify({
    q: query.q,
    scope: query.scope,
    facets: query.facets,
    limit: query.limit,
  })).digest("hex"));
}

function signedTokenDigest(domain: string, encodedPayload: string, signingKey: Uint8Array): string {
  return createHmac("sha256", signingKey)
    .update(domain)
    .update(encodedPayload)
    .digest("hex");
}

function encodeCursor(payload: CrossDateSearchCursorPayload, signingKey: Uint8Array): string {
  const encoded = Buffer.from(canonicalJsonStringify(payload), "utf8").toString("base64url");
  return `sc1.${encoded}.${signedTokenDigest("cross-date-search-cursor:v1\0", encoded, signingKey)}`;
}

function decodeCursor(
  raw: string,
  signingKey: Uint8Array,
  sourceIdentity: z.infer<typeof FingerprintSchema>,
  queryHash: z.infer<typeof FingerprintSchema>,
): CrossDateSearchCursorPayload {
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "sc1") {
    return cursorRefusal("search cursor is malformed or uses an unsupported version");
  }
  const encoded = parts[1];
  const suppliedDigest = parts[2];
  if (encoded === undefined || suppliedDigest === undefined || !/^[0-9a-f]{64}$/.test(suppliedDigest)) {
    return cursorRefusal("search cursor is malformed");
  }
  const expectedDigest = signedTokenDigest("cross-date-search-cursor:v1\0", encoded, signingKey);
  if (!timingSafeEqual(Buffer.from(suppliedDigest, "hex"), Buffer.from(expectedDigest, "hex"))) {
    return cursorRefusal("search cursor signature belongs to a different BFF process or was modified");
  }
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return cursorRefusal("search cursor payload is not canonical base64url");
    decoded = bytes.toString("utf8");
  } catch {
    return cursorRefusal("search cursor payload is not valid base64url");
  }
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(decoded);
  } catch {
    return cursorRefusal("search cursor payload is not valid JSON");
  }
  const parsed = CrossDateSearchCursorPayloadSchema.safeParse(untrusted);
  if (!parsed.success) return cursorRefusal("search cursor payload does not match the strict cursor contract");
  if (parsed.data.sourceIdentity !== sourceIdentity) {
    return cursorRefusal("search cursor belongs to a foreign authority source");
  }
  if (parsed.data.queryHash !== queryHash) {
    return cursorRefusal("search cursor belongs to a different query");
  }
  return parsed.data;
}

function encodeSnapshotToken(
  payload: CrossDateSearchSnapshotTokenPayload,
  signingKey: Uint8Array,
): z.infer<typeof CrossDateSearchSnapshotTokenSchema> {
  const encoded = Buffer.from(canonicalJsonStringify(payload), "utf8").toString("base64url");
  return CrossDateSearchSnapshotTokenSchema.parse(
    `ss1.${encoded}.${signedTokenDigest("cross-date-search-snapshot:v1\0", encoded, signingKey)}`,
  );
}

function decodeSnapshotToken(
  rawInput: unknown,
  signingKey: Uint8Array,
  sourceIdentity: z.infer<typeof FingerprintSchema>,
  queryHash: z.infer<typeof FingerprintSchema>,
): CrossDateSearchSnapshotTokenPayload {
  const raw = CrossDateSearchSnapshotTokenSchema.parse(rawInput);
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "ss1") {
    return snapshotTokenRefusal("search snapshot token is malformed or uses an unsupported version");
  }
  const encoded = parts[1];
  const suppliedDigest = parts[2];
  if (encoded === undefined || suppliedDigest === undefined || !/^[0-9a-f]{64}$/.test(suppliedDigest)) {
    return snapshotTokenRefusal("search snapshot token is malformed");
  }
  const expectedDigest = signedTokenDigest("cross-date-search-snapshot:v1\0", encoded, signingKey);
  if (!timingSafeEqual(Buffer.from(suppliedDigest, "hex"), Buffer.from(expectedDigest, "hex"))) {
    return snapshotTokenRefusal(
      "search snapshot token signature belongs to a different BFF process or was modified",
    );
  }
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      return snapshotTokenRefusal("search snapshot token payload is not canonical base64url");
    }
    decoded = bytes.toString("utf8");
  } catch {
    return snapshotTokenRefusal("search snapshot token payload is not valid base64url");
  }
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(decoded);
  } catch {
    return snapshotTokenRefusal("search snapshot token payload is not valid JSON");
  }
  const parsed = CrossDateSearchSnapshotTokenPayloadSchema.safeParse(untrusted);
  if (!parsed.success) {
    return snapshotTokenRefusal("search snapshot token payload does not match the strict token contract");
  }
  if (parsed.data.sourceIdentity !== sourceIdentity) {
    return snapshotTokenRefusal("search snapshot token belongs to a foreign authority source");
  }
  if (parsed.data.queryHash !== queryHash) {
    return snapshotTokenRefusal("search snapshot token belongs to a different query");
  }
  return parsed.data;
}

function matchOf(rank: number): CrossDateSearchResult["match"] {
  const match = CROSS_DATE_SEARCH_MATCH_ORDER[rank];
  if (match === undefined) throw new Error(`authority search returned unsupported match rank ${String(rank)}`);
  return match;
}

function stateOf(record: RunRecord): CrossDateSearchResult["state"] {
  return CrossDateSearchStateFacetSchema.parse(
    record.lifecycle.state === "terminal" ? record.lifecycle.outcome : record.lifecycle.state,
  );
}

function resultOf(
  deps: CrossDateSearchQueryDeps,
  record: RunRecord,
  matchRank: number,
  metadata: z.infer<typeof SearchMetadataSchema>,
): CrossDateSearchResult {
  const descriptor = deps.descriptors.resolve(record.envelope.workflow);
  const enqueuedAt = canonicalUtcInstant(record.envelope.enqueuedAt);
  const systems = Object.keys(record.envelope.resolvedInstance)
    .map((system) => BrowserSystemIdSchema.parse(system))
    .sort((left, right) => left.localeCompare(right));
  return CrossDateSearchResultSchema.parse({
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
    partitionDay: searchPartitionDay(new Date(enqueuedAt)),
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
    enqueuedAt,
    endedAt: record.lifecycle.state === "terminal"
      ? { state: "present", value: canonicalUtcInstant(record.lifecycle.endedAt) }
      : { state: "absent", reason: `run ${record.envelope.runId} is ${record.lifecycle.state}, not terminal` },
    match: matchOf(matchRank),
    metadata,
  });
}

export function createCrossDateSearchService(deps: CrossDateSearchQueryDeps): CrossDateSearchQueryService {
  const sourceIdentity = FingerprintSchema.parse(deps.sourceIdentity);
  const cursorSigningKey = Buffer.from(CursorSigningKeySchema.parse(deps.cursorSigningKey));
  const search = (
    query: CrossDateSearchQuery,
    selectedSnapshot?: CrossDateSearchSnapshotTokenPayload,
  ): CrossDateSearchPage => {
    const queryHash = queryHashOf(query);
    const cursor = query.cursor === undefined
      ? undefined
      : decodeCursor(query.cursor, cursorSigningKey, sourceIdentity, queryHash);
    const expiresAt = selectedSnapshot?.expiresAt ?? cursor?.expiresAt ?? new Date(deps.clock.now().getTime() + 15 * 60 * 1000).toISOString();
    if (Date.parse(expiresAt) <= deps.clock.now().getTime()) return snapshotTokenRefusal("search snapshot expired; run a fresh query");
    return deps.authority.readSnapshot((snapshot) => {
        const authorityGeneration = NonNegativeIntSchema.parse(snapshot.authorityGeneration);
        if (cursor !== undefined && cursor.authorityGeneration !== authorityGeneration) {
          return cursorRefusal(
            `search cursor names authority generation ${String(cursor.authorityGeneration)}, but the current `
            + `snapshot is generation ${String(authorityGeneration)}`,
          );
        }
        if (selectedSnapshot !== undefined && selectedSnapshot.authorityGeneration !== authorityGeneration) {
          return snapshotTokenRefusal(
            `search snapshot token names authority generation ${String(selectedSnapshot.authorityGeneration)}, `
            + `but the current snapshot is generation ${String(authorityGeneration)}`,
          );
        }
        const { day, ...facets } = query.facets;
        const authorityPage = RunSearchAuthorityPageSchema.parse(snapshot.searchRuns({
          q: query.q,
          scope: query.scope,
          facets: {
            ...facets,
            ...(day === undefined ? {} : {
              day: {
                startsAt: pacificMidnight(day),
                endsBefore: pacificMidnight(nextCalendarDay(day)),
              },
            }),
          },
          limit: Math.min(query.limit + 1, CROSS_DATE_SEARCH_PAGE_LIMIT + 1),
          ...(cursor === undefined ? {} : { after: cursor.after }),
        }));
        const hasLaterPage = authorityPage.rows.length > query.limit;
        const visibleRows = authorityPage.rows.slice(0, query.limit);
        const lastVisible = visibleRows.at(-1);
        if (hasLaterPage && lastVisible === undefined) {
          throw new Error("authority search reported a later page without one visible cursor anchor");
        }
        const nextCursor = lastVisible === undefined || !hasLaterPage
          ? { state: "absent" as const, reason: "the snapshot has no later matching run" }
          : {
            state: "present" as const,
            value: encodeCursor(CrossDateSearchCursorPayloadSchema.parse({
              version: 1,
              queryHash,
              sourceIdentity,
              authorityGeneration,
              expiresAt,
              order: CROSS_DATE_SEARCH_ORDER,
              after: {
                matchRank: lastVisible.matchRank,
                enqueuedAt: canonicalUtcInstant(lastVisible.record.envelope.enqueuedAt),
                runId: lastVisible.record.envelope.runId,
              },
            }), cursorSigningKey),
          };
        return CrossDateSearchPageSchema.parse({
          wireVersion: 1,
          generatedAt: deps.clock.now().toISOString(),
          snapshot: {
            authorityGeneration,
            order: CROSS_DATE_SEARCH_ORDER,
            token: encodeSnapshotToken(CrossDateSearchSnapshotTokenPayloadSchema.parse({
              version: 1,
              queryHash,
              sourceIdentity,
              authorityGeneration,
              expiresAt,
              order: CROSS_DATE_SEARCH_ORDER,
            }), cursorSigningKey),
          },
          totalMatches: authorityPage.totalMatches,
          coverage: authorityPage.coverage,
          results: visibleRows.map(({ record, matchRank, metadata }) => resultOf(deps, record, matchRank, metadata)),
          nextCursor,
        });
      });
  };
  return Object.freeze({
    search(input: unknown): CrossDateSearchPage {
      return search(CrossDateSearchQuerySchema.parse(input));
    },
    searchSelected(input: unknown, snapshotToken: unknown): CrossDateSearchPage {
      const query = CrossDateSearchSelectionQuerySchema.parse(input);
      const selectedSnapshot = decodeSnapshotToken(
        snapshotToken,
        cursorSigningKey,
        sourceIdentity,
        queryHashOf(query),
      );
      return search(query, selectedSnapshot);
    },
  });
}
