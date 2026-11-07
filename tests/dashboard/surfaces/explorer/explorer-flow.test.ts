// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { buildExplorerPreview,previewFieldSource } from "../../../../src/dashboard/surfaces/explorer/explorer-fixture.js";
import { DEFAULT_SCENARIO } from "../../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { ExplorerTimeline } from "../../../../src/dashboard/surfaces/explorer/explorer-flow.js";

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
