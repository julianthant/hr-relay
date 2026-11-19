import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Input, SearchInput, SecretField } from "../../../../src/dashboard/ds/primitives/primitives-form.js";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Input, SecretField and SearchInput", () => {
  it("sizes Input at 28px or 32px", () => {
    assert.match(html(createElement(Input, { "aria-label": "Name" })), /h-\[var\(--ds-h-md\)\]/u);
    assert.match(html(createElement(Input, { "aria-label": "Name", size: "lg" })), /h-\[var\(--ds-h-lg\)\]/u);
  });

  it("reveals a secret with the eye icon button and keeps the 32px size", () => {
    const out = html(createElement(SecretField, { label: "Password", size: "lg" }));
    assert.match(out, /<button[^>]*aria-label="Show Password"/u);
    assert.match(out, /type="password"/u);
    assert.match(out, /h-\[var\(--ds-h-lg\)\]/u);
    assert.doesNotMatch(out, />Show</u);
  });

  it("marks only the sidebar search as the filled pill", () => {
    assert.match(html(createElement(SearchInput, { variant: "sidebar", "aria-label": "Find" })), /ds-search-field--sidebar/u);
    assert.doesNotMatch(html(createElement(SearchInput, { "aria-label": "Find" })), /ds-search-field--sidebar/u);
  });
});
