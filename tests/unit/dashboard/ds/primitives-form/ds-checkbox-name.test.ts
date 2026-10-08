/**
 * A `<label for>` names an `<input>`; it does NOT name the `<button role="checkbox">`
 * Radix renders (HTML-AAM computes a button's native name from its SUBTREE, and the
 * DS indicator inside it is `aria-hidden`). So the DS `Checkbox` must name its control
 * with `aria-labelledby` pointing at its OWN label span — one expression, no surface
 * may re-state it (ref lessons 2026-08-26, booked for the parity re-freeze).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Checkbox } from "../../../../../src/dashboard/ds/primitives/primitives-form.js";

/** The id `aria-labelledby` points at, and the text of the element carrying that id. */
function nameOf(html: string): { labelledBy: string; namedBy: string } {
  const labelledBy = /<button[^>]*\saria-labelledby="([^"]+)"/u.exec(html)?.[1];
  assert.ok(labelledBy, `the checkbox button carries no aria-labelledby: ${html}`);
  const target = new RegExp(`<span[^>]*\\sid="${labelledBy}"[^>]*>([^<]*)</span>`, "u").exec(html)?.[1];
  assert.ok(target !== undefined, `aria-labelledby="${labelledBy}" points at no span: ${html}`);
  return { labelledBy, namedBy: target };
}

describe("ds/Checkbox — the control carries an accessible name", () => {
  it("names the button from its own label span, not from the <label for>", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { label: "Select all rows", description: "Only some are checked" }),
    );
    assert.match(html, /role="checkbox"/u);
    assert.equal(nameOf(html).namedBy, "Select all rows");
  });

  it("names from the label alone — the description is not folded into the name", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { label: "Auto-retry parked writes", description: "Never available" }),
    );
    const { labelledBy, namedBy } = nameOf(html);
    assert.equal(namedBy, "Auto-retry parked writes");
    assert.equal(labelledBy.split(/\s+/u).length, 1, `expected one id, got "${labelledBy}"`);
    assert.doesNotMatch(html, new RegExp(`id="${labelledBy}"[^>]*>Never available`, "u"));
  });

  it("keeps the visible label wired to the same control, so the click target still toggles", () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { label: "Capture a screenshot" }));
    const controlId = /<button[^>]*\sid="([^"]+)"/u.exec(html)?.[1];
    assert.ok(controlId, `the checkbox button carries no id: ${html}`);
    assert.match(html, new RegExp(`<label[^>]*\\sfor="${controlId}"`, "u"));
  });
});
