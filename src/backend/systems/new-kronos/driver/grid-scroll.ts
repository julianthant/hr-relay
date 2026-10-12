// Grid virtualization hides most rows; scroll the body and prove full day coverage before returning a timecard.
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


export const MAX_GRID_SCROLL_STEPS = 200;
const GRID_SCROLL_FRACTION = 0.6;
/** 20 polls of the caller's interval — 4s at 200ms — for ONE virtualized repaint. */
const GRID_REPAINT_POLLS = 20;
/** Consecutive steps that add no new row before the read is declared stuck. */
const GRID_SCROLL_STALL_LIMIT = 3;
// Wait for the grid body to repaint; applied range text alone does not prove the rendered row window.
const GRID_APPLIED_WINDOW_POLLS = 50;

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

  // Accumulate only rows from the proved applied window; unchanged range text does not prove body repaint.
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
    // A row outside the applied period is a range failure; scrolling cannot repair it.
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
