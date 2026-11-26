import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { visualLogSteps as visualLogSteps_m0 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { separationLogs as separationLogs_m0 } from "../../../../support/fixtures/dashboard/log-preview/log-fixture";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { act as act_m1 } from "react";
import { type Root as Root_m1 } from "react-dom/client";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { logDecisionExamples as logDecisionExamples_m1 } from "../../../../support/fixtures/dashboard/log-preview/log-decision-fixture";
import { matchRanges as matchRanges_m1,logPlainText as logPlainText_m1,type LogEntry as LogEntry_m1,type LogStep as LogStep_m1 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";


{

describe_m0("frontend presentation producers", () => {
  it_m0("shows visible confirmed actions while excluding computation-only steps", () => {
    const steps = visualLogSteps_m0(separationLogs_m0);
    assert_m0.ok(!steps.some(step => step.title === "Build separation plan" || step.title === "Reconcile dates"));
    assert_m0.ok(steps.some(step => step.entries.some(entry => entry.kind === "click" && entry.label === "Save and Submit")));
    assert_m0.equal(steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "decision" ? entry.decision.screenshots ?? [] : entry.kind === "note" ? [] : entry.screenshots ?? []).length, 16);
  });
});
}

{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root_m1 | undefined;
const _afterEachFixture0 = async () => { await act_m1(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); };
function example(id: string): Extract<LogEntry_m1, { kind: "decision" }> { const entry = logDecisionExamples_m1.find(item => item.id === id)?.entry; assert_m1.ok(entry && entry.kind === "decision"); return entry; }

describe_m1("approved log decisions", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("keeps every approved example and search/copy/count visibility", () => {
    assert_m1.equal(logDecisionExamples_m1.length, 35);
    assert_m1.equal(new Set(logDecisionExamples_m1.map(item => item.id)).size, 35);
    const steps: readonly LogStep_m1[] = [{ id: "file", time: "09:32:17", title: "File termination", entries: [example("failure-prepared")] }];
    assert_m1.match(logPlainText_m1(steps), /last day worked.*Employee and employment record confirmed.*09\/25\/2026/u);
    const drawn = document.createElement("div");
    drawn.innerHTML = '<h3>Read employment</h3><span class="sr-only">employment</span><p hidden>employment</p><textarea>employment</textarea><details><summary>More</summary><p>employment</p></details><dl><dt>date</dt><dd>2026</dd></dl><p>Employment found; employment ok</p>';
    assert_m1.deepEqual(matchRanges_m1(drawn, " EMPLOYMENT ").map(range => [range.startContainer.parentElement?.localName, range.startOffset]), [["h3", 5], ["p", 0], ["p", 18]]);
    assert_m1.equal(matchRanges_m1(drawn, "date 2026").length, 0, "two drawn nodes are not one match");
    assert_m1.equal(matchRanges_m1(drawn, "  ").length, 0);
  });
});
}
