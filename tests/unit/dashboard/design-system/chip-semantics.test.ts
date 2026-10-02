/** Queue facts use this shared primitive; a clipped paint must retain its full value. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Chip } from "../../../../src/dashboard/ds/ui.js";

describe("Chip — shared fact semantics", () => {
  it("keeps the label, full hover value, and single-line clipping contract together", () => {
    const html = renderToStaticMarkup(createElement(
      Chip,
      { children: "filed after signing", label: "ticket", title: "ticket filed after signing" },
    ));
    assert.match(html, /ticket/u);
    assert.match(html, /title="ticket filed after signing"/u);
    assert.match(html, /whitespace-nowrap/u);
    assert.match(html, /min-w-0 truncate/u);
  });
});
