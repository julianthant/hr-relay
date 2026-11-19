import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Button, Chip, IconButton, Kbd } from "../../../../src/dashboard/ds/primitives/primitives-core.js";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Button and IconButton", () => {
  it("offers 28px and 32px with the 8px corner and no movement on press", () => {
    const md = html(createElement(Button, null, "Save"));
    const lg = html(createElement(Button, { size: "lg" }, "Save"));
    assert.match(md, /h-\[var\(--ds-h-md\)\]/u);
    assert.match(lg, /h-\[var\(--ds-h-lg\)\]/u);
    assert.match(lg, /rounded-\[8px\]/u);
    assert.doesNotMatch(md + lg, /translate-y/u);
    assert.match(md, /active:bg-/u);
  });

  it("draws icon controls at 28px/8px and 24px/6px with a darker press tint", () => {
    const icon = createElement("svg");
    const md = html(createElement(IconButton, { label: "Close", icon }));
    const sm = html(createElement(IconButton, { label: "Close", icon, size: "sm" }));
    assert.match(md, /size-\[var\(--ds-h-md\)\]/u);
    assert.match(md, /rounded-\[8px\]/u);
    assert.match(sm, /rounded-\[6px\]/u);
    assert.match(md, /aria-label="Close"/u);
    assert.match(md, /active:bg-/u);
    assert.doesNotMatch(md + sm, /translate-y/u);
  });
});

describe("Chip and Kbd", () => {
  it("names a chip's remove button after its text", () => {
    const out = html(createElement(Chip, { onRemove: () => undefined, children: "UCPath" }));
    assert.match(out, /aria-label="Remove UCPath"/u);
  });

  it("draws a keycap with a border and a corner under the pill radius", () => {
    const out = html(createElement(Kbd, null, "⌘J"));
    assert.match(out, /border/u);
    assert.doesNotMatch(out, /rounded-full/u);
  });
});

