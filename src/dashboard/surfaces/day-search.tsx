/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoTopBarSurfaces.tsx
 * (`DemoSearchControl` :388 and `SearchOutcomeView` :475).
 *
 * DCR4 reverses that deliberate narrowing. The default tab searches DCR3's
 * strict cross-date authority through its typed client; it never scans served
 * day caches or reorders results. The original local find remains an explicit
 * "This day" tab because it answers a different, zero-round-trip question.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, SearchX } from "lucide-react";
import {
  currentCorpusSearchQuery,
  type CrossDateSearchPage,
  type CrossDateSearchResult,
} from "../../domain/dashboard/search.js";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  EmptyState,
  Kbd,
  MetaLine,
  Refusal,
  SearchInput,
  Skeleton,
  StatusPill,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  dsFocus,
  dsIcon,
  dsMotion,
  dsText,
} from "../ds/ui.js";
import { useDashboardClient } from "../state/client-context.js";
import { dsStatusOf } from "./status-model.js";
import { plural } from "./format.js";
import type { QueueSurfaceWire } from "./queue-model.js";
import {
  appendCorpusSearchPage,
  corpusSearchFailure,
  FIELD_LABEL,
  daySearchExamples,
  searchDaySurfaces,
  TOP_BAR_SEARCH_PAGE_SIZE,
  TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS,
  TOP_BAR_SCOPE_TOGGLE_GROUP,
  TOP_BAR_SCOPE_TOGGLE_HIT_AREA,
  type DaySearchOutcome,
  type CorpusSearchResource,
  type TopBarSearchMode,
} from "./day-search-model.js";

/* ── the find, as a pure function ────────────────────────────────────────── */

/* the find, as a pure function, lives in `day-search-model.ts` — see the note there */

/* ── the control ─────────────────────────────────────────────────────────── */

function DaySearchOutcomeView({
  outcome,
  day,
  onPick,
}: {
  outcome: DaySearchOutcome;
  /**
   * The day every hit belongs to. It is a CONSTANT down the column and it is
   * still the demo's column: a find that reads one partition can only answer
   * with that partition's date, and printing it is what keeps the table honest
   * about the scope it scanned. When the cross-day corpus lands (D184), the
   * value moves from this prop to the hit and nothing else here changes.
   */
  day: string;
  onPick: (runId: string) => void;
}) {
  if (outcome.state === "idle") {
    return (
      <EmptyState
        icon={<SearchX aria-hidden className={dsIcon.lg} />}
        title="Nothing typed yet"
        description={`This finds a row in the ${plural(outcome.scanned, "row")} already on this day — a name, a subject, a trace id, a run id or a workflow.`}
      />
    );
  }

  if (outcome.state === "empty") {
    return (
      <EmptyState
        icon={<SearchX aria-hidden className={dsIcon.lg} />}
        title={`No row on this day matches “${outcome.query}”`}
        description={`${plural(outcome.scanned, "row")} were read. Another day may hold it — step the date, or clear the status filter.`}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-[var(--ds-space-loose)] py-[var(--ds-space-base)]">
        <MetaLine
          items={[
            plural(outcome.hits.length, "match", "matches"),
            `${plural(outcome.scanned, "row")} read on this day`,
          ]}
        />
      </div>
      <div className="min-h-0 overflow-x-auto px-[var(--ds-space-loose)] pb-[var(--ds-space-loose)]">
        <Table label={`Rows on this day matching ${outcome.query}`}>
          <THead>
            <TR>
              <TH>Row</TH>
              <TH>Workflow</TH>
              <TH>Matched</TH>
              <TH>Day</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {outcome.hits.map((hit) => (
              <TR key={hit.runId} interactive onClick={() => onPick(hit.runId)}>
                <TD>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[color:var(--ds-fg)]">{hit.title}</span>
                    <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
                      {hit.traceId}
                    </span>
                  </span>
                </TD>
                <TD>{hit.workflowLabel}</TD>
                <TD>
                  <span className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
                    <Badge tone="neutral">{FIELD_LABEL[hit.matchedField]}</Badge>
                    <span className={cn(dsText.nums, "truncate text-[color:var(--ds-fg)]")}>{hit.matchedValue}</span>
                  </span>
                </TD>
                <TD numeric>{day}</TD>
                <TD>
                  <StatusPill status={dsStatusOf(hit.status)} size="sm" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * The Top Bar's search control: a quiet field that opens the real surface.
 *
 * `/` focuses it from anywhere the caret is not already in a field — the same
 * binding the keyboard legend has always claimed. Escape CLEARS a query that
 * has something in it and closes the dialog when it does not, so a mistyped
 * search costs one key rather than a close-and-reopen.
 *
 * THE ESCAPE-CLEAR IS A RULED DEVIATION (D272 item 3, ledger row A16). The demo
 * has no counterpart: its Escape always closes. It is KEPT, recorded here as an
 * intentional usability deviation, because clearing is the cheaper correction
 * and the second press still reaches the dialog — nothing an operator can do
 * with the demo's Escape is unavailable here. The rejected alternative was
 * removing it for exactness.
 *
 * It is deliberately NOT a registry entry: the legend's own `When they fire`
 * rules state that an open dialog owns the keyboard including Escape, and a
 * per-dialog Escape refinement listed as a global binding would contradict
 * them. The deviation is recorded here and in `src/dashboard/CLAUDE.md`. `/`
 * IS a registry entry, because it is a window-level binding.
 */
export function CorpusSearchOutcomeView({
  resource,
  onPick,
  onMore,
  onRetry,
}: {
  resource: CorpusSearchResource;
  onPick: (result: CrossDateSearchResult) => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  if (resource.state === "idle") {
    return (
      <EmptyState
        icon={<SearchX aria-hidden className={dsIcon.lg} />}
        title="Search the Separations corpus"
        description="Search run identifiers, trace identifiers, or the workflow across the measured durable corpus."
      />
    );
  }

  if (resource.state === "loading" && resource.page === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading cross-date search results" className="space-y-[var(--ds-space-snug)] p-[var(--ds-space-loose)]">
        <Skeleton className="h-[var(--ds-h-row)] w-full" />
        <Skeleton className="h-[var(--ds-h-row)] w-4/5" />
        <Skeleton className="h-[var(--ds-h-row)] w-3/5" />
      </div>
    );
  }

  if (resource.state === "failed" && resource.page === undefined) {
    return (
      <div className="p-[var(--ds-space-loose)]">
        <Refusal
          title="The cross-date search was refused"
          code={resource.code}
          outcome="No local rows were substituted. Retry this exact search when the service is available."
          action={resource.retryable ? <Button size="sm" variant="secondary" onClick={onRetry}>Retry search</Button> : undefined}
        >
          {resource.message}
        </Refusal>
      </div>
    );
  }

  const page = resource.state === "ready" || resource.state === "loading" || resource.state === "failed"
    ? resource.page
    : undefined;
  if (page === undefined) {
    throw new Error("cross-date search reached a result state without a page");
  }

  if (page.results.length === 0) {
    return (
      <EmptyState
        icon={<SearchX aria-hidden className={dsIcon.lg} />}
        title={`No Separations run matches “${resource.query}”`}
        description="Try a different run identifier, trace identifier, or workflow term. This search does not substitute the served day."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      {resource.state === "failed" && (
        <div className="border-b border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]">
          <Refusal
            title="The next search page was refused"
            code={resource.code}
            outcome="The rows above are from the initial snapshot; no later page was added."
            action={resource.retryable ? <Button size="sm" variant="secondary" onClick={onRetry}>Retry page</Button> : undefined}
          >
            {resource.message}
          </Refusal>
        </div>
      )}
      <div className="px-[var(--ds-space-loose)] py-[var(--ds-space-base)]">
        <MetaLine items={[plural(page.totalMatches, "match", "matches"), "ordered by durable authority"]} />
      </div>
      <div className="min-h-0 overflow-y-auto px-[var(--ds-space-loose)] pb-[var(--ds-space-loose)]">
        <ul aria-label="Cross-date search results" className="divide-y divide-[color:var(--ds-border-subtle)]">
          {page.results.map((result) => {
            const runLabel = result.runNumber.state === "present"
              ? `Run ${String(result.runNumber.value)}`
              : "Run ordinal unavailable";
            const tone = result.state === "done" ? "success" : result.state === "failed" ? "danger" : "warning";
            return (
              <li key={String(result.runId)}>
                <button
                  type="button"
                  data-corpus-search-result
                  aria-label={`Open ${result.registration.label} ${runLabel} from ${result.partitionDay}`}
                  onClick={() => onPick(result)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    const options = [...event.currentTarget.closest("ul")?.querySelectorAll<HTMLButtonElement>("button[data-corpus-search-result]") ?? []];
                    const index = options.indexOf(event.currentTarget);
                    const next = event.key === "ArrowDown" ? options[index + 1] : options[index - 1];
                    if (next === undefined) return;
                    event.preventDefault();
                    next.focus();
                  }}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-[var(--ds-space-snug)] px-[var(--ds-space-base)] py-[var(--ds-space-cozy)] text-left",
                    "hover:bg-[var(--ds-surface-3)]",
                    dsFocus,
                    dsMotion.fast,
                  )}
                >
                  <span className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>{result.registration.label}</span>
                  <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>{runLabel}</span>
                  <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>{result.partitionDay}</span>
                  <Badge tone={tone}>{result.state}</Badge>
                  <Badge tone="neutral">dry run</Badge>
                  <span className={cn(dsText.meta, "basis-full text-[color:var(--ds-fg-muted)]")}>
                    Matched {result.match.field} · {result.match.strength}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {resource.state === "loading" && (
          <div aria-live="polite" className="mt-[var(--ds-space-cozy)] space-y-[var(--ds-space-snug)]">
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Loading the next page</span>
            <Skeleton className="h-[var(--ds-h-row)] w-full" />
          </div>
        )}
        {resource.state === "ready" && resource.page.nextCursor.state === "present" && (
          <div className="mt-[var(--ds-space-cozy)]">
            <Button size="sm" variant="secondary" onClick={onMore}>
              Load next {TOP_BAR_SEARCH_PAGE_SIZE}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DaySearchControl({
  surfaces,
  day,
  workflowLabelOf,
  onOpenRun,
  onOpenCrossDateResult,
}: {
  /** the day's whole queue projection — every workflow, not just the open panel */
  surfaces: readonly QueueSurfaceWire[];
  /** the partition being read — the results table's `Day` column */
  day: string;
  workflowLabelOf: (workflowId: string) => string;
  onOpenRun: (runId: string) => void;
  onOpenCrossDateResult: (result: CrossDateSearchResult) => void;
}) {
  const client = useDashboardClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TopBarSearchMode>("corpus");
  const [query, setQuery] = useState("");
  const [corpus, setCorpus] = useState<CorpusSearchResource>({ state: "idle" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const outcome = useMemo(
    () => searchDaySurfaces(surfaces, query, workflowLabelOf),
    [surfaces, query, workflowLabelOf],
  );
  const examples = useMemo(
    () => daySearchExamples(surfaces, workflowLabelOf),
    [surfaces, workflowLabelOf],
  );

  const requestCorpus = useCallback((cursor?: string, previous?: CrossDateSearchPage): void => {
    const normalized = query.trim();
    if (normalized === "") {
      setCorpus({ state: "idle" });
      return;
    }
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setCorpus({ state: "loading", query: normalized, cursor, page: previous });
    void Promise.resolve().then(() => client.searchRuns({ ...currentCorpusSearchQuery(normalized), cursor })).then((page) => {
      if (requestSequence.current !== sequence) return;
      try {
        setCorpus({
          state: "ready",
          query: normalized,
          page: previous === undefined ? page : appendCorpusSearchPage(previous, page),
        });
      } catch (error) {
        const failure = corpusSearchFailure(error);
        setCorpus({ state: "failed", query: normalized, cursor, page: previous, ...failure });
      }
    }, (error: unknown) => {
      if (requestSequence.current !== sequence) return;
      const failure = corpusSearchFailure(error);
      setCorpus({ state: "failed", query: normalized, cursor, page: previous, ...failure });
    });
  }, [client, query]);

  useEffect(() => {
    if (!open || mode !== "corpus") return;
    const id = window.setTimeout(requestCorpus, TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
      requestSequence.current += 1;
    };
  }, [mode, open, requestCorpus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setMode("corpus");
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open || query === "") return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Radix closes a dialog from its own document listener. Capture on the
      // window so the first Escape clears the active query from either the
      // input or a result; an empty query lets the next Escape close normally.
      event.preventDefault();
      event.stopImmediatePropagation();
      setQuery("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, query]);

  const retryCorpus = useCallback((): void => {
    if (corpus.state !== "failed") return;
    requestCorpus(corpus.cursor, corpus.page);
  }, [corpus, requestCorpus]);

  const loadNextCorpusPage = useCallback((): void => {
    if (corpus.state !== "ready" || corpus.page.nextCursor.state !== "present") return;
    requestCorpus(corpus.page.nextCursor.value, corpus.page);
  }, [corpus, requestCorpus]);

  const openCorpusSearch = useCallback((): void => {
    setMode("corpus");
    setOpen(true);
  }, []);

  const onOpenChange = useCallback((next: boolean): void => {
    setOpen(next);
    if (!next) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openCorpusSearch}
        aria-label="Search runs across dates"
        className={cn(
          "ml-auto flex min-w-0 max-w-[240px] flex-1 items-center gap-[var(--ds-space-snug)] border px-[var(--ds-space-base)] text-left",
          "h-[var(--ds-h-md)] rounded-[var(--ds-radius-md)] border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)]",
          dsFocus,
          dsMotion.base,
          "hover:border-[color:var(--ds-border-loud)]",
        )}
      >
        <Search aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
        <span className={cn(dsText.meta, "min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]")}>
          Search runs…
        </span>
        <Kbd>/</Kbd>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="xl"
          title={mode === "corpus" ? "Search runs across dates" : "Search this day"}
          description={mode === "corpus"
            ? "The measured Separations corpus only. Search run identifiers, trace identifiers, or workflow identity."
            : "Name, subject, trace id, run id or workflow over the rows this day already served."}
        >
          <div
            className="border-b border-[color:var(--ds-border)] px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)]"
          >
            <div role="group" aria-label="Search scope" className={cn("mb-[var(--ds-space-base)] inline-flex border p-[var(--ds-space-hair)]", TOP_BAR_SCOPE_TOGGLE_GROUP)}>
              <button
                type="button"
                aria-pressed={mode === "corpus"}
                onClick={() => setMode("corpus")}
                className={cn(
                  "px-[var(--ds-space-base)]",
                  TOP_BAR_SCOPE_TOGGLE_HIT_AREA,
                  dsText.meta,
                  dsFocus,
                  dsMotion.fast,
                  mode === "corpus" ? "bg-[var(--ds-surface-3)] font-semibold text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-muted)]",
                )}
              >
                Across dates
              </button>
              <button
                type="button"
                aria-pressed={mode === "day"}
                onClick={() => setMode("day")}
                className={cn(
                  "px-[var(--ds-space-base)]",
                  TOP_BAR_SCOPE_TOGGLE_HIT_AREA,
                  dsText.meta,
                  dsFocus,
                  dsMotion.fast,
                  mode === "day" ? "bg-[var(--ds-surface-3)] font-semibold text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-muted)]",
                )}
              >
                This day
              </button>
            </div>
            <SearchInput
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              placeholder={mode === "corpus" ? "sp-090505 · separations" : "Nguyen · 10777012 · pl-090505-0005 · person-lookup"}
              aria-label={mode === "corpus" ? "Search the Separations corpus" : "Search this day"}
              role={mode === "corpus" ? "searchbox" : undefined}
              maxLength={160}
              onKeyDown={(event) => {
                if (mode !== "corpus" || event.key !== "ArrowDown") return;
                const first = document.querySelector<HTMLButtonElement>("button[data-corpus-search-result]");
                if (first === null) return;
                event.preventDefault();
                first.focus();
              }}
            />
            {mode === "day" && examples.length > 0 && (
              <div className="mt-[var(--ds-space-base)] flex flex-wrap items-center gap-[var(--ds-space-tight)]">
                <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Try:</span>
                {examples.map((example) => (
                  <Chip
                    key={example.query}
                    tone="neutral"
                    label={FIELD_LABEL[example.field]}
                    selected={query === example.query}
                    onSelect={() => setQuery(example.query)}
                  >
                    {example.query}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <DialogBody className="p-0">
            <div>
              {mode === "corpus" ? (
              <CorpusSearchOutcomeView
                resource={corpus}
                onMore={loadNextCorpusPage}
                onRetry={retryCorpus}
                onPick={(result) => {
                  setOpen(false);
                  onOpenCrossDateResult(result);
                }}
              />
              ) : (
              <DaySearchOutcomeView
                outcome={outcome}
                day={day}
                onPick={(runId) => {
                  setOpen(false);
                  onOpenRun(runId);
                }}
              />
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
