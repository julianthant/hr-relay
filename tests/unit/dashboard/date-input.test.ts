import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { DateInput } from "../../../src/dashboard/ds/primitives-date.js";

function render(properties: Partial<Parameters<typeof DateInput>[0]> = {}) {
  return renderToStaticMarkup(createElement(DateInput, { label: "End", value: "6/3/", textEntry: true,
    onChange: () => { throw new Error("render must not rewrite the draft"); }, ...properties }));
}

describe("DateInput date validation", () => {
  for (const bound of ["min", "max"] as const) for (const value of ["", "not-a-date", "2026-02-30"]) {
    it(`refuses invalid supplied ${bound} ${JSON.stringify(value)} rather than removing its constraint`, () => {
      assert.throws(() => render({ [bound]: value }), error => error instanceof Error
        && error.name === "InvalidDateInputBoundError" && error.message.includes(bound));
    });
  }
  it("retains a partial editable draft as invalid without substituting a date", () => {
    const html = render({ min: "2026-01-01", max: "2026-12-31" });
    assert.match(html, /value="6\/3\/"/u);
    assert.match(html, /data-invalid|aria-invalid="true"/u);
    assert.doesNotMatch(html, /value="2026-01-01"|value="2026-12-31"/u);
  });
  it("accepts omitted bounds and a valid leap-day draft", () => {
    assert.match(render({ value: "2/29/2028" }), /value="2\/29\/2028"/u);
  });
});
