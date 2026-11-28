import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
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

  it("has one look: no variant prop and no look class", () => {
    assert.doesNotMatch(html(createElement(SearchInput, { "aria-label": "Find" })), /ds-search-field--/u);
    type Props = ComponentProps<typeof SearchInput>;
    const variantFree: "variant" extends keyof Props ? never : true = true;
    assert.equal(variantFree, true);
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
    const offenders = files("src/dashboard").filter(file => /\.(tsx|css)$/u.test(file) && /<SearchInput[^>]*\bvariant=|ds-search-field--/u.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders, []);
  });
});
