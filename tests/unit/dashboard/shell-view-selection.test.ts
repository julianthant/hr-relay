/**
 * UF-SET-2 — a takeover the Top Bar's switcher does not name presses NOTHING.
 *
 * The defect this pins: `shellView` folded `settings` and `intake` (and, until
 * D295 moved it inside Settings, the UI catalog) onto `"queue"`, so `ShellViewSwitcher`'s `aria-pressed={view === candidate}`
 * lit `Dashboard` at the same moment the gear was lit — two simultaneous
 * "you are here" claims with a takeover covering the dashboard, and only one of
 * them true. The demo has never done this (legacy `1ec1d870`
 * `src/dashboard/components/dev/rebuild-demo/DemoShell.tsx:560-573`).
 *
 * Every arm is driven from a ROUTE rather than from the takeover token, because
 * the claim is about what the operator sees after following a link, and the
 * precedence between two keys on one link is part of that answer.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { activeTakeover, shellViewOf, type ActiveTakeover } from "../../../src/dashboard/app/navigation/url-state.js";
import { SHELL_VIEWS, type ShellViewSelection } from "../../../src/dashboard/surfaces/shell/top-bar-model.js";

const BASE = { start: false } as const;

/**
 * The whole `ActiveTakeover` union against the segment the switcher must press
 * for each arm. `satisfies Record<ActiveTakeover, ShellViewSelection>` pins it
 * in both directions: a sixth takeover added to the union fails to compile
 * here until this table names its segment, and a key the union drops fails too.
 */
const SEGMENT_OF = {
  settings: "none",
  intake: "none",
  archive: "archive",
  explore: "explorer",
  activity: "activity",
  none: "queue",
} as const satisfies Record<ActiveTakeover, ShellViewSelection>;

describe("the Top Bar switcher's pressed segment", () => {
  it("presses nothing for every takeover the switcher does not name", () => {
    for (const [route, takeover] of [
      [{ ...BASE, settings: "storage" }, "settings"],
      [{ ...BASE, intake: "e1f2a3b4-0000-4000-8000-000000000001" }, "intake"],
    ] as const) {
      assert.equal(activeTakeover(route), takeover);
      assert.equal(shellViewOf(activeTakeover(route)), "none", `${takeover} must press no segment`);
    }
  });

  it("presses the segment that owns the main region for the three it does name", () => {
    assert.equal(shellViewOf(activeTakeover({ ...BASE, archive: "index" })), "archive");
    assert.equal(shellViewOf(activeTakeover({ ...BASE, explore: "separations" })), "explorer");
    assert.equal(shellViewOf(activeTakeover({ ...BASE, activity: "" })), "activity");
  });

  it("presses Dashboard only when no takeover owns the main region", () => {
    assert.equal(shellViewOf(activeTakeover({ ...BASE, day: "2026-08-27" })), "queue");
  });

  it("follows the route's own precedence rather than a second copy of it", () => {
    // A link may carry more than one key. The segment must light the region
    // that actually renders — `settings` outranks `archive`, so the switcher
    // presses nothing even though `?archive=` is present.
    assert.equal(shellViewOf(activeTakeover({ ...BASE, settings: "", archive: "index" })), "none");
    assert.equal(shellViewOf(activeTakeover({ ...BASE, archive: "index", explore: "separations" })), "archive");
  });

  /**
   * The arm table, asserted per takeover. Its predecessor only checked that the
   * result was a member of `[...SHELL_VIEWS, "none"]`, which the return type
   * already guarantees — a test tsc owned, that could not go red for any wiring
   * mistake (unit U4b). This one names the expected segment for each arm, so a
   * takeover folded onto the wrong one fails here.
   */
  it("presses the segment its arm names, for every takeover in the union", () => {
    for (const [takeover, segment] of Object.entries(SEGMENT_OF) as readonly (readonly [
      ActiveTakeover,
      ShellViewSelection,
    ])[]) {
      assert.equal(shellViewOf(takeover), segment, `shellViewOf(${takeover}) pressed the wrong segment`);
      if (segment !== "none") {
        // The other half: a segment the switcher draws no button for would
        // press nothing on screen while reading as pressed here.
        assert.ok(
          SHELL_VIEWS.includes(segment),
          `${takeover} names ${segment}, which the switcher draws no button for`,
        );
      }
    }
  });
});
