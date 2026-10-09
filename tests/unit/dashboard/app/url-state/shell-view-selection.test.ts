
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseArchiveBrowse } from "../../../../../src/dashboard/app/navigation/archive-route-model.js";
import { parseRoute, routeToSearch, activeTakeover, shellViewOf, type ActiveTakeover } from "../../../../../src/dashboard/app/navigation/url-state.js";
import { SHELL_VIEWS, type ShellViewSelection } from "../../../../../src/dashboard/surfaces/shell/top-bar-model.js";

const BASE = { start: false } as const;


const SEGMENT_OF = {
  settings: "none",
  intake: "none",
  archive: "none",
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
    assert.equal(shellViewOf(activeTakeover({ ...BASE, archive: "index" })), "none", "the retired Archive notice has no switcher segment");
    assert.equal(shellViewOf(activeTakeover({ ...BASE, explore: "separations" })), "explorer");
    assert.equal(shellViewOf(activeTakeover({ ...BASE, activity: "" })), "activity");
  });

  it("presses Dashboard only when no takeover owns the main region", () => {
    assert.equal(shellViewOf(activeTakeover({ ...BASE, day: "2026-08-27" })), "queue");
  });

  it("follows the route's own precedence rather than a second copy of it", () => {

    assert.equal(shellViewOf(activeTakeover({ ...BASE, settings: "", archive: "index" })), "none");
    assert.equal(shellViewOf(activeTakeover({ ...BASE, archive: "index", explore: "separations" })), "none");
  });


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

it("keeps clean Archive routes and marks corrupt, invalid and oversized browsing input", () => {
  const browse = { filters: { workflow: "separations" }, columns: ["name"], section: 1 };
  assert.deepEqual(parseArchiveBrowse(JSON.stringify(browse)), browse);
  const route = { start: false, archive: "index", archiveBrowse: browse };
  assert.deepEqual(parseRoute(routeToSearch(route)).archiveBrowse, browse);
  for (const encoded of ["{", JSON.stringify({ unexpected: true }), JSON.stringify({ filters: {}, columns: ["name", "name"] }), " ".repeat(24001)]) {
    assert.equal(parseArchiveBrowse(encoded), null);
    const parsed = parseRoute(`?archive=index&archiveBrowse=${encodeURIComponent(encoded)}`);
    assert.equal(parsed.archiveBrowseInvalid, true);
    assert.equal(parsed.archiveBrowse, undefined);
  }
  assert.throws(() => routeToSearch({ ...route, archiveBrowse: { filters: {}, columns: ["x".repeat(24001)] } }), /Archive browsing state exceeds its route bounds/u);
});
