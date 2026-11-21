import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { DS_STATUS, StatusPill } from "../../../../src/dashboard/ds/primitives/primitives-status.js";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("StatusPill", () => {
  it("tints the cancelled pill neutral instead of filling it", () => {
    assert.equal(DS_STATUS.cancelled.tier, "tinted");
    const out = html(createElement(StatusPill, { status: "cancelled" }));
    assert.match(out, /--ds-status-cancelled-bg/u);
    assert.doesNotMatch(out, /cancelled-solid/u);
  });
});

