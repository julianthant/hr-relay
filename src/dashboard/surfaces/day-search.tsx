/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoTopBarSurfaces.tsx
 * (`DemoSearchControl` :388 and `SearchOutcomeView` :475).
 *
 * ONE DELIBERATE NARROWING, and it is named on the surface itself.
 *
 * The demo searches an in-memory corpus of every day it holds, and its dialog
 * says so ("across every day the tracker holds"). This repository has no
 * cross-run search route and is not getting one here: D184 deferred the
 * cross-day corpus because two runs is not a corpus, and inventing a second
 * server-side count/scan path is exactly what doc 03 §10.1 forbids.
 *
 * So this control is a FIND over the day the operator is already looking at —
 * the same `queueSurfaces` array the queue panel renders, in the browser, with
 * nothing fetched and nothing counted. Its placeholder, its dialog title and
 * its empty state all say "this day"; none of them claims a corpus it did not
 * read. When the cross-day route lands, `searchDaySurfaces` is what gains a
 * server sibling — the rendering below does not change.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SearchX } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Dialog,
  DialogBody,
  DialogContent,
  EmptyState,
  Kbd,
  MetaLine,
  SearchInput,
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
import { dsStatusOf, type QueueStatus } from "./status.js";
import { plural } from "./format.js";
import type { QueueSurfaceWire } from "./queue.js";

/* ── the find, as a pure function ────────────────────────────────────────── */

/**
 * Which field a hit matched on. Ordered by how a person searches: the words on
 * the row first, then the identifiers they paste.
 */
export type DaySearchField = "title" | "subtitle" | "trace" | "run" | "workflow";

const FIELD_LABEL: Record<DaySearchField, string> = {
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

/* ── the control ─────────────────────────────────────────────────────────── */

function DaySearchOutcomeView({
  outcome,
  onPick,
}: {
  outcome: DaySearchOutcome;
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
 */
export function DaySearchControl({
  surfaces,
  workflowLabelOf,
  onOpenRun,
}: {
  /** the day's whole queue projection — every workflow, not just the open panel */
  surfaces: readonly QueueSurfaceWire[];
  workflowLabelOf: (workflowId: string) => string;
  onOpenRun: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const outcome = useMemo(
    () => searchDaySurfaces(surfaces, query, workflowLabelOf),
    [surfaces, query, workflowLabelOf],
  );

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search this day’s runs"
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
          Search this day…
        </span>
        <Kbd>/</Kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="xl"
          title="Search this day"
          description="Name, subject, trace id, run id or workflow — over the rows this day already served. Step the date to search another day."
        >
          <div
            className="border-b border-[color:var(--ds-border)] px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)]"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || query === "") return;
              // Clearing is the cheaper correction, so it wins the first press;
              // a second Escape then falls through to the dialog and closes it.
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }}
          >
            <SearchInput
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              placeholder="Nguyen · 10777012 · pl-090505-0005"
              aria-label="Search query"
            />
          </div>

          <DialogBody className="p-0">
            <DaySearchOutcomeView
              outcome={outcome}
              onPick={(runId) => {
                setOpen(false);
                onOpenRun(runId);
              }}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
