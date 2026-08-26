/**
 * The member line's toggle paints 24px — WCAG 2.2 AA's minimum (2.5.8) and the
 * right size for a mouse on a dense table — and a finger needs 44. The overlay
 * that closes that gap is pinned here in both directions, because BOTH halves
 * can fail silently: a class that never reaches the button gives no target at
 * all, and an ungated one would reach 8px into the neighbouring member lines at
 * their fine-pointer 28px pitch and mark the WRONG member checked.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { IconButton } from "../../../src/dashboard/ds/ui.js";
import {
  MEMBER_NAME_TOUCH_TARGET,
  MEMBER_TOUCH_TARGET,
  MEMBER_TOUCH_TARGET_HOST,
  ROW_INFO_TOUCH_LINE,
  ROW_INFO_TOUCH_TARGET,
} from "../../../src/dashboard/surfaces/queue-model.js";

describe("the member line's touch target", () => {
  it("declares a 44px overlay, anchored to the control's left edge, only on a coarse pointer", () => {
    assert.match(MEMBER_TOUCH_TARGET, /pointer-coarse:after:size-11/u, "44px is the floor a finger needs");
    assert.match(MEMBER_TOUCH_TARGET, /pointer-coarse:after:-translate-y-1\/2/u);

    // ANCHORED, NOT CENTRED. Centred, the overlay reaches ~10px left of a 24px
    // control and the thing 4px to its left is the member's NAME — the row's
    // selection — so a tap on the end of a truncated name toggled the checkbox.
    assert.match(MEMBER_TOUCH_TARGET, /pointer-coarse:after:left-0(\s|$)/u);
    assert.ok(
      !/pointer-coarse:after:-translate-x-1\/2/u.test(MEMBER_TOUCH_TARGET),
      "re-centring the overlay puts it back over the name button beside it",
    );

    // Every `after:` utility carries the gate. One that did not would grow the
    // hit area on a mouse too, where the 28px pitch makes it overlap.
    const ungated = MEMBER_TOUCH_TARGET
      .split(" ")
      .filter((utility) => utility.startsWith("after:"));
    assert.deepEqual(ungated, [], "an ungated overlay would steal clicks from the member line above it");
  });

  it("positions the overlay, which an `after:` without `relative` would hang off the page instead", () => {
    assert.match(MEMBER_TOUCH_TARGET, /(^|\s)relative(\s|$)/u);
    assert.match(MEMBER_TOUCH_TARGET, /(^|\s)touch-manipulation(\s|$)/u);
  });

  it("un-clips the cell the overlay hangs in, on a coarse pointer and nowhere else", () => {
    // A 44px overlay inside an `overflow: hidden` cell is 44px in the class list
    // and 24px to a finger: the cell is exactly as tall as the paint it holds.
    assert.match(MEMBER_TOUCH_TARGET_HOST, /(^|\s)pointer-coarse:overflow-visible(\s|$)/u);

    // The name still truncates. Dropping `truncate` here rather than gating the
    // overflow would let a long member name run across the detail column on
    // every pointer, which is a fine-pointer regression the parity corpus WOULD
    // photograph.
    assert.match(MEMBER_TOUCH_TARGET_HOST, /(^|\s)truncate(\s|$)/u);

    // And the escape carries the gate. Ungated, the fine-pointer cell stops
    // clipping too — the half of this fix that no coarse measurement can catch.
    const ungated = MEMBER_TOUCH_TARGET_HOST
      .split(" ")
      .filter((utility) => utility.startsWith("overflow-"));
    assert.deepEqual(ungated, [], "un-clipping the cell on a mouse would unclip the name beside it");
  });

  it("actually reaches the rendered button", () => {
    const html = renderToStaticMarkup(createElement(IconButton, {
      size: "sm",
      className: MEMBER_TOUCH_TARGET,
      label: "Mark Jordan Reyes checked by you",
      icon: null,
    }));
    assert.match(html, /pointer-coarse:after:size-11/u, "the class must survive `cn` onto the button element");
    assert.match(html, /aria-label="Mark Jordan Reyes checked by you"/u);
  });
});

describe("the member line's OTHER control", () => {
  it("gives the name button 44px of height on a coarse pointer and nothing on a fine one", () => {
    // `min-h`, so a height utility ordered after it cannot take it back.
    assert.match(MEMBER_NAME_TOUCH_TARGET, /(^|\s)pointer-coarse:min-h-11(\s|$)/u);
    const ungated = MEMBER_NAME_TOUCH_TARGET
      .split(" ")
      .filter((utility) => !utility.startsWith("pointer-coarse:"));
    assert.deepEqual(ungated, [], "a 44px name at the fine 28px pitch overlaps the lines above and below");
  });
});

describe("the row ⓘ's touch target", () => {
  it("declares the same 44px overlay, centred, only on a coarse pointer", () => {
    assert.match(ROW_INFO_TOUCH_TARGET, /pointer-coarse:after:size-11/u);
    assert.match(ROW_INFO_TOUCH_TARGET, /pointer-coarse:after:-translate-x-1\/2/u);
    assert.match(ROW_INFO_TOUCH_TARGET, /pointer-coarse:after:-translate-y-1\/2/u);
    assert.match(ROW_INFO_TOUCH_TARGET, /(^|\s)relative(\s|$)/u, "an `after:` with no `relative` hangs off the page");
    assert.match(ROW_INFO_TOUCH_TARGET, /(^|\s)touch-manipulation(\s|$)/u);

    const ungated = ROW_INFO_TOUCH_TARGET
      .split(" ")
      .filter((utility) => utility.startsWith("after:"));
    assert.deepEqual(ungated, [], "an ungated overlay would put 44px of invisible target on a dense mouse row");
  });

  it("grows the LINE too, because the card's `overflow-hidden` clips whatever the line does not hold", () => {
    assert.match(ROW_INFO_TOUCH_LINE, /(^|\s)pointer-coarse:min-h-11(\s|$)/u);
    const ungated = ROW_INFO_TOUCH_LINE
      .split(" ")
      .filter((utility) => !utility.startsWith("pointer-coarse:"));
    assert.deepEqual(ungated, [], "a 44px title line on a mouse is a density regression the corpus would photograph");
  });
});
