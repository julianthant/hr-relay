import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { IconButton } from "../../../src/dashboard/ds/ui.js";

describe("IconButton semantics", () => {
  it("forwards the caller's class to the native button", () => {
    const html = renderToStaticMarkup(createElement(IconButton, {
      size: "sm",
      className: "caller-owned-class",
      label: "Mark Jordan Reyes checked by you",
      icon: null,
    }));

    assert.match(html, /<button/u);
    assert.match(html, /caller-owned-class/u);
  });

  it("uses the required label as the native button's accessible name", () => {
    const html = renderToStaticMarkup(createElement(IconButton, {
      size: "sm",
      label: "Mark Jordan Reyes checked by you",
      icon: null,
    }));

    assert.match(html, /aria-label="Mark Jordan Reyes checked by you"/u);
  });
});
