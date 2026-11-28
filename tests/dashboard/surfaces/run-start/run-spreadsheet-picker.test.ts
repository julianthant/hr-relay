// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SpreadsheetRow } from "../../../../src/dashboard/surfaces/run-start/run-spreadsheet-picker.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

it("offers the versions by name, current first choice, and reports the chosen version", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const onVersion = vi.fn();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(SpreadsheetRow, {
    name: "Roster", versionId: "b", versions: [{ id: "a", name: "Before audit", savedAt: "2026-11-01T00:00:00Z" }, { id: "b", name: "Current", savedAt: "2026-11-05T00:00:00Z" }],
    worksheets: [], picked: [], mode: "one", busy: false, worksheetsReady: true, onVersion, onWorksheets: () => undefined, onRemove: () => undefined }))));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Roster version"]'); assert.ok(trigger);
  await act(async () => { trigger.click(); });
  const options = [...document.body.querySelectorAll('[role="option"]')];
  assert.deepEqual(options.map(option => option.textContent?.split(" · ")[0]), ["Before audit", "Current"]);
  await act(async () => { (options[0] as HTMLElement).click(); });
  assert.deepEqual(onVersion.mock.calls, [["a"]]);
});

it("shows the stored version names and keeps a long name inside the trigger", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const same = { name: "Reviewed", savedAt: "2026-11-05T01:00:00Z" };
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(SpreadsheetRow, {
    name: "Roster", versionId: "c", versions: [{ id: "a", ...same }, { id: "b", ...same, name: "Reviewed (2)" }, { id: "c", name: "A very long version name that must not push the controls", savedAt: "2026-11-06T00:00:00Z" }],
    worksheets: [], picked: [], mode: "one", busy: false, worksheetsReady: true, onVersion: () => undefined, onWorksheets: () => undefined, onRemove: () => undefined }))));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Roster version"]'); assert.ok(trigger);
  assert.match(trigger.className, /max-w-52/u);
  await act(async () => { trigger.click(); });
  const labels = [...document.body.querySelectorAll('[role="option"]')].map(option => option.textContent ?? "");
  assert.deepEqual(labels.map(label => label.split(" · ")[0]), ["Reviewed", "Reviewed (2)", "A very long version name that must not push the controls"]);
});
