import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { NavRow } from "../../../../src/dashboard/ds/primitives/nav-row.js";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("NavRow", () => {
  it("renders NavRow as a 32px button or a link and marks the selected row", () => {
    const button = html(createElement(NavRow, { label: "General", icon: createElement("i"), trailing: "2", selected: true }));
    assert.match(button, /^<button[^>]*aria-current="page"/u);
    assert.match(button, /h-8/u);
    assert.match(button, />General</u);
    assert.match(button, />2</u);
    const link = html(createElement(NavRow, { label: "Account", href: "?settings=account" }));
    assert.match(link, /^<a[^>]*href="\?settings=account"/u);
    assert.doesNotMatch(link, /aria-current/u);
  });
});

