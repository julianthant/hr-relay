import { sessionsSampleHarness } from "../../../support/fixtures/dashboard/sessions-sample.js";
import { servedFixtureSources } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { FIXTURE_START_PICKER_BOOTSTRAP as SERVED_CATALOG_BOOTSTRAP } from "../../../support/helpers/dashboard/mock-world/fixture-start.js";
import { launchWorkflows as launchServedWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows as parseServedWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog as buildServedCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
const SERVED_FIXTURE = launchServedWorkflows(parseServedWorkflows(SERVED_CATALOG_BOOTSTRAP.workflows));
const SERVED_CATALOG = buildServedCatalog(SERVED_FIXTURE, servedFixtureSources(SERVED_FIXTURE));
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SessionPanel } from "../../../support/helpers/dashboard/sessions-host.js";
const catalog = SERVED_CATALOG;

describe("frontend timeline and sessions", () => {
  it("renders the canonical Sessions host inside the shell toast provider without a dashboard client provider", () => {
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(SessionPanel, { catalog, harness: sessionsSampleHarness, open: true, onOpenChange: () => {} }))));
    assert.equal((markup.match(/<article /gu) ?? []).length, 4);
    assert.doesNotMatch(markup, /aria-label="Idle workers"/);
    assert.doesNotMatch(markup, /Sample data|Add to preview/);
    assert.match(markup, /lucide-monitor/);
    assert.match(markup, /Alex Morgan/);
    assert.doesNotMatch(markup, /role="progressbar"|Ready for the next run|No run in progress/);
    assert.match(markup, /aria-label="Remove worker"/);
    assert.doesNotMatch(markup, /Worker stopped|Worker paused|>Pause<|>Stop<|>Retry<|>Resume</);
    assert.match(markup, /Kronos/);
    assert.match(markup, /aria-label="Add workers"/);
    assert.doesNotMatch(markup, /pool version|expectedVersion|lease|Live<|No worker is running|>Worker \d+</);
  });
});
