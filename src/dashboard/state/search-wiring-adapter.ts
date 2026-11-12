import { DISPLAY_STATUS_LABELS, displayStatusOf } from "../../models/dashboard/status-vocabulary.js";
import type { QueueStatus } from "../surfaces/shared/status/status-model.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { CrossDateSearchQuerySchema, CrossDateSearchStateFacetSchema, compareCrossDateSearchResults, currentCorpusSearchQuery, type CrossDateSearchPage, type CrossDateSearchQueryInput } from "../../models/dashboard/search.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { WorkflowBootstrapPrimitive } from "../surfaces/shell/shell-model.js";
import type { DashboardClient } from "../client/index.js";
import type { NavbarData, NavbarSearchResult } from "../surfaces/shell/search/navbar-view-model.js";
import type { PaletteSheet } from "../surfaces/shell/search/search-palette-model.js";
import type { SavedWorkbook } from "../../models/dashboard/workbooks.js";

export const searchMessage = (code: "SEARCH_LOADING" | "SEARCH_UNAVAILABLE" | "SEARCH_LIBRARY_UNAVAILABLE" | "SEARCH_SUBJECT_UNAVAILABLE") => formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text;

export async function readSearchSnapshot(client: Pick<DashboardClient, "searchRuns">, input: CrossDateSearchQueryInput, signal: AbortSignal) {
  const query = CrossDateSearchQuerySchema.parse(input);
  const first = await client.searchRuns(query, signal);
  signal.throwIfAborted();
  const results = [...first.results], ids = new Set(results.map(row => row.runId)), cursors = new Set<string>();
  let page: CrossDateSearchPage = first;
  while (page.nextCursor.state === "present") {
    const cursor = page.nextCursor.value;
    if (!/^sc1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/u.test(cursor) || cursors.has(cursor)) throw new Error("SEARCH_CURSOR_INVALID");
    cursors.add(cursor);
    page = await client.searchRuns({ ...query, cursor }, signal);
    signal.throwIfAborted();
    if (canonicalJsonStringify(page.snapshot) !== canonicalJsonStringify(first.snapshot) || page.totalMatches !== first.totalMatches
      || canonicalJsonStringify(page.coverage) !== canonicalJsonStringify(first.coverage) || page.generatedAt !== first.generatedAt) throw new Error("SEARCH_SNAPSHOT_MISMATCH");
    for (const row of page.results) {
      const previous = results.at(-1);
      if (ids.has(row.runId) || (previous !== undefined && compareCrossDateSearchResults(previous, row) > 0)) throw new Error("SEARCH_PAGE_IDENTITY_MISMATCH");
      ids.add(row.runId); results.push(row);
    }
  }
  if (results.length !== first.totalMatches) throw new Error("SEARCH_INCOMPLETE");
  return { query, snapshot: first.snapshot, totalMatches: first.totalMatches, results };
}

const SEARCH_STATE_TO_QUEUE: Readonly<Record<CrossDateSearchPage["results"][number]["state"], QueueStatus>> = {
  queued: "queued", claimed: "running", validating: "running", running: "running", "parked-gate": "awaiting-approval", "parked-write": "blocked",
  done: "done", failed: "failed", interrupted: "blocked", cancelled: "cancelled", discarded: "cancelled", superseded: "cancelled",
};

export function searchResults(snapshot: Awaited<ReturnType<typeof readSearchSnapshot>>): readonly NavbarSearchResult[] {
  return snapshot.results.map(row => ({ id: row.runId,
    subject: row.metadata.subject.state === "available" ? row.metadata.subject.value : searchMessage("SEARCH_SUBJECT_UNAVAILABLE"),
    workflow: row.registration.state === "registered" ? row.registration.label : row.workflowId,
    day: row.partitionDay, state: DISPLAY_STATUS_LABELS[displayStatusOf(SEARCH_STATE_TO_QUEUE[row.state])],
    ...(row.runNumber.state === "present" ? { publicId: String(row.runNumber.value) } : {}),
    destination: { kind: "run", runId: row.runId, day: row.partitionDay },
  }));
}

/** Served search may not know a run's subject; the queue row's own title fills it. */
export function withQueueSubjects(results: readonly NavbarSearchResult[], titles: ReadonlyMap<string, string>): readonly NavbarSearchResult[] {
  const missing = searchMessage("SEARCH_SUBJECT_UNAVAILABLE");
  return results.map(result => result.subject === missing && titles.has(result.id) ? { ...result, subject: titles.get(result.id)! } : result);
}

const shortDay = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
export const paletteSheets = (records: readonly SavedWorkbook[]): readonly PaletteSheet[] =>
  [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map(record => ({ id: record.libraryId, name: record.workbook.name, detail: `v${record.version} · Updated ${shortDay(record.savedAt)}` }));

export function workspaceSearchQuery(query: string, workflows: readonly Pick<WorkflowBootstrapPrimitive, "id" | "label">[]): CrossDateSearchQueryInput {
  const normalized = query.trim().toLowerCase();
  const matches = workflows.filter(workflow => workflow.label.toLowerCase() === normalized);
  const state = CrossDateSearchStateFacetSchema.safeParse(normalized);
  const base = currentCorpusSearchQuery(query);
  if (matches.length === 1) return { ...base, q: "", facets: { workflow: matches[0].id } };
  if (state.success) return { ...base, q: "", facets: { state: state.data } };
  return base;
}

/** The saved library as palette rows, read while the palette is open. */
export function useLibrarySheets(client: Pick<DashboardClient, "workbookList">, enabled: boolean): Readonly<{ sheets: readonly PaletteSheet[]; unavailable?: string }> {
  const [state, setState] = useState<{ sheets: readonly PaletteSheet[]; read: "pending" | "ready" | "failed" }>({ sheets: [], read: "pending" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState(previous => ({ ...previous, read: "pending" }));
    client.workbookList().then(records => { if (live) setState({ sheets: paletteSheets(records), read: "ready" }); }, () => { if (live) setState(previous => ({ ...previous, read: "failed" })); });
    return () => { live = false; };
  }, [client, enabled]);
  // Loaded rows stay while a re-read is pending or failed; only a settled read is a verified list.
  if (state.read === "ready") return { sheets: state.sheets };
  return { sheets: state.sheets, unavailable: searchMessage(state.read === "failed" ? "SEARCH_LIBRARY_UNAVAILABLE" : "SEARCH_LOADING") };
}

const NO_TITLES: ReadonlyMap<string, string> = new Map();
export function useSearchWiring({ client, enabled, query, today, epoch, workflows, titles = NO_TITLES }: { client: DashboardClient; enabled: boolean; query: string; today: string; epoch: object; workflows: readonly Pick<WorkflowBootstrapPrimitive, "id" | "label">[]; titles?: ReadonlyMap<string, string> }): NavbarData {
  const request = useMemo(() => ({ client, enabled, query, epoch, workflows }), [client, enabled, query, epoch, workflows]);
  const active = useRef(request); active.current = request;
  const [settled, setSettled] = useState<{ request: typeof request; data: NavbarData }>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void readSearchSnapshot(client, workspaceSearchQuery(query, workflows), controller.signal).then(snapshot => {
      if (active.current !== request || controller.signal.aborted) return;
      setSettled({ request, data: { today, counts: {}, results: searchResults(snapshot), totalMatches: snapshot.totalMatches } });
    }, () => {
      if (active.current === request && !controller.signal.aborted) setSettled({ request, data: { today, counts: {}, results: [], unavailable: searchMessage("SEARCH_UNAVAILABLE") } });
    });
    return () => controller.abort();
  }, [client, enabled, query, today, workflows, request]);
  return useMemo(() => {
    const data = settled?.request === request ? settled.data : { today, counts: {}, results: [], unavailable: searchMessage("SEARCH_LOADING") };
    return { ...data, results: withQueueSubjects(data.results, titles) };
  }, [settled, request, today, titles]);
}
