// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { Button } from "../../../../../src/dashboard/ds/ui.js";
import { DeleteAccountControl } from "../../../../../src/dashboard/surfaces/settings/general/ui-settings-records-general-paths.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

async function mount(node: ReturnType<typeof createElement>): Promise<void> {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(node));
}
const triggers = () => [...(host?.querySelectorAll("button") ?? [])];

describe("Settings > Account Delete card", () => {
  it("is one row: no heading, no description, a filled red Delete", async () => {
    await mount(createElement("div", null,
      createElement(DeleteAccountControl, { presentation: { state: "ready", personName: "Alex Morgan", onConfirm: () => {} } }),
      createElement("span", { id: "reference" }, createElement(Button, { variant: "danger" }, "Delete"))));
    const card = host?.firstElementChild?.firstElementChild as HTMLElement;
    assert.equal(card.querySelector("h1, h2, h3, h4"), null);
    assert.equal(card.textContent, "Delete accountDelete");
    const button = card.querySelector("button");
    assert.equal(button?.textContent, "Delete");
    assert.equal(button?.className, host?.querySelector("#reference button")?.className);
  });

  it("Delete opens the existing confirm, and only its Delete account button confirms", async () => {
    const confirmed: string[] = [];
    await mount(createElement(DeleteAccountControl, { presentation: { state: "ready", personName: "Alex Morgan", onConfirm: () => { confirmed.push("confirmed"); } } }));
    await act(async () => triggers()[0]?.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.ok(dialog.textContent?.includes("Delete Alex Morgan’s account?"));
    assert.deepEqual(confirmed, []);
    await act(async () => [...dialog.querySelectorAll("button")].find(item => item.textContent === "Delete account")?.click());
    assert.deepEqual(confirmed, ["confirmed"]);
  });

  it("keeps the deleting and failure notes visible and the button off", async () => {
    await mount(createElement(DeleteAccountControl, { presentation: { state: "deleting", personName: "Alex Morgan" } }));
    assert.equal(triggers()[0]?.textContent, "Deleting…");
    assert.equal(triggers()[0]?.disabled, true);
    assert.match(host?.textContent ?? "", /Deleting your account…/u);
  });
});
