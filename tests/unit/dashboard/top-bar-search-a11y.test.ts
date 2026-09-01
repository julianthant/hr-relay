/**
 * DCR4's compact scope control paints the incumbent 24px treatment while its
 * coarse-pointer target reaches 44px. This pins both the reach and the fact
 * that the two neighbouring controls cannot steal each other's press.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  TOP_BAR_SCOPE_TOGGLE_GROUP,
  TOP_BAR_SCOPE_TOGGLE_HIT_AREA,
} from "../../../src/dashboard/surfaces/day-search-model.js";

describe("the Top Bar search scope control", () => {
  it("keeps each 24px painted toggle inside an independent coarse-pointer 44px target", () => {
    assert.match(TOP_BAR_SCOPE_TOGGLE_HIT_AREA, /(^|\s)h-\[var\(--ds-h-sm\)\](\s|$)/u);
    assert.match(TOP_BAR_SCOPE_TOGGLE_HIT_AREA, /pointer-coarse:after:h-11/u);
    assert.match(TOP_BAR_SCOPE_TOGGLE_HIT_AREA, /pointer-coarse:after:inset-x-0/u);
    assert.ok(
      !/pointer-coarse:after:-translate-x-1\/2/u.test(TOP_BAR_SCOPE_TOGGLE_HIT_AREA),
      "a centred overlay extends into the neighbouring scope toggle",
    );
    assert.match(TOP_BAR_SCOPE_TOGGLE_HIT_AREA, /(^|\s)min-w-11(\s|$)/u);
    assert.match(TOP_BAR_SCOPE_TOGGLE_GROUP, /pointer-coarse:overflow-visible/u);

    const ungated = TOP_BAR_SCOPE_TOGGLE_HIT_AREA
      .split(" ")
      .filter((utility) => utility.startsWith("after:"));
    assert.deepEqual(ungated, [], "a fine-pointer overlay would overlap compact controls");
  });
});
