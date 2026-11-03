// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { StatusBadge } from "../../../../../src/dashboard/surfaces/shared/status/status.js";
import { PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";

describe("approved mixed queue presentation", () => {
  it("uses recorded pause authority with the queued outline, a pause icon and truthful copy", () => {
    const markup = renderToStaticMarkup(createElement(StatusBadge, { status: "running", presentation: "queue",
      pauseControl: { state: "paused", expectedVersion: PositiveIntSchema.parse(7), command: "resume" } }));
    assert.match(markup, /Paused/u);
    assert.match(markup, /Pause recorded/u);
    assert.match(markup, /ds-status-queued-border/u);
    assert.match(markup, /svg/u);
    assert.doesNotMatch(markup, /Accepted, nothing has run|animate-spin|Running/u);
    const pending = renderToStaticMarkup(createElement(StatusBadge, { status: "running",
      pauseControl: { state: "pause-pending", expectedVersion: PositiveIntSchema.parse(7) } }));
    assert.match(pending, /Pausing/u);
    assert.match(pending, /submit is never interrupted/u);
    assert.doesNotMatch(pending, /Pause recorded/u);
  });
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
