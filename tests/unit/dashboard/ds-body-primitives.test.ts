import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { DsBodyScope, FormGroup, PageHeading, ResultRow } from "../../../src/dashboard/ds/primitives-layout.js";
import { Field, SearchInput, SecretField, UnitField } from "../../../src/dashboard/ds/primitives-form.js";
import { RankedList } from "../../../src/dashboard/ds/primitives-data.js";

describe("shared body and field primitives", () => {
  it("scopes the content heading and grouped rows without changing their public labels", () => {
    const html = renderToStaticMarkup(
      createElement(DsBodyScope, null,
        createElement(PageHeading, { title: "Connections", description: "Provider settings" }),
        createElement(FormGroup, { label: "Connection settings" },
          createElement(Field, { label: "Employee ID", description: "9 digits", orientation: "horizontal" },
            createElement(SearchInput, { placeholder: "Search employees" }),
          ),
        ),
      ),
    );
    assert.match(html, /class="ds-body-scope"/u);
    assert.match(html, /class="[^"]*ds-text-page-title/u);
    assert.match(html, /role="group" aria-label="Connection settings"/u);
    assert.match(html, /class="[^"]*ds-body-row ds-field-layout-horizontal/u);
    assert.match(html, /placeholder="Search employees"/u);
    assert.match(html, /aria-describedby="[^"]+-description"/u);
  });

  it("keeps existing Field typography outside the body scope", () => {
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(Field, { label: "Unscoped field" }, createElement("input", { "aria-label": "Unscoped value" })),
        createElement(DsBodyScope, null,
          createElement(Field, { label: "Body field" }, createElement("input", { "aria-label": "Body value" })),
        ),
      ),
    );
    const labels = [...html.matchAll(/<label\b[^>]*class="([^"]+)"[^>]*>/gu)];
    assert.equal(labels.length, 2);
    assert.match(labels[0]?.[1] ?? "", /ds-text-meta/u);
    assert.match(labels[1]?.[1] ?? "", /ds-text-meta/u);

    const css = readFileSync(new URL("../../../src/dashboard/ds/tokens.css", import.meta.url), "utf8");
    assert.match(css, /\.ds-body-scope\s+\.ds-field-label\s*\{/u);
    assert.doesNotMatch(css, /(?:^|\n)\s*\.ds-field-label\s*\{/u);
  });

  it("keeps a secret masked by default with a separate named reveal and remove action", () => {
    const html = renderToStaticMarkup(
      createElement(DsBodyScope, null,
        createElement(Field, { label: "Provider key", description: "Primary connection", orientation: "horizontal" },
          createElement(SecretField, {
            label: "Provider key",
            value: "sk_specimen_123",
            onChange: () => undefined,
            onRemove: () => undefined,
          }),
        ),
      ),
    );
    assert.match(html, /type="password"/u);
    assert.doesNotMatch(html, /type="text"[^>]*value="sk_specimen_123"/u);
    assert.match(html, /aria-label="Show Provider key"/u);
    assert.match(html, /aria-pressed="false"/u);
    assert.match(html, /aria-label="Remove Provider key"/u);
    assert.match(html, /<label[^>]*for="[^"]+"[^>]*>Provider key/u);
  });

  it("disables both secret actions when the value is unavailable", () => {
    const html = renderToStaticMarkup(createElement(Field, {
      label: "Provider key",
      disabled: true,
      children: createElement(SecretField, {
        label: "Provider key",
        value: "sk_specimen_123",
        onChange: () => undefined,
        onRemove: () => undefined,
        disabled: false,
      }),
    }));
    assert.match(html, /<input[^>]*disabled=""/u);
    const buttons = [...html.matchAll(/<button\b[^>]*>/gu)].map(([opening]) => opening ?? "");
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every((opening) => /disabled=""/u.test(opening)));
  });

  it("keeps read-only secrets revealable but prevents removing them", () => {
    const html = renderToStaticMarkup(createElement(SecretField, {
      label: "Archived key",
      value: "sk_specimen_archived",
      readOnly: true,
      onRemove: () => undefined,
    }));
    const buttons = [...html.matchAll(/<button\b[^>]*>/gu)].map(([opening]) => opening ?? "");
    assert.equal(buttons.length, 2);
    assert.ok(!/disabled=""/u.test(buttons[0] ?? ""), "the reveal action remains available");
    assert.match(buttons[1] ?? "", /disabled=""/u);
    assert.match(html, /readOnly=""/u);
  });

  it("announces the unit with the field description and presents result evidence", () => {
    const html = renderToStaticMarkup(
      createElement(DsBodyScope, null,
        createElement(FormGroup, { label: "Runtime settings" },
          createElement(Field, { label: "Read timeout", description: "Response limit", orientation: "horizontal" },
            createElement(UnitField, { type: "number", value: "45", onChange: () => undefined, unit: "seconds" }),
          ),
          createElement(ResultRow, {
            label: "Credential check",
            description: "Provider responds",
            value: "Ready",
            evidence: "Checked today",
          }),
        ),
      ),
    );
    assert.match(html, /aria-describedby="[^"]+-description [^"]+"/u);
    assert.match(html, />seconds<\/span>/u);
    assert.match(html, /Credential check/u);
    assert.match(html, /Checked today/u);
  });

  it("exposes stable rank positions, movement names and primary/fallback labels", () => {
    const html = renderToStaticMarkup(
      createElement(DsBodyScope, null,
        createElement(RankedList, {
          label: "Provider priority",
          items: [
            { id: "first", label: "UCPath", role: "Primary" },
            { id: "second", label: "Legacy HRMS", role: "Fallback" },
          ],
          onReorder: () => undefined,
        }),
      ),
    );
    assert.match(html, /<ol aria-label="Provider priority"/u);
    assert.match(html, /Move UCPath\. Position 1 of 2\. Use arrow keys to reorder\./u);
    assert.match(html, /ArrowUp ArrowDown/u);
    assert.match(html, /Primary/u);
    assert.match(html, /Fallback/u);
    assert.match(html, /role="status" aria-live="polite"/u);
  });
});
