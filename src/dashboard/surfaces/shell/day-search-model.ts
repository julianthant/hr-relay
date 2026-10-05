/**
 * The day's find, as pure functions over the rows the server already served.
 *
 * It lives beside `day-search.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { DashboardClientError } from "../../client/errors.js";
import type {
  CrossDateSearchPage,
  CrossDateSearchResult,
} from "../../../domain/dashboard/search.js";
import type { QueueStatus } from "../shared/status/status-model.js";
import type { QueueSurfaceWire } from "../queue/queue-model.js";

/** The Top Bar defaults to the durable corpus and keeps the served-day find. */
export type TopBarSearchMode = "corpus" | "day";

/** One page is the bounded interaction size, independent of server maximum. */
export const TOP_BAR_SEARCH_PAGE_SIZE = 20;

/** Compact desktop scope controls retain their existing paint and spacing. */
export const TOP_BAR_SCOPE_TOGGLE_HIT_AREA = "relative min-w-11 h-[var(--ds-h-sm)]";

/** A pause keeps fast typing to one bounded authority request. */
export const TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS = 250;

export type CorpusSearchResource =
  | { readonly state: "idle" }
  | {
    readonly state: "loading";
    readonly query: string;
    readonly cursor?: string;
    readonly page?: CrossDateSearchPage;
  }
  | { readonly state: "ready"; readonly query: string; readonly page: CrossDateSearchPage }
  | {
    readonly state: "failed";
    readonly query: string;
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly cursor?: string;
    readonly page?: CrossDateSearchPage;
  };

/**
 * Cursor pages share one ordered authority snapshot. A page from another
 * snapshot must never be spliced into the first one: it would claim one list
 * even though rank and count came from different database instants.
 */
export function appendCorpusSearchPage(
  previous: CrossDateSearchPage,
  next: CrossDateSearchPage,
): CrossDateSearchPage {
  if (
    previous.snapshot.authorityGeneration !== next.snapshot.authorityGeneration
    || previous.snapshot.order !== next.snapshot.order
    || previous.totalMatches !== next.totalMatches
    || previous.snapshot.token !== next.snapshot.token
    || previous.generatedAt !== next.generatedAt
    || JSON.stringify(previous.coverage) !== JSON.stringify(next.coverage)
  ) {
    throw new Error("cross-date search continuation does not match the initial authority snapshot");
  }
  const seen = new Set(previous.results.map((result) => result.runId));
  for (const result of next.results) {
    if (seen.has(result.runId)) {
      throw new Error(`cross-date search continuation repeats run ${result.runId}`);
    }
  }
  return {
    ...next,
    results: [...previous.results, ...next.results] satisfies readonly CrossDateSearchResult[],
  };
}

export function corpusSearchFailure(error: unknown): Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}> {
  if (error instanceof DashboardClientError) {
    switch (error.kind) {
      case "schema":
        return {
          code: "SEARCH_RESPONSE_REJECTED",
          message: "The service returned a search page outside the verified contract.",
          retryable: false,
        };
      case "http":
        return {
          code: "SEARCH_SERVICE_REJECTED",
          message: "The search service refused this request.",
          retryable: error.retryable,
        };
      case "network":
        return {
          code: "SEARCH_UNAVAILABLE",
          message: "The search service could not be reached.",
          retryable: error.retryable,
        };
      case "protocol":
        return {
          code: "SEARCH_PROTOCOL_REJECTED",
          message: "The search service returned an unsupported response.",
          retryable: false,
        };
    }
  }
  return {
    code: "SEARCH_RESULT_SET_REJECTED",
    message: "The cross-date result set could not be safely applied.",
    retryable: false,
  };
}

/**
 * Which field a hit matched on. Ordered by how a person searches: the words on
 * the row first, then the identifiers they paste.
 */
export type DaySearchField = "title" | "subtitle" | "trace" | "run" | "workflow";

export const FIELD_LABEL: Record<DaySearchField, string> = {
  title: "title",
  subtitle: "subtitle",
  trace: "trace",
  run: "run id",
  workflow: "workflow",
};

export interface DaySearchHit {
  readonly runId: string;
  readonly title: string;
  readonly traceId: string;
  readonly workflowLabel: string;
  readonly matchedField: DaySearchField;
  readonly matchedValue: string;
  readonly status: QueueStatus;
}

/**
 * Three states and only three. There is deliberately no `failed` arm: nothing
 * here can fail to run, because nothing here leaves the page — the rows are
 * already on screen. The demo's `failed` arm exists because its search calls a
 * corpus that can be unreachable; an arm no producer can emit is the exact
 * defect D198's `wire-connectivity` guard exists to catch, so it is not ported.
 */
export type DaySearchOutcome =
  | { readonly state: "idle"; readonly scanned: number }
  | { readonly state: "empty"; readonly query: string; readonly scanned: number }
  | {
    readonly state: "hits";
    readonly query: string;
    readonly scanned: number;
    readonly hits: readonly DaySearchHit[];
  };

function fieldsOf(
  surface: QueueSurfaceWire,
  workflowLabel: string,
): readonly (readonly [DaySearchField, string])[] {
  const fields: (readonly [DaySearchField, string])[] = [["title", surface.title]];
  if (surface.subtitle.state === "present") fields.push(["subtitle", surface.subtitle.value]);
  fields.push(["trace", String(surface.traceId)]);
  fields.push(["run", String(surface.runId)]);
  fields.push(["workflow", workflowLabel]);
  return fields;
}

/**
 * The find. Case-insensitive substring over the fields a row already shows,
 * FIRST match wins so a hit names one field rather than a list — the operator
 * wants to know why this row came back, not every way it could have.
 *
 * Row ORDER is the projection's own: the array arrives in the server's order
 * and is filtered, never sorted. A search that re-ranked would be a second
 * opinion about which run matters most, and the queue's bands already hold the
 * only one this product has.
 */
export function searchDaySurfaces(
  surfaces: readonly QueueSurfaceWire[],
  query: string,
  workflowLabelOf: (workflowId: string) => string,
): DaySearchOutcome {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { state: "idle", scanned: surfaces.length };
  const hits: DaySearchHit[] = [];
  for (const surface of surfaces) {
    const workflowLabel = workflowLabelOf(String(surface.workflowId));
    const matched = fieldsOf(surface, workflowLabel).find(([, value]) =>
      value.toLowerCase().includes(needle),
    );
    if (matched === undefined) continue;
    hits.push({
      runId: String(surface.runId),
      title: surface.title,
      traceId: String(surface.traceId),
      workflowLabel,
      matchedField: matched[0],
      matchedValue: matched[1],
      status: surface.status,
    });
  }
  return hits.length === 0
    ? { state: "empty", query, scanned: surfaces.length }
    : { state: "hits", query, scanned: surfaces.length, hits };
}

export interface DaySearchExample {
  readonly field: DaySearchField;
  readonly query: string;
}

/**
 * The demo's `Try:` chips, over THIS day's rows.
 *
 * The demo hardcodes six fixture queries (`Rosa`, `10633092`, `onbase`, …)
 * because its corpus is a constant. Here the corpus is whatever the server
 * served, so the examples are QUOTED from it — one per searchable field, taken
 * from the first row that offers that field. Every chip is therefore a query
 * that is guaranteed to return at least the row it came from, and nothing on
 * this row is a value the server never issued.
 *
 * It follows that an empty day produces no chips, which is the honest state:
 * there is nothing to give an example of.
 *
 * `run` is searchable and is deliberately NOT offered as an example: a run id
 * is a 36-character uuid nobody types by hand, and one quoted whole is a chip
 * three times the width of every other — the demo's six examples are all short
 * because an example you would not type is not an example. The trace id is the
 * identifier an operator actually quotes, and it is here. Four chips against
 * the demo's six, for that reason and because its last two demonstrate a
 * zero-hit answer and a lookup FAILING, and nothing here can fail (see
 * `DaySearchOutcome`).
 */
export function daySearchExamples(
  surfaces: readonly QueueSurfaceWire[],
  workflowLabelOf: (workflowId: string) => string,
): readonly DaySearchExample[] {
  const order: readonly DaySearchField[] = ["title", "subtitle", "trace", "workflow"];
  const examples: DaySearchExample[] = [];
  for (const field of order) {
    for (const surface of surfaces) {
      const found = fieldsOf(surface, workflowLabelOf(String(surface.workflowId)))
        .find(([candidate]) => candidate === field);
      if (found === undefined) continue;
      const [, value] = found;
      if (examples.some((example) => example.query === value)) continue;
      examples.push({ field, query: value });
      break;
    }
  }
  return examples;
}
