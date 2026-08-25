/**
 * Which tabs a run detail advertises, and which one opens.
 *
 * It lives beside `log-panel.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { fmtClock } from "./format.js";
import type { LogRowWire, NotePageSchema, RunDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunDetailSectionSchema } from "../../domain/dashboard/primitives.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;
export type NotePage = z.infer<typeof NotePageSchema>;

/** A small, presentation-only value fact: the wire remains the evidence authority. */
export interface LogPill {
  readonly direction: "read" | "write";
  readonly label: string;
  readonly value: string;
}

/** A contiguous run of rows a sticky producer heading can truthfully name. */
export interface LogRowGroup {
  /** Notes have no producer and therefore no invented heading. */
  readonly label: string | undefined;
  readonly rows: readonly LogRowWire[];
}

/**
 * Live pages now carry `rows`; legacy archive pages still carry only the
 * compatibility notes mirror. In both cases the server sequence is the one
 * ordering key. Observations may share a clock instant, so time must never be
 * used as a tie-breaker.
 */
export function logRowsOf(page: NotePage | undefined): readonly LogRowWire[] {
  if (page === undefined) return [];
  const rows: readonly LogRowWire[] = page.rows ?? page.notes.map((note) => ({
    kind: "note" as const,
    logId: note.noteId,
    sequence: note.sequence,
    note,
  }));
  return rows.toSorted((left, right) => left.sequence - right.sequence);
}

function renderedRedactedValue(value: Extract<LogRowWire, { kind: "observed" }> ["points"][number]["values"][number]): string {
  if (value.state === "redacted") return "redacted";
  if (typeof value.value === "string") return value.value;
  if (typeof value.value === "number") return String(value.value);
  return JSON.stringify(value.value);
}

/** One displayed pill per redacted value fact, retaining its point direction. */
export function logPillsOf(row: LogRowWire): readonly LogPill[] {
  if (row.kind !== "observed") return [];
  return row.points.flatMap((point) => point.values.map((value) => ({
    direction: point.direction,
    label: `${point.field} · ${value.key}`,
    value: renderedRedactedValue(value),
  })));
}

/** The exact search contract: note prose, or an observed pill's label/value. */
export function rowMatchesLogQuery(row: LogRowWire, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return false;
  if (row.kind === "note") return row.note.message.toLocaleLowerCase().includes(normalized);
  return logPillsOf(row).some((pill) => `${pill.label} ${pill.value}`.toLocaleLowerCase().includes(normalized));
}

function groupLabelOf(row: LogRowWire): string | undefined {
  if (row.kind === "note") return undefined;
  return `${row.producer.step} · ${row.producer.taskId}`;
}

/**
 * Preserve stream order while grouping contiguous rows by their REAL producer.
 * A repeated step later in a run deliberately starts a new group: flattening
 * it into the first one would move intervening evidence behind a heading it
 * did not produce.
 */
export function groupLogRows(rows: readonly LogRowWire[]): readonly LogRowGroup[] {
  const groups: LogRowGroup[] = [];
  for (const row of rows) {
    const label = groupLabelOf(row);
    const last = groups.at(-1);
    if (last !== undefined && last.label === label) {
      groups[groups.length - 1] = { label, rows: [...last.rows, row] };
    } else {
      groups.push({ label, rows: [row] });
    }
  }
  return groups;
}

/**
 * Append the next immutable page without mutating, deduplicating, or
 * re-sorting evidence. A duplicate sequence is a broken cursor contract, not
 * a reason to silently drop a row.
 */
export function appendLogPage(page: NotePage, next: NotePage): NotePage {
  if (page.runId !== next.runId) throw new Error(`cannot append logs for ${String(next.runId)} to ${String(page.runId)}`);
  const existing = logRowsOf(page);
  const appended = logRowsOf(next);
  const seen = new Set(existing.map((row) => row.sequence));
  for (const row of appended) {
    if (seen.has(row.sequence)) throw new Error(`duplicate log sequence ${String(row.sequence)} in append page`);
    seen.add(row.sequence);
  }
  const rows = [...existing, ...appended];
  const notes = rows.flatMap((row) => row.kind === "note" ? [row.note] : []);
  return { runId: page.runId, rows, notes, nextCursor: next.nextCursor };
}

export interface LogPagesState {
  readonly page: NotePage | undefined;
  readonly loading: boolean;
  readonly error: Error | undefined;
  readonly loadMore: () => void;
}

/**
 * The logs section remains lazy. It appends only the server's next immutable
 * cursor page and leaves evidence already on screen intact while that request
 * is in flight or refused.
 */
export function useLogPages(
  initial: NotePage | undefined,
  load: (cursor: string) => Promise<NotePage>,
): LogPagesState {
  const initialKey = useMemo(() => {
    if (initial === undefined) return "absent";
    return [
      String(initial.runId),
      initial.nextCursor.state === "present" ? initial.nextCursor.value : initial.nextCursor.reason,
      ...logRowsOf(initial).map((row) => `${row.logId}:${String(row.sequence)}`),
    ].join("|");
  }, [initial]);
  const [page, setPage] = useState<NotePage | undefined>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    setPage(initial);
    setLoading(false);
    setError(undefined);
  }, [initial, initialKey]);

  const loadMore = useCallback(() => {
    if (page?.nextCursor.state !== "present" || loading) return;
    const cursor = page.nextCursor.value;
    setLoading(true);
    setError(undefined);
    void load(cursor).then(
      (next) => {
        setPage((current) => {
          if (current === undefined) throw new Error("the log page disappeared while its next page was loading");
          return appendLogPage(current, next);
        });
        setLoading(false);
      },
      (reason: unknown) => {
        setLoading(false);
        setError(reason instanceof Error ? reason : new Error("could not load more log lines"));
      },
    );
  }, [load, loading, page]);

  return { page, loading, error, loadMore };
}

/** The tab set this slice can draw. Review and People are advertised, not assumed. */
export type PanelTab = "review" | "people" | "logs" | "receipt";

/**
 * The tabs are SERVED, never fixed at four and never decided from a workflow.
 * `availableSections` is the descriptor's own answer, and the ORDER is ref frontend-backend-integration
 * §3.3's fixed composition: `Review · Logs · Receipt` / `People · Logs ·
 * Receipt` / `Logs · Receipt`. A section the wire does not advertise draws no
 * tab — a dead tab that opens an empty panel is worse than an absent one.
 */
const TAB_ORDER: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

export function tabsFor(detail: RunDetailWire): PanelTab[] {
  const advertised = new Set<RunDetailSection>(detail.availableSections);
  return TAB_ORDER.filter((tab) => advertised.has(tab));
}

/**
 * A failed run opens on the LOGS, ahead of every other default: its record now
 * lives in the stream at the line it died on, and moving the record off the
 * panel top must never put it behind a tab. Otherwise a run that has finished
 * opens on its receipt — the answer — and a run still working opens on its
 * stream.
 */
export function defaultTabFor(detail: RunDetailWire): PanelTab {
  const available = tabsFor(detail);
  const pick = (...preferred: PanelTab[]): PanelTab =>
    preferred.find((tab) => available.includes(tab)) ?? available[0] ?? "logs";
  if (detail.outcome.state === "terminal" && detail.outcome.result === "failed") return pick("logs");
  if (detail.outcome.state === "terminal") return pick("receipt", "logs");
  return pick("logs", "receipt");
}

/**
 * THE OUTCOME BAR'S WORDS for a settled run — D238.
 *
 * A REHEARSAL says so first. The bar states what the run came to, and for a dry
 * run what it came to is a PREVIEW: nothing was written, nothing was fenced,
 * and the verdict beside the word is `partial` rather than `verified-done`
 * because the receipt for the same run derives exactly that. The word leads
 * because the verdict is only readable once you know which kind of run produced
 * it — `partial` alone reads as a run that half-worked, which is the opposite
 * of what a clean rehearsal means.
 *
 * Exported as a pure function so the sentence is pinned by a test rather than
 * only by a screenshot: this tree renders no React in the unit lane, and the
 * one label that must never say `verified-done` for a preview is not a thing to
 * leave to the parity corpus alone (D187's lesson, from the other side).
 */
export function terminalOutcomeText(
  outcome: Extract<RunDetailWire["outcome"], { state: "terminal" }>,
): string {
  const rehearsal = outcome.rehearsal === true ? "dry run · " : "";
  return `${rehearsal}${outcome.result} · ${fmtClock(outcome.completedAt)}`;
}
