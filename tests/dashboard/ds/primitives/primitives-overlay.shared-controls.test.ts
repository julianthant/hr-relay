// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, it } from "vitest";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "../../../../src/dashboard/ds/primitives/primitives-overlay.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

describe("Dialog and ConfirmDialog", () => {
  async function mount(node: ReturnType<typeof createElement>) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    return async () => { await act(async () => root.unmount()); host.remove(); };
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it("sizes sm 400, md 560, lg 880 and always shows a close X", async () => {
    for (const [size, width] of [["sm", 400], ["md", 560], ["lg", 880]] as const) {
      const unmount = await mount(createElement(Dialog, { open: true },
        createElement(DialogContent, { size, title: "Title", children: createElement(DialogFooter, null, "x") })));
      const surface = dialog();
      assert.ok(surface, size);
      assert.ok(surface.className.includes(`max-w-[${width}px]`), `${size}: ${surface.className}`);
      assert.ok(surface.querySelector('button[aria-label="Close"]'), `${size} has no close X`);
      assert.match(surface.querySelector("h2")?.className ?? "", /font-semibold/u);
      assert.match(surface.querySelector("h2")?.className ?? "", /--ds-dialog-title-size/u);
      assert.match(surface.className, /rounded-\[var\(--ds-radius-dialog\)\]/u);
      assert.doesNotMatch(surface.className, /(^|\s)border(\s|$)/u, `${size} has a border`);
      await unmount();
    }
  });

  it("gives lg the Start run header and footer measures", async () => {
    const unmount = await mount(createElement(Dialog, { open: true },
      createElement(DialogContent, { size: "lg", title: "Start run", children: createElement(DialogFooter, null, "x") })));
    const surface = dialog();
    assert.ok(surface);
    assert.equal(surface.getAttribute("data-band"), "true");
    assert.match(surface.querySelector("header")?.className ?? "", /group-data-\[size=lg\]\/dialog:h-\[73px\]/u);
    assert.match(surface.querySelector("footer")?.className ?? "", /group-data-\[size=lg\]\/dialog:h-\[57px\]/u);
    await unmount();
  });

  it("asks a plain question, focuses Cancel first and names the red button for the action", async () => {
    let confirmed = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      return createElement(ConfirmDialog, {
        open, onOpenChange: setOpen, destructive: true, title: "Delete this run?",
        description: "Its log is removed.", confirmLabel: "Delete run", onConfirm: () => { confirmed += 1; },
      });
    }
    const unmount = await mount(createElement(Harness));
    const surface = dialog();
    assert.ok(surface);
    assert.match(surface.className, /max-w-\[400px\]/u);
    assert.equal(surface.querySelector("h2")?.textContent, "Delete this run?");
    assert.equal(surface.querySelector("p")?.textContent, "Its log is removed.");
    assert.ok(surface.querySelector('button[aria-label="Close"]'));
    const buttons = [...surface.querySelectorAll<HTMLButtonElement>("footer button")];
    assert.deepEqual(buttons.map(button => button.textContent), ["Cancel", "Delete run"]);
    assert.equal(document.activeElement, buttons[0]);
    assert.match(buttons[1].className, /--ds-danger/u);
    assert.doesNotMatch(buttons[0].className, /--ds-danger/u);
    await act(async () => buttons[1].click());
    assert.equal(confirmed, 1);
    await unmount();
  });
});
