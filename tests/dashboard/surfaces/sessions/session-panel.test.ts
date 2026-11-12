import { servedFixtureSources as previewFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
const catalog = buildWorkflowCatalog([], true, previewFixtureSources([]));

describe("frontend timeline and sessions", () => {
  it("renders the canonical Sessions host inside the shell toast provider without a dashboard client provider", () => {
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(SessionPanel, { catalog, source: "mock", open: true, onOpenChange: () => {} }))));
    assert.equal((markup.match(/<article /gu) ?? []).length, 4);
    assert.doesNotMatch(markup, /Sample data|Add to preview/);
    assert.match(markup, /No run assigned/);
    assert.match(markup, /Alex Morgan/);
    assert.doesNotMatch(markup, /role="progressbar"|Ready for the next run|No run in progress/);
    assert.match(markup, /aria-label="Remove worker"/);
    assert.doesNotMatch(markup, /Worker stopped|Worker paused|>Pause<|>Stop<|>Retry<|>Resume</);
    assert.match(markup, /Kronos/);
    assert.match(markup, /aria-label="Assistant"/);
    assert.doesNotMatch(markup, /pool version|expectedVersion|lease|Live<|No worker is running|>Worker \d+</);
  });
});
