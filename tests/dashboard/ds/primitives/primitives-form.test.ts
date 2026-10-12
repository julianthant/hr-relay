
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { createElement as createElement_m0,createElement as createElement_m1 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m0,renderToStaticMarkup as renderToStaticMarkup_m1 } from "react-dom/server";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { Checkbox as Checkbox_m0,Field as Field_m1,SecretField as SecretField_m1 } from "../../../../src/dashboard/ds/primitives/primitives-form.js";


{


/** The id `aria-labelledby` points at, and the text of the element carrying that id. */
function nameOf(html: string): { labelledBy: string; namedBy: string } {
  const labelledBy = /<button[^>]*\saria-labelledby="([^"]+)"/u.exec(html)?.[1];
  assert_m0.ok(labelledBy, `the checkbox button carries no aria-labelledby: ${html}`);
  const target = new RegExp(`<span[^>]*\\sid="${labelledBy}"[^>]*>([^<]*)</span>`, "u").exec(html)?.[1];
  assert_m0.ok(target !== undefined, `aria-labelledby="${labelledBy}" points at no span: ${html}`);
  return { labelledBy, namedBy: target };
}

describe_m0("ds/Checkbox — the control carries an accessible name", () => {
  it_m0("names the button from its own label span, not from the <label for>", () => {
    const html = renderToStaticMarkup_m0(
      createElement_m0(Checkbox_m0, { label: "Select all rows", description: "Only some are checked" }),
    );
    assert_m0.match(html, /role="checkbox"/u);
    assert_m0.equal(nameOf(html).namedBy, "Select all rows");
  });

  it_m0("names from the label alone — the description is not folded into the name", () => {
    const html = renderToStaticMarkup_m0(
      createElement_m0(Checkbox_m0, { label: "Auto-retry parked writes", description: "Never available" }),
    );
    const { labelledBy, namedBy } = nameOf(html);
    assert_m0.equal(namedBy, "Auto-retry parked writes");
    assert_m0.equal(labelledBy.split(/\s+/u).length, 1, `expected one id, got "${labelledBy}"`);
    assert_m0.doesNotMatch(html, new RegExp(`id="${labelledBy}"[^>]*>Never available`, "u"));
  });

  it_m0("keeps the visible label wired to the same control, so the click target still toggles", () => {
    const html = renderToStaticMarkup_m0(createElement_m0(Checkbox_m0, { label: "Capture a screenshot" }));
    const controlId = /<button[^>]*\sid="([^"]+)"/u.exec(html)?.[1];
    assert_m0.ok(controlId, `the checkbox button carries no id: ${html}`);
    assert_m0.match(html, new RegExp(`<label[^>]*\\sfor="${controlId}"`, "u"));
  });
});
}

{


describe_m1("shared body and field primitives", () => {

  it_m1("disables both secret actions when the value is unavailable", () => {
    const html = renderToStaticMarkup_m1(createElement_m1(Field_m1, {
      label: "Provider key",
      disabled: true,
      children: createElement_m1(SecretField_m1, {
        label: "Provider key",
        value: "sk_specimen_123",
        onChange: () => undefined,
        onRemove: () => undefined,
        disabled: false,
      }),
    }));
    assert_m1.match(html, /<input[^>]*disabled=""/u);
    const buttons = [...html.matchAll(/<button\b[^>]*>/gu)].map(([opening]) => opening ?? "");
    assert_m1.equal(buttons.length, 2);
    assert_m1.ok(buttons.every((opening) => /disabled=""/u.test(opening)));
  });

  it_m1("keeps read-only secrets revealable but prevents removing them", () => {
    const html = renderToStaticMarkup_m1(createElement_m1(SecretField_m1, {
      label: "Archived key",
      value: "sk_specimen_archived",
      readOnly: true,
      onRemove: () => undefined,
    }));
    const buttons = [...html.matchAll(/<button\b[^>]*>/gu)].map(([opening]) => opening ?? "");
    assert_m1.equal(buttons.length, 2);
    assert_m1.ok(!/disabled=""/u.test(buttons[0] ?? ""), "the reveal action remains available");
    assert_m1.match(buttons[1] ?? "", /disabled=""/u);
    assert_m1.match(html, /readOnly=""/u);
  });
});
}
