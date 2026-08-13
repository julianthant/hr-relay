/**
 * D205 — the virtualized timecard grid is read to its END, or refused.
 *
 * The fake below is the defect, modelled: a ui-grid pair where the PINNED
 * viewport does not scroll and the BODY viewport does, and where the rendered
 * row set is a WINDOW recomputed from the body's scroll position. Chunk 1's
 * attempt 14 read 8 of 35 in-window days against exactly that shape and
 * reported a whole read, because it drove the pinned viewport and stopped when
 * `scrollTop` refused to advance — a true statement about the wrong widget.
 *
 * Every case here asserts the ANSWER (which days were gathered, or which
 * refusal names the shortfall), never the number of scroll steps: the point of
 * the fix is that the loop stops on the coverage invariant rather than on any
 * property of the scrollbar.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  MAX_GRID_SCROLL_STEPS,
  readVirtualizedGrid,
  type GridHarvest,
  type GridScrollGeometry,
  type RawTimecardGridRow,
  type VirtualizedGridPort,
} from "../../src/stores/new-kronos/driver/grid-scroll.js";
import {
  assertTimecardCoversRange,
  timecardRangeCoverage,
  type TimecardGridRow,
} from "../../src/domain/kronos/separation-timecard.js";

const ROW_HEIGHT = 30;
const VIEWPORT_ROWS = 14;

/** Attempt 14's real window: 07/06/2026 – 08/09/2026, 35 days. */
const RANGE = Object.freeze({
  start: new Date(2026, 6, 6),
  end: new Date(2026, 7, 9),
});

function dayRows(from: Date, count: number): readonly RawTimecardGridRow[] {
  return Array.from({ length: count }, (_unused, index) => {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + index);
    return Object.freeze({
      month: at.getMonth() + 1,
      day: at.getDate(),
      rawDateCell: `Day ${String(at.getMonth() + 1)}/${String(at.getDate())}`,
      cells: Object.freeze([`sched-${String(index)}`, "08:00", "17:00", "", "", "", "", "", "", ""]),
    });
  });
}

interface FakeGridOptions {
  /** Every row the grid holds, in order — the answer a whole read must reach. */
  readonly rows: readonly RawTimecardGridRow[];
  /** When true the body viewport ignores writes, as a wedged grid would. */
  readonly frozen?: boolean;
}

/**
 * A virtualized grid whose rendered window is a pure function of its scroll
 * position, plus the counters a test needs to see what the loop actually did.
 */
function fakeGrid(options: FakeGridOptions) {
  const canvas = options.rows.length * ROW_HEIGHT;
  const client = VIEWPORT_ROWS * ROW_HEIGHT;
  const maxScroll = Math.max(0, canvas - client);
  let scrollTop = 0;
  let harvests = 0;
  let settles = 0;
  const geometry = (): GridScrollGeometry => ({ scrollTop, scrollHeight: canvas, clientHeight: client });
  const port: VirtualizedGridPort = {
    harvest: () => {
      harvests++;
      const first = Math.floor(scrollTop / ROW_HEIGHT);
      return Promise.resolve<GridHarvest>({
        ...geometry(),
        rows: options.rows.slice(first, first + VIEWPORT_ROWS),
      });
    },
    scrollTo: (top: number) => {
      if (options.frozen !== true) scrollTop = Math.min(maxScroll, Math.max(0, top));
      return Promise.resolve(geometry());
    },
    settle: () => { settles++; return Promise.resolve(); },
    refuse: (message: string) => new Error(`[new-kronos] ${message}`),
  };
  return {
    port,
    counters: () => ({ harvests, settles }),
    position: () => scrollTop,
  };
}

/** The grid's own shape: WFD paints whole pay periods, so the window overhangs. */
const WINDOW_ROWS = dayRows(new Date(2026, 5, 21), 56);

function coveredDays(rows: readonly RawTimecardGridRow[]): number {
  return timecardRangeCoverage(rows, RANGE).expected.length
    - timecardRangeCoverage(rows, RANGE).missing.length;
}

describe("new-kronos virtualized grid read", () => {
  it("scrolls to the end and gathers every day of the applied window", async () => {
    const grid = fakeGrid({ rows: WINDOW_ROWS });
    const read = await readVirtualizedGrid(grid.port, RANGE);

    assert.equal(timecardRangeCoverage(read.rows, RANGE).complete, true);
    assert.equal(coveredDays(read.rows), 35, "the whole 35-day window was not gathered");
    assert.ok(read.scrollSteps > 0, "a 56-row grid in a 14-row viewport needs to scroll");
    assert.ok(read.scrollSteps < MAX_GRID_SCROLL_STEPS, "the read consumed its whole step budget");
  });

  /**
   * The regression itself. A single DOM read — which is what a grid that never
   * scrolls degenerates to — sees the opening window and nothing else. It must
   * REFUSE, naming what it saw against what was asked, and never return the
   * eight in-window days it happens to hold.
   */
  it("refuses a grid that will not scroll, naming days seen against days expected", async () => {
    const grid = fakeGrid({ rows: WINDOW_ROWS, frozen: true });
    await assert.rejects(
      readVirtualizedGrid(grid.port, RANGE),
      (error: Error) => {
        assert.match(error.message, /^\[new-kronos\] the virtualized timecard grid covers \d+ of 35 days/u);
        assert.match(error.message, /missing 07\/06\/2026/u);
        assert.match(error.message, /row\(s\) accumulated, viewport at/u);
        assert.match(error.message, /refusing to hand a truncated timecard to the fold/u);
        return true;
      },
    );
  });

  it("stops in bounded time on a wedged grid rather than scrolling forever", async () => {
    const grid = fakeGrid({ rows: WINDOW_ROWS, frozen: true });
    await assert.rejects(readVirtualizedGrid(grid.port, RANGE));
    // Three stalled steps, each polling for a repaint that never comes, plus the
    // opening read — nowhere near the 200-step cap, and never unbounded.
    assert.ok(grid.counters().harvests < 100, `wedged grid harvested ${String(grid.counters().harvests)} times`);
  });

  it("does one read and no scrolling when the opening window already covers the range", async () => {
    const narrow = Object.freeze({ start: new Date(2026, 6, 6), end: new Date(2026, 6, 10) });
    const grid = fakeGrid({ rows: dayRows(new Date(2026, 6, 6), 14) });
    const read = await readVirtualizedGrid(grid.port, narrow);
    assert.equal(read.scrollSteps, 0);
    assert.equal(timecardRangeCoverage(read.rows, narrow).complete, true);
  });

  /**
   * The loop and the fold must refuse the SAME reads. They share
   * `timecardRangeCoverage` for exactly this reason: a loop that believed it
   * had finished a read the fold then rejected is how the live attempt spent a
   * whole browser session to produce a refusal that named no scroll state.
   */
  it("agrees with the fold's own coverage refusal", async () => {
    const grid = fakeGrid({ rows: WINDOW_ROWS });
    const read = await readVirtualizedGrid(grid.port, RANGE);
    const projected: TimecardGridRow[] = read.rows.map((row) => ({
      month: row.month,
      day: row.day,
      rawDateCell: row.rawDateCell,
      schedule: "", punchIn: "", punchOut: "", transfer: "", payCode: "",
      amount: "", shift: "", daily: "", period: "", absence: "",
    }));
    assert.doesNotThrow(() => { assertTimecardCoversRange(projected, RANGE); });
    assert.throws(
      () => { assertTimecardCoversRange(projected.slice(0, 6), RANGE); },
      /timecard grid read covers \d+ of 35 days/u,
    );
  });
});
