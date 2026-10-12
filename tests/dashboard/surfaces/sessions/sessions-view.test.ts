// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { SessionPreviewOperation } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { SessionsView } from "../../../../src/dashboard/surfaces/sessions/sessions-view.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function settle(action: () => void): Promise<void> {
  await act(async () => action());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function mount(synchronous = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  let operation: SessionPreviewOperation | undefined;
  let calls = 0;
  const render = () => root?.render(createElement(SessionsView, {
    data: { state: "ready", workers: [] }, open: true, onOpenChange: () => undefined,
    workflows: [{ id: "person-lookup", label: "Person Lookup" }], onControl: () => undefined,
    operations: operation ? { add: operation } : {},
    onAdd: (workflow, count) => {
      calls++;
      operation = { request: { id: "add-1", target: "add", action: "add", workflow, count, ordinal: 5 },
        state: synchronous ? "confirmed" : "pending", message: "Adding workers" };
      render();
    },
  }));
  await settle(render);
  const trigger = host.querySelector('button[aria-label="Add workers"]');
  assert.ok(trigger instanceof HTMLButtonElement);
  const open = async () => { await settle(() => { trigger.focus(); trigger.click(); }); };
  const dialog = () => {
    const element = document.querySelector('[role="dialog"]');
    assert.ok(element instanceof HTMLElement);
    return element;
  };
  const confirm = async () => {
    const button = [...dialog().querySelectorAll("button")].find(node => node.textContent === "Add workers");
    assert.ok(button instanceof HTMLButtonElement);
    await settle(() => { button.focus(); button.click(); });
    assert.equal(document.querySelector('[role="dialog"]'), null, "confirmation closes immediately");
    assert.equal(calls, 1);
  };
  const transition = async (state: SessionPreviewOperation["state"]) => {
    assert.ok(operation);
    operation = { ...operation, state };
    await settle(render);
  };
  return { trigger, open, dialog, confirm, transition, calls: () => calls };
}

describe("Sessions confirmation focus", () => {
  for (const state of ["confirmed", "refused"] as const) {
    it(`returns to the enabled trigger after a pending add becomes ${state}`, async () => {
      const harness = await mount();
      await harness.open(); await harness.confirm();
      assert.equal(harness.trigger.disabled, true);
      assert.ok(document.activeElement !== harness.trigger, "disabled trigger cannot receive return focus");
      await harness.transition(state);
      assert.equal(harness.trigger.disabled, false);
      assert.ok(document.activeElement === harness.trigger, "focus returns to the Add workers trigger");
      assert.equal(document.querySelectorAll("article").length, 0, "the focus handler does not create worker data");
    });
  }

  it("returns focus for synchronous confirmation", async () => {
    const harness = await mount(true);
    await harness.open(); await harness.confirm();
    assert.equal(harness.trigger.disabled, false);
    assert.ok(document.activeElement === harness.trigger, "focus returns to the Add workers trigger");
  });

  it("keeps uncertain and checking commands locked until a checked outcome unlocks", async () => {
    const harness = await mount();
    await harness.open(); await harness.confirm();
    for (const state of ["uncertain", "checking"] as const) {
      await harness.transition(state);
      assert.equal(harness.trigger.disabled, true);
      assert.ok(document.activeElement !== harness.trigger, "disabled trigger cannot receive return focus");
      assert.equal(harness.calls(), 1, "focus never resubmits an uncertain command");
    }
    await harness.transition("confirmed");
    assert.ok(document.activeElement === harness.trigger, "focus returns to the Add workers trigger");
  });

  it("preserves another connected control focused while the add is pending", async () => {
    const harness = await mount();
    await harness.open(); await harness.confirm();
    const other = document.createElement("button");
    other.textContent = "Other action"; document.body.append(other);
    await settle(() => other.focus());
    await harness.transition("confirmed");
    assert.ok(document.activeElement === other, "intervening user focus is retained");
    await settle(() => other.blur());
    await harness.transition("refused");
    assert.ok(document.activeElement !== harness.trigger, "cancelled focus intent stays consumed");
  });

  for (const exit of ["Cancel", "Escape"] as const) {
    it(`preserves default ${exit} focus return without adding workers`, async () => {
      const harness = await mount(); await harness.open();
      if (exit === "Cancel") {
        const cancel = [...harness.dialog().querySelectorAll("button")].find(node => node.textContent === "Cancel");
        assert.ok(cancel);
        await settle(() => cancel.click());
      } else await settle(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.ok(document.activeElement === harness.trigger, "focus returns to the Add workers trigger");
      assert.equal(harness.calls(), 0);
    });
  }
});
