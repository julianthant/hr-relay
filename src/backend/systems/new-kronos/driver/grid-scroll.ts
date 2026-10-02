/**
 * The virtualized timecard grid's scroll-to-end read (D205).
 *
 * ## Why this is its own module with a port
 *
 * Chunk 1's live proof failed nine distinct ways; the ninth — durable failure
 * fingerprint `53336e1c`, seen 6x — was this loop, and it is the only one no
 * fixture could reach, because the loop lived inside a `page.evaluate` closure
 * that needed a real WFD grid to run at all. Attempt 14 read **8 of 35 in-window
 * days** (14 distinct days once the pay-period overhang is counted) over a
 * five-week window, reported a successful read, and left the fold to refuse it.
 *
 * So the ALGORITHM is separated from the browser. Everything page-shaped —
 * which viewport to drive, how a row is parsed out of the DOM — stays in the
 * interpreter behind `VirtualizedGridPort`; what is here is the part that was
 * wrong, and a fake virtualized grid can now exercise it exactly.
 *
 * ## The termination condition is the ANSWER, not the scrollbar
 *
 * The previous loop stopped when `scrollTop` refused to advance. That is a
 * statement about a widget, and it was a TRUE statement — the grid genuinely
 * would not scroll, because the position was being written to ui-grid's PINNED
 * viewport, which is synced from the body container and drives no
 * virtualization. A true statement about the wrong thing reported a whole read.
 *
 * WFD renders one row per calendar day, so a complete read holds every day the
 * applied window demands. That invariant — `timecardRangeCoverage`, the same
 * one `assertTimecardCoversRange` refuses on — is the loop's stopping rule, and
 * the loop REFUSES when it cannot reach it. Position and "did the row set grow"
 * survive only as stall detectors, so a grid that will not move gives up in
 * bounded time instead of scrolling forever.
 *
 * There is deliberately no "return what we got" arm. A missing day reads as a
 * day with no punch, which regresses a real termination's last day worked to a
 * plausible, wrong date — the exact silent-wrong-value failure this program
 * exists to prevent.
 */
import {
  describeTimecardCoverage,
  timecardRangeCoverage,
} from "../../../../rules/kronos/separation-timecard.js";
import type { TimecardDateRange } from "../../../../rules/time/timecard-period.js";

/** One rendered grid row, still raw — every derivation happens in the fold. */
export interface RawTimecardGridRow {
  readonly month: number;
  readonly day: number;
  readonly rawDateCell: string;
  readonly cells: readonly string[];
}

export interface GridScrollGeometry {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface GridHarvest extends GridScrollGeometry {
  readonly rows: readonly RawTimecardGridRow[];
}

export interface VirtualizedGridPort {
  /** Read the CURRENTLY rendered window, plus the driving viewport's geometry. */
  harvest(): Promise<GridHarvest>;
  /** Drive the scroll position, and report where it actually landed. */
  scrollTo(top: number): Promise<GridScrollGeometry>;
  /** Wait one poll interval between repaint checks. */
  settle(): Promise<void>;
  /** Build the store's own error type for a refusal. */
  refuse(message: string): Error;
}

export interface VirtualizedGridRead {
  readonly rows: readonly RawTimecardGridRow[];
  readonly scrollSteps: number;
}

/**
 * None of these bounds is a guess about how far the grid goes — the coverage
 * invariant decides that. They exist so a grid that will not advance refuses in
 * bounded time.
 *
 * 200 steps at 0.6 of a viewport covers a window far wider than the ~3 months a
 * separations range can legitimately be; reaching the cap is a refusal, never a
 * result. The 0.6 overlap is deliberate: a step of a full viewport can skip a
 * band of rows when ui-grid's render window lags the scroll by a frame.
 */
export const MAX_GRID_SCROLL_STEPS = 200;
export const GRID_SCROLL_FRACTION = 0.6;
/** 20 polls of the caller's interval — 4s at 200ms — for ONE virtualized repaint. */
export const GRID_REPAINT_POLLS = 20;
/** Consecutive steps that add no new row before the read is declared stuck. */
export const GRID_SCROLL_STALL_LIMIT = 3;
/**
 * Polls of the caller's interval for the BODY to repaint onto a newly applied
 * window — 50 at 200ms, 10s.
 *
 * It is deliberately longer than one virtualized repaint: applying a range
 * makes WFD re-fetch the period, and the period LABEL switches first. Live run
 * `sp-064821-1fd7` (2026-08-14) proved the label alone is not the grid.
 */
export const GRID_APPLIED_WINDOW_POLLS = 50;

/** The rendered window's identity, for "has it repainted yet". */
function renderedDays(rows: readonly RawTimecardGridRow[]): string {
  return rows.map((row) => `${String(row.month)}/${String(row.day)}`).join(",");
}

export async function readVirtualizedGrid(
  port: VirtualizedGridPort,
  applied: TimecardDateRange,
): Promise<VirtualizedGridRead> {
  await port.scrollTo(0);
  let harvest = await port.harvest();
  let geometry: GridScrollGeometry = harvest;

  /*
   * Nothing is accumulated until the body PROVES it is painting the window
   * that was applied.
   *
   * The applied-range check upstream reads the period LABEL, and on live run
   * `sp-064821-1fd7` (2026-08-14) the label switched to 02/28/2026 - 04/30/2026
   * while the grid was still rendering the CURRENT pay period — so the first
   * harvest carried August rows, they went into `seen` permanently, and the
   * coverage computation then died inside a date formatter. A stale row can
   * never be scrolled away, so the only place to catch it is before the first
   * one is kept.
   */
  for (let attempt = 0; attempt < GRID_APPLIED_WINDOW_POLLS; attempt++) {
    if (harvest.rows.length > 0 && timecardRangeCoverage(harvest.rows, applied).outside.length === 0) break;
    if (attempt === GRID_APPLIED_WINDOW_POLLS - 1) {
      const stale = timecardRangeCoverage(harvest.rows, applied).outside;
      throw port.refuse(
        `the timecard grid never repainted onto the applied window after ${String(GRID_APPLIED_WINDOW_POLLS)} `
        + `poll(s): it renders ${String(harvest.rows.length)} row(s)`
        + (stale.length === 0 ? "" : ` dated ${stale.join(", ")}, which belong to no year inside it`)
        + " — the period label had already switched, so reading here would attribute another period's punches "
        + "to this separation",
      );
    }
    await port.settle();
    harvest = await port.harvest();
    geometry = harvest;
  }

  const seen = new Map<string, RawTimecardGridRow>();
  let scrollSteps = 0;
  let stalled = 0;
  let coverage = timecardRangeCoverage([], applied);

  for (let step = 0; step <= MAX_GRID_SCROLL_STEPS; step++) {
    const before = seen.size;
    for (const row of harvest.rows) {
      seen.set(`${String(row.month)}/${String(row.day)}|${row.cells.join(" ")}`, row);
    }
    coverage = timecardRangeCoverage([...seen.values()], applied);
    if (coverage.complete) break;
    // A row from another period cannot be scrolled away, so continuing would
    // only spend the whole step budget before refusing with a message about
    // the scroll instead of about the period.
    if (coverage.outside.length > 0) {
      throw port.refuse(
        `the timecard grid rendered ${coverage.outside.join(", ")} while showing the applied window — `
        + `${String(seen.size)} row(s) accumulated after ${String(scrollSteps)} scroll step(s); refusing to `
        + "read a grid that changed period mid-read",
      );
    }

    stalled = seen.size === before ? stalled + 1 : 0;
    const atEnd = geometry.clientHeight > 0
      && geometry.scrollTop + geometry.clientHeight >= geometry.scrollHeight - 1;
    // A grid at its end that produced nothing new has no more to give. Stopping
    // here is not "good enough" — the refusal below is what decides.
    if (stalled >= (atEnd ? 1 : GRID_SCROLL_STALL_LIMIT)) break;

    const target = geometry.scrollTop
      + Math.max(1, Math.floor(geometry.clientHeight * GRID_SCROLL_FRACTION));
    geometry = await port.scrollTo(target);
    scrollSteps++;

    // Wait for the virtualized grid to REPAINT. The condition is the set of
    // rendered DAYS changing — not a fixed delay, and not the first row's text,
    // which repeats whenever a window is revisited.
    const anchor = renderedDays(harvest.rows);
    for (let attempt = 0; attempt < GRID_REPAINT_POLLS; attempt++) {
      harvest = await port.harvest();
      if (renderedDays(harvest.rows) !== anchor) break;
      await port.settle();
    }
  }

  const rows = [...seen.values()];
  if (!coverage.complete) {
    throw port.refuse(
      `the virtualized timecard grid ${describeTimecardCoverage(coverage, applied)} after `
      + `${String(scrollSteps)} scroll step(s) — ${String(rows.length)} row(s) accumulated, viewport at `
      + `${String(geometry.scrollTop)}/${String(Math.max(0, geometry.scrollHeight - geometry.clientHeight))} `
      + `(client ${String(geometry.clientHeight)}px, canvas ${String(geometry.scrollHeight)}px). The grid `
      + "would not scroll to the end, so this read is PARTIAL; refusing to hand a truncated timecard to "
      + "the fold, because a missing day reads as a day with no punch and silently regresses the last "
      + "day worked",
    );
  }
  return Object.freeze({ rows: Object.freeze(rows), scrollSteps });
}
