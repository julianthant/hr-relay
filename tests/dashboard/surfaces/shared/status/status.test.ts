// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { StatusBadge } from "../../../../../src/dashboard/surfaces/shared/status/status.js";

describe("approved mixed queue presentation", () => {
  it("scopes the revised attention treatments to queue pills", () => {
    for (const status of ["waiting", "failed"] as const) {
      const current = renderToStaticMarkup(createElement(StatusBadge, { status }));
      const queue = renderToStaticMarkup(createElement(StatusBadge, { status, presentation: "queue" }));
      assert.notEqual(current, queue);
      assert.match(queue, /svg/u);
      assert.match(queue, status === "waiting" ? /ds-queue-info-bg/u : /ds-queue-danger-bg/u);
    }
  });
});
