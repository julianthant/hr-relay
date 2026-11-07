import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { visualLogSteps as visualLogSteps_m0 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { separationLogs as separationLogs_m0 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-fixture.js";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { act as act_m1 } from "react";
import { type Root as Root_m1 } from "react-dom/client";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { logDecisionExamples as logDecisionExamples_m1 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-fixture.js";
import { filterLogSteps as filterLogSteps_m1,logPlainText as logPlainText_m1,logRowCount as logRowCount_m1,type LogEntry as LogEntry_m1,type LogStep as LogStep_m1 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";


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
    assert_m1.equal(logDecisionExamples_m1.length, 34);
    assert_m1.equal(new Set(logDecisionExamples_m1.map(item => item.id)).size, 34);
    const steps: readonly LogStep_m1[] = [{ id: "file", time: "09:32:17", title: "File termination", entries: [example("failure-prepared")] }];
    assert_m1.equal(logRowCount_m1(steps), 1);
    assert_m1.equal(filterLogSteps_m1(steps, "employment record confirmed").length, 1);
    assert_m1.match(logPlainText_m1(steps), /last day worked.*Employee and employment record confirmed.*09\/25\/2026/u);
    assert_m1.equal(filterLogSteps_m1(steps, "missing value").length, 0);
  });
});
}
