import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
const catalog = buildWorkflowCatalog([], true, previewFixtureSources([]));

describe("frontend timeline and sessions", () => {
  it("renders the canonical Sessions host without any dashboard client provider", () => {
    const markup = renderToStaticMarkup(createElement(SessionPanel, { catalog, source: "mock", open: true, onOpenChange: () => {} }));
    assert.equal((markup.match(/<article /gu) ?? []).length, 4);
    assert.doesNotMatch(markup, /Sample data|Add to preview/);
    assert.match(markup, /Ready for the next run/);
    assert.match(markup, /aria-label="No run in progress"/);
    assert.match(markup, /aria-label="Remove worker"/);
    assert.doesNotMatch(markup, /Worker stopped|Worker paused|>Pause<|>Stop<|>Retry<|>Resume</);
    assert.match(markup, /Read the timecard/);
    assert.doesNotMatch(markup, /pool version|expectedVersion|lease|Live<|No worker is running|>Worker \d+</);
  });
});
