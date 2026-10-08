// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExplorerTimeline } from "../../../src/dashboard/surfaces/explorer/explorer-flow.js";
import { buildExplorerPreview, previewFieldSource } from "../../../src/dashboard/surfaces/explorer/explorer-fixture.js";
import { DEFAULT_SCENARIO, allFields, commentTemplate, blockedAfter } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { parseRoute, routeToSearch, routeWithoutTakeovers } from "../../../src/dashboard/app/navigation/url-state.js";
import { cn } from "../../../src/dashboard/lib/utils.js";

describe("approved Explorer presentation", () => {
  it("keeps shared semantic font roles mutually exclusive", () => {
    assert.equal(cn("text-page text-ui-info", "text-workflow"), "text-ui-info text-workflow");
    assert.equal(cn("text-workflow", "text-caption"), "text-caption");
  });
  it("keeps the complete 22-step sequence and distinct declared field addresses", () => {
    const steps = buildExplorerPreview(DEFAULT_SCENARIO);
    assert.equal(steps.length, 22);
    assert.deepEqual(steps.map((step) => step.number), Array.from({ length: 22 }, (_, i) => i + 1));
    const fields = steps.flatMap((step) => allFields(step.parts).map((field) => `${step.number}:${field.id}`));
    assert.equal(new Set(fields).size, fields.length);
    assert.equal(steps[21].title, "Finalize the Kuali document");
  });
  it("stops downstream writes on rejection or inconclusive reads and rejoins the existing receipt path", () => {
    assert.equal(blockedAfter({ ...DEFAULT_SCENARIO, identity: "rejected" }), 15);
    assert.equal(blockedAfter({ ...DEFAULT_SCENARIO, pending: "unknown" }), 18);
    assert.equal(blockedAfter({ ...DEFAULT_SCENARIO, termination: "unknown" }), 19);
    assert.equal(blockedAfter(DEFAULT_SCENARIO), undefined);
    const existing = buildExplorerPreview({ ...DEFAULT_SCENARIO, termination: "present" });
    assert.equal(allFields(existing[18].parts).length, 0);
    assert.match(JSON.stringify(existing[18].parts), /Reuse this receipt/);
    assert.match(JSON.stringify(existing[19].parts), /existing receipt/);
    const pending = buildExplorerPreview({ ...DEFAULT_SCENARIO, pending: "some" });
    assert.match(JSON.stringify(pending[17].parts), /Click Delete/);
    assert.match(JSON.stringify(pending[17].parts), /exact pending set/);
  });
  it("resolves each fill source to a declared field or step, including multiple original inputs", () => {
    const steps = buildExplorerPreview(DEFAULT_SCENARIO);
    for (const step of steps) for (const field of allFields(step.parts).filter((item) => item.mode === "fill")) {
      const origin = previewFieldSource(field.source!, step.number, DEFAULT_SCENARIO);
      assert.ok(origin, `${step.number}:${field.id} requires a source`);
      for (const source of origin.reads ?? []) {
        const target = steps.find((item) => item.number === source.step);
        assert.ok(target);
        if (source.fieldId) assert.ok(allFields(target.parts).some((item) => item.id === source.fieldId), `${source.step}:${source.fieldId}`);
      }
    }
    assert.equal(previewFieldSource("dates", 19, DEFAULT_SCENARIO)?.reads?.length, 3);
    assert.equal(previewFieldSource("department", 22, DEFAULT_SCENARIO)?.reads?.length, 2);
    assert.equal(previewFieldSource("missing", 22, DEFAULT_SCENARIO), undefined);
  });
  it("shows exact comment wording for leave ties, omitted Kronos, changed dates and preserved text", () => {
    const base = { leave: "none", changes: "none", authority: "kronos", existing: "no" } as const;
    assert.equal(commentTemplate("ucpath", base), "Termination eff {terminationEffectiveDate}. Last Day Worked {lastDayWorked}. Kuali form #{documentNumber}.");
    assert.match(commentTemplate("ucpath", { ...base, leave: "tie" }), /Sick Leave on \{latestSickDate\}/);
    assert.doesNotMatch(commentTemplate("ucpath", { ...base, leave: "operator" }), /Sick Leave|Holiday Pay/);
    assert.match(commentTemplate("ucpath", { ...base, leave: "range" }), /Holiday Pay from \{firstHolidayDate\} to \{latestHolidayDate\}/);
    const kuali = commentTemplate("kuali", { ...base, changes: "both", authority: "operator", existing: "yes" });
    assert.equal(kuali.split("\n").length, 4);
    assert.ok(kuali.startsWith("{existingComments}\n"));
    assert.equal(kuali.match(/per operator entry at run start/g)?.length, 2);
    assert.ok(kuali.endsWith("-{initials} {asOfDate}"));
  });
  it("uses the canonical Explorer route and ignores the retired preview switch", () => {
    const route = parseRoute("?explore=fixture");
    assert.deepEqual(parseRoute(routeToSearch(route)), route);
    assert.equal(routeWithoutTakeovers(route).explore, undefined);
    assert.deepEqual(parseRoute("?explore=fixture&explorerPreview=1"), route);
    assert.deepEqual(parseRoute("?explore=fixture&explorerPreview=invalid"), route);
    assert.equal(parseRoute("?explorerPreview=1").explore, undefined);
    assert.doesNotMatch(routeToSearch(route), /explorerPreview/);
  });
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let mounted: Root | undefined;
afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Explorer source focus return", () => {
  it("reopens a closed final form and returns to its Department source button", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    Reflect.set(HTMLElement.prototype, "scrollIntoView", vi.fn());
    const flushFrames = async () => {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
      });
    };
    const host = document.createElement("div");
    document.body.append(host);
    mounted = createRoot(host);
    await act(async () => mounted?.render(createElement(ExplorerTimeline, {
      title: "Separations", steps: buildExplorerPreview(DEFAULT_SCENARIO), scenario: DEFAULT_SCENARIO,
      onScenario: () => undefined, sourceFor: (field, step) => previewFieldSource(field.source ?? "", step, DEFAULT_SCENARIO),
      workflows: [{ id: "fixture-separations", title: "Separations", count: 22 }], workflowId: "fixture-separations", onWorkflow: () => undefined,
      summary: "Sample", completion: "Complete", path: { step: 17, control: "preview-pending" }, onMockChoice: () => undefined,
    })));
    const origin = host.querySelector<HTMLButtonElement>('[aria-label="Show source for Department"]');
    const finalForm = host.querySelector<HTMLDetailsElement>('details[data-disclosure="22-finalize"]');
    assert.ok(origin);
    assert.ok(finalForm);
    await act(async () => { origin.focus(); origin.click(); });
    const jumps = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].filter(button => button.textContent?.includes("Go to original field"));
    assert.equal(jumps.length, 2);
    await act(async () => jumps[1].click());
    await flushFrames();
    assert.equal(document.activeElement?.id, "explorer-field-3-options");
    await act(async () => { finalForm.open = false; finalForm.dispatchEvent(new Event("toggle")); });
    assert.equal(finalForm.open, false);
    const returnButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Return to filled field");
    assert.ok(returnButton);
    await act(async () => { returnButton.focus(); returnButton.click(); });
    await flushFrames();
    assert.equal(finalForm.open, true);
    assert.equal(document.activeElement, origin);
    await act(async () => { origin.click(); });
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close field source"]');
    assert.ok(close);
    await act(async () => close.click());
    await flushFrames();
    assert.equal(document.activeElement, origin);
  });
});
