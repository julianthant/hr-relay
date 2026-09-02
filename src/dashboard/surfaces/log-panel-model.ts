/**
 * Which tabs a run detail advertises, and which one opens.
 *
 * It lives beside `log-panel.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { elapsedSecondsBetween, fmtClock } from "./format.js";
import {
  LogPageCursorSchema,
  type LogRowWire,
  type NotePageSchema,
  type RunDetailWireSchema,
} from "../../domain/dashboard/run-detail.js";
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
 * Live pages must carry `rows`. The notes-only compatibility shape belongs to
 * frozen archive readers; this live surface must never silently reinterpret it.
 * The server sequence is the one ordering key. Observations may share a clock
 * instant, so time must never be used as a tie-breaker.
 */
function requireLiveLogRows(page: NotePage, requestedCursor: string): readonly LogRowWire[] {
  if (page.rows === undefined) {
    throw new Error(
      `live log page for run ${String(page.runId)} at cursor ${requestedCursor} is missing rows`,
    );
  }
  return page.rows;
}

export function logRowsOf(page: NotePage | undefined, requestedCursor: string): readonly LogRowWire[] {
  if (page === undefined) return [];
  return requireLiveLogRows(page, requestedCursor).toSorted((left, right) => left.sequence - right.sequence);
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

/**
 * One row of the observed ledger: the key the operator reads in the left
 * column, the whole `field · key` label + rendered value the search and the
 * hover title keep (the same pair `logPillsOf` serves), and, for a served
 * list, its items so the surface can show a count with a preview instead of
 * a JSON dump.
 */
export interface LogLedgerFact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly items: readonly string[] | undefined;
}

/** A field's facts. `nested` is false only when the field IS its single key. */
export interface LogLedgerField {
  readonly field: string;
  readonly nested: boolean;
  readonly facts: readonly LogLedgerFact[];
}

/** One direction's fields, in served order. A row carries one section per direction it has. */
export interface LogLedgerSection {
  readonly direction: "read" | "write";
  readonly fields: readonly LogLedgerField[];
}

function renderedListItem(item: unknown): string {
  return typeof item === "string" ? item : JSON.stringify(item);
}

/**
 * The redesigned observed row (2026-09-01): a key · value ledger instead of
 * one bordered chip per fact. Facts keep their served order; a key that
 * repeats its field prefix (`employee.location.value` under `employee`) is
 * shown without it, and a point whose only key IS its field
 * (`documentNumber`) is a plain row with no sub-head. Contiguous points of one
 * direction fold into one section so the direction is stated once, not once
 * per fact; a direction change starts a new section rather than reordering
 * served facts behind an earlier heading.
 */
export function logLedgerOf(row: LogRowWire): readonly LogLedgerSection[] {
  if (row.kind !== "observed") return [];
  const sections: { direction: "read" | "write"; fields: LogLedgerField[] }[] = [];
  for (const point of row.points) {
    const facts = point.values.map((value): LogLedgerFact => {
      const prefix = `${point.field}.`;
      const key = value.key.startsWith(prefix) ? value.key.slice(prefix.length) : value.key;
      const items = value.state === "allowed" && Array.isArray(value.value)
        ? value.value.map(renderedListItem)
        : undefined;
      return { key, label: `${point.field} · ${value.key}`, value: renderedRedactedValue(value), items };
    });
    const nested = !(facts.length === 1 && facts[0]?.key === point.field);
    const field: LogLedgerField = { field: point.field, nested, facts };
    const last = sections.at(-1);
    if (last !== undefined && last.direction === point.direction) {
      last.fields.push(field);
    } else {
      sections.push({ direction: point.direction, fields: [field] });
    }
  }
  return sections;
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
  const groups: { label: string | undefined; rows: LogRowWire[] }[] = [];
  for (const row of rows) {
    const label = groupLabelOf(row);
    const last = groups.at(-1);
    if (last !== undefined && last.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }
  return groups;
}

interface LogCursorIdentity {
  readonly digest: string;
  readonly offset: number;
}

function logCursorIdentity(cursor: string, runId: NotePage["runId"]): LogCursorIdentity {
  const parsed = LogPageCursorSchema.safeParse(cursor);
  if (!parsed.success) {
    throw new Error(`log continuation for run ${String(runId)} has invalid live cursor ${cursor}`);
  }
  const [, digest, offsetText] = parsed.data.split(":");
  if (digest === undefined || offsetText === undefined) {
    throw new Error(`log continuation for run ${String(runId)} has incomplete live cursor ${cursor}`);
  }
  return { digest, offset: Number(offsetText) };
}

/**
 * Append the next immutable page without mutating, deduplicating, or
 * re-sorting evidence. A duplicate sequence is a broken cursor contract, not
 * a reason to silently drop a row.
 */
export function appendLogPage(page: NotePage, requestedCursor: string, next: NotePage): NotePage {
  if (page.nextCursor.state !== "present" || page.nextCursor.value !== requestedCursor) {
    const ownedCursor = page.nextCursor.state === "present" ? page.nextCursor.value : page.nextCursor.reason;
    throw new Error(
      `cannot append cursor ${requestedCursor}: current run ${String(page.runId)} owns ${ownedCursor}`,
    );
  }
  if (page.runId !== next.runId) throw new Error(`cannot append logs for ${String(next.runId)} to ${String(page.runId)}`);
  const requested = logCursorIdentity(requestedCursor, page.runId);
  if (next.nextCursor.state === "present") {
    const returned = logCursorIdentity(next.nextCursor.value, page.runId);
    if (returned.digest !== requested.digest) {
      throw new Error(
        `log continuation for run ${String(page.runId)} at cursor ${requestedCursor} returned snapshot digest `
        + `${returned.digest}; expected ${requested.digest}`,
      );
    }
  }
  const existing = logRowsOf(page, `current-before-${requestedCursor}`);
  const appended = requireLiveLogRows(next, requestedCursor);
  const seen = new Set(existing.map((row) => row.sequence));
  let previousSequence = requested.offset - 1;
  const currentLastRow = existing.at(-1);
  if (currentLastRow !== undefined && currentLastRow.sequence > previousSequence) {
    previousSequence = currentLastRow.sequence;
  }
  for (const row of appended) {
    if (seen.has(row.sequence)) throw new Error(`duplicate log sequence ${String(row.sequence)} in append page`);
    if (previousSequence !== undefined && row.sequence <= previousSequence) {
      throw new Error(
        `log continuation for run ${String(page.runId)} at cursor ${requestedCursor} must strictly increase `
        + `after sequence ${String(previousSequence)}; received ${String(row.sequence)}`,
      );
    }
    seen.add(row.sequence);
    previousSequence = row.sequence;
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

interface LogPageRequest {
  readonly ownerKey: string;
  readonly runId: string;
  readonly cursor: string;
}

interface LogPageSnapshot {
  readonly ownerKey: string;
  readonly page: NotePage | undefined;
  readonly request: LogPageRequest | undefined;
  readonly error: Error | undefined;
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
      ...logRowsOf(initial, "initial").map((row) => `${row.logId}:${String(row.sequence)}`),
    ].join("|");
  }, [initial]);
  const liveOwnerKey = useRef(initialKey);
  liveOwnerKey.current = initialKey;
  const [snapshot, setSnapshot] = useState<LogPageSnapshot>({
    ownerKey: initialKey,
    page: initial,
    request: undefined,
    error: undefined,
  });
  const current = useMemo<LogPageSnapshot>(() => (
    snapshot.ownerKey === initialKey
      ? snapshot
      : { ownerKey: initialKey, page: initial, request: undefined, error: undefined }
  ), [initial, initialKey, snapshot]);

  const loadMore = useCallback(() => {
    if (current.page?.nextCursor.state !== "present" || current.request !== undefined) return;
    const request: LogPageRequest = {
      ownerKey: initialKey,
      runId: String(current.page.runId),
      cursor: current.page.nextCursor.value,
    };
    setSnapshot({ ...current, request, error: undefined });
    const cursor = request.cursor;
    void load(cursor).then(
      (next) => {
        setSnapshot((settled) => {
          if (
            liveOwnerKey.current !== request.ownerKey
            || settled.ownerKey !== request.ownerKey
            || settled.request !== request
          ) return settled;
          if (settled.page === undefined) {
            return {
              ...settled,
              request: undefined,
              error: new Error(
                `log continuation for run ${request.runId} at cursor ${request.cursor} lost its current page`,
              ),
            };
          }
          try {
            return {
              ...settled,
              page: appendLogPage(settled.page, request.cursor, next),
              request: undefined,
              error: undefined,
            };
          } catch (caught) {
            return {
              ...settled,
              request: undefined,
              error: caught instanceof Error ? caught : new Error(String(caught)),
            };
          }
        });
      },
      (reason: unknown) => {
        setSnapshot((settled) => {
          if (
            liveOwnerKey.current !== request.ownerKey
            || settled.ownerKey !== request.ownerKey
            || settled.request !== request
          ) return settled;
          return {
            ...settled,
            request: undefined,
            error: reason instanceof Error ? reason : new Error("could not load more log lines"),
          };
        });
      },
    );
  }, [current, initialKey, load]);

  return {
    page: current.page,
    loading: current.request !== undefined,
    error: current.error,
    loadMore,
  };
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
export const TAB_ORDER: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

/**
 * The tab's WORD, in the one place both readers of it can see.
 *
 * `log-panel.tsx`'s `TAB_META` pairs each label with its glyph and the row/panel
 * catalog prints the same strip without one, so the label lived in a `.tsx` only
 * one of them could import. A specimen page naming a tab `Log` while the panel
 * draws `Logs` is precisely the drift a reference surface exists to prevent.
 */
export const PANEL_TAB_LABEL: Record<PanelTab, string> = {
  review: "Review",
  people: "People",
  logs: "Logs",
  receipt: "Receipt",
};

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

/* ── D273 item 2 — the timeline's two halves, its orphan wait, its dim ────── */

type RunGate = RunDetailWire["gate"];

/**
 * Every state a timeline SEGMENT can be in, whichever strip drew it — D225's
 * categorical steps and the read-forward per-event strip share one vocabulary,
 * so the three folds below are written once against the union rather than
 * twice against each half.
 */
export type TimelineSegmentState =
  | NonNullable<RunDetailWire["timeline"]["steps"]>[number]["state"]
  | RunDetailWire["timeline"]["events"][number]["state"];

/**
 * The states in which a segment ACTUALLY RAN, and therefore in which "no
 * duration" means the panel could not measure it.
 *
 * `pending` never ran, `skipped` was never started, and `replayed` deliberately
 * emitted no span of its own (D259) — each already says so with its own shape
 * and its own word, so dimming them would be a second cue for a fact that is
 * stated, not a missing measurement.
 */
const RAN_STATES: readonly TimelineSegmentState[] = ["active", "done", "failed", "cancelled"];

/**
 * D273 item 2 (`docs/decisions/2026-08-25-03a-demo-fidelity-run-detail.md`,
 * answered A on 2026-08-26; ledger 2 row B44) — the demo dims a segment it
 * could not measure (`DemoLogPanel.tsx:617`), so an unmeasured step is legible
 * as unmeasured rather than as one whose number happens to be missing.
 */
export function timelineSegmentUnmeasured(
  state: TimelineSegmentState,
  durationSec: number | undefined,
): boolean {
  return durationSec === undefined && RAN_STATES.includes(state);
}

/**
 * D273 item 2 (ledger 2 row B57) — THE ORPHAN WAIT.
 *
 * A run whose gate is open but whose segments record no `blocked` state has no
 * bar for the wait to ride, and the demo keeps a trailing segment precisely so
 * that a wait can never vanish because the shape did not line up: *"the one
 * thing this timeline may not do"* (`DemoLogPanel.tsx:687-705`). The wait is
 * served — `gate.openedAt` is right there — so its absence from the strip would
 * be the surface losing a fact it holds, which is the failure mode this repo's
 * fail-loud rule exists for.
 */
export function timelineHasOrphanGate(
  states: readonly TimelineSegmentState[],
  gate: RunGate,
): boolean {
  return gate.state === "open" && !states.includes("blocked");
}

/**
 * D273 item 2 (ledger 2 rows B60/B61) — the axis names BOTH halves.
 *
 * The segments are equal-width and make no duration claim, so this line is
 * where duration lives — and the demo names the WORKING half and the WAITING
 * half rather than one total (`DemoLogPanel.tsx:711-717`). The rebuild used to
 * print the first→last event SPAN under the word `elapsed`, which is a real
 * number about a different thing: a run parked for an hour after four seconds
 * of work reported an hour of work.
 *
 * `workingSec` is the SUM of the durations the executor actually measured, and
 * it is `undefined` when NOTHING was measured — a zero there would claim a run
 * did no work when the truth is that no span recorded any. `waitingSec` is the
 * open gate's age against the served clock (D256), so the panel and the queue
 * can never report two ages for one wait.
 */
export interface TimelineAxisTotals {
  /** The measured working time, or `undefined` when no segment was measured. */
  readonly workingSec: number | undefined;
  /** The open gate's age, or `undefined` when no gate is open. */
  readonly waitingSec: number | undefined;
}

export function timelineAxisTotals(
  durationsSec: readonly (number | undefined)[],
  gate: RunGate,
  nowIso: string,
): TimelineAxisTotals {
  const measured = durationsSec.filter((sec): sec is number => sec !== undefined);
  return {
    workingSec: measured.length === 0 ? undefined : measured.reduce((sum, sec) => sum + sec, 0),
    waitingSec: gate.state === "open" ? elapsedSecondsBetween(gate.openedAt, nowIso) : undefined,
  };
}
