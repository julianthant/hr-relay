/**
 * UF-SET-2 — a takeover the Top Bar's switcher does not name presses NOTHING.
 *
 * The defect this pins: `shellView` folded `settings`, `intake` and `catalog`
 * onto `"queue"`, so `ShellViewSwitcher`'s `aria-pressed={view === candidate}`
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
import { activeTakeover, shellViewOf, type ActiveTakeover } from "../../../src/dashboard/app/url-state.js";
import { SHELL_VIEWS, type ShellViewSelection } from "../../../src/dashboard/surfaces/top-bar-model.js";

const BASE = { start: false } as const;

/** The whole `ActiveTakeover` union, so a seventh arm cannot go unpinned. */
const EVERY_TAKEOVER: readonly ActiveTakeover[] = [
  "settings",
  "intake",
  "archive",
  "activity",
  "explore",
  "catalog",
  "none",
];

describe("the Top Bar switcher's pressed segment", () => {
  it("presses nothing for every takeover the switcher does not name", () => {
    for (const [route, takeover] of [
      [{ ...BASE, settings: "storage" }, "settings"],
      [{ ...BASE, intake: "new" }, "intake"],
      [{ ...BASE, catalog: "" }, "catalog"],
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

  it("returns a value the switcher can render for every takeover in the union", () => {
    const renderable: readonly ShellViewSelection[] = [...SHELL_VIEWS, "none"];
    for (const takeover of EVERY_TAKEOVER) {
      assert.ok(
        renderable.includes(shellViewOf(takeover)),
        `shellViewOf(${takeover}) produced a segment the switcher cannot draw`,
      );
    }
  });
});
