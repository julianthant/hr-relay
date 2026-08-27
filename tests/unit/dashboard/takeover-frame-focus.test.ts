// @vitest-environment jsdom
/**
 * ENTERING a takeover moves focus into it — the open half of a pair this tree
 * only held the close end of.
 *
 * Settings, Archive, the Explorer and the Activity report were Radix `Dialog`s.
 * A dialog takes focus on open and gives it back on close for free; D272 item 1
 * / D274 item 5 turned all four into routed full-page takeovers, unit F4b
 * re-implemented the CLOSE arm by hand (`settingsCloseFocusTargetId`, pinned in
 * `settings-takeover.test.ts`), and nothing re-implemented the OPEN arm. The
 * result was a page that replaces the whole window while the operator's focus
 * stays on a door that is no longer rendered: the next Tab walks the top bar,
 * and a keyboard operator cannot reach the page they just opened without
 * re-Tabbing the entire shell.
 *
 * `TakeoverFrame` (D275 item 2 — ONE shared wrapper, kept as the accessibility
 * and motion convention) now owns it, so this file tests the wrapper rather
 * than four surfaces. Three claims, and each was run against a mutation of the
 * exact line it pins:
 *
 * 1. **The frame takes focus on mount.** Deleting the `node.focus(...)` call
 *    turns the first two tests red.
 * 2. **It is a focus TARGET, never a tab stop.** Dropping `tabIndex={-1}`
 *    turns THREE of the four red, which is the useful surprise: a bare
 *    `section` is not focusable, so `focus()` silently does nothing and claim
 *    1 collapses with it. The attribute is load-bearing, not decoration.
 * 3. **A descendant that focused itself in the same commit KEEPS focus.**
 *    Deleting the `node.contains(document.activeElement)` guard turns the third
 *    test red — the frame steals focus back off the control the surface
 *    deliberately focused on arrival.
 *
 * A fourth claim earned its place the hard way. Focus was reasoned to be
 * invisible to the parity corpus — the frame carries no `ds-focus` class, so
 * the product's opt-in `.ds-focus:focus-visible` ring never paints. The lane
 * disagreed: 38 references moved, 2548 pixels each, tracing the frame's own
 * perimeter. The ring was CHROMIUM'S, not the product's — a programmatic focus
 * with no preceding pointer interaction matches `:focus-visible`, and the UA's
 * `outline: auto` picked up the base layer's `* { outline-color }`. So opening
 * any takeover drew a ring around the whole page. `outline-none` suppresses it,
 * and the fourth test pins that class: the operator can never tab TO this
 * element, so an indicator on it points at nothing actionable, and it is the
 * region's accessible NAME that announces the arrival.
 *
 * That assertion is a class check, which on its own would be weak — the real
 * proof is the parity lane going green with zero references moved. It lives
 * here so the fast lane catches a deletion in seconds rather than in the 5
 * minutes the reference corpus costs.
 */
import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { TakeoverFrame } from "../../../src/dashboard/ds/primitives-layout.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

/** The takeover's own root — the `section` the frame renders and names. */
function frameOf(label: string): HTMLElement {
  const node = document.querySelector(`section[aria-label="${label}"]`);
  assert.ok(node instanceof HTMLElement, `no takeover frame is labelled "${label}"`);
  return node;
}

/**
 * Mounts a takeover the way the shell does: into a host that is already in the
 * document, so `document.activeElement` is a real answer rather than a
 * detached-tree artefact.
 */
async function mountTakeover(label: string, children: ReactNode[]): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(TakeoverFrame, { label, children }));
  });
}

describe("ds/TakeoverFrame — entering a takeover moves focus into it", () => {
  it("focuses its own labelled section on mount", async () => {
    await mountTakeover("Activity report", [
      createElement("button", { key: "b", type: "button" }, "Export"),
    ]);
    assert.equal(document.activeElement, frameOf("Activity report"));
  });

  it("leaves the door it was opened from — focus does not stay on the trigger", async () => {
    // The gear/segment the operator pressed. It stays MOUNTED (the top bar
    // renders it regardless of which takeover is open), which is precisely why
    // a missing focus move is invisible until someone presses Tab.
    const door = document.createElement("button");
    door.type = "button";
    door.id = "the-door";
    document.body.append(door);
    door.focus();
    assert.equal(document.activeElement, door, "the fixture must start with the door focused");

    await mountTakeover("Archive", [createElement("button", { key: "b", type: "button" }, "Back")]);
    assert.notEqual(document.activeElement, door);
    assert.equal(document.activeElement, frameOf("Archive"));
  });

  it("is a focus target, not a tab stop", async () => {
    await mountTakeover("Workflow explorer", []);
    assert.equal(frameOf("Workflow explorer").getAttribute("tabindex"), "-1");
  });

  it("paints no focus ring — the UA's included", async () => {
    await mountTakeover("Workflow explorer", []);
    const cls = frameOf("Workflow explorer").className.split(/\s+/u);
    // Chromium's own `:focus-visible { outline: auto }` matches a programmatic
    // focus. Without this class the ring traced the whole page and moved 38
    // parity references; jsdom computes no UA styles, so the class IS the
    // assertion here and the parity corpus is the proof behind it.
    assert.ok(cls.includes("outline-none"), `the frame must suppress the UA ring: ${cls.join(" ")}`);
    // And it must not have opted INTO the product ring by accident.
    assert.ok(!cls.includes("ds-focus"), "the frame is not an interactive control");
  });

  it("does not steal focus from a descendant that took it in the same commit", async () => {
    // React applies `autoFocus` in the commit phase, before the frame's passive
    // effect runs — the same ordering a surface gets when it focuses a control
    // of its own on arrival. The frame must yield to it.
    await mountTakeover("Settings", [
      createElement("input", { key: "q", type: "search", autoFocus: true, "aria-label": "Search settings" }),
    ]);
    const focused = document.activeElement;
    assert.ok(focused instanceof HTMLInputElement, `expected the search input to keep focus, got ${String(focused?.tagName)}`);
    assert.equal(focused.getAttribute("aria-label"), "Search settings");
    assert.notEqual(focused, frameOf("Settings"));
  });
});
