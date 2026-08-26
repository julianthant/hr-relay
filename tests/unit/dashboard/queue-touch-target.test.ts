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
import { MEMBER_TOUCH_TARGET } from "../../../src/dashboard/surfaces/queue-model.js";

describe("the member line's touch target", () => {
  it("declares a 44px overlay, centred on the control, only on a coarse pointer", () => {
    assert.match(MEMBER_TOUCH_TARGET, /pointer-coarse:after:size-11/u, "44px is the floor a finger needs");
    assert.match(MEMBER_TOUCH_TARGET, /pointer-coarse:after:-translate-x-1\/2/u);
    assert.match(MEMBER_TOUCH_TARGET, /pointer-coarse:after:-translate-y-1\/2/u);

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
