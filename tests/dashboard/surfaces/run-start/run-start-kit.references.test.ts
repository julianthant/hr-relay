// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunReferenceRows } from "../../../../src/dashboard/surfaces/run-start/run-start-kit.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const versions = ["earlier", "current"].map(id => ({ id, name: id, snapshotId: id, version: 1, savedAt: "2026-11-01T00:00:00Z", source: "operator" as const }));

async function openFound(sheet: { versions: typeof versions; worksheets: string[] }) {
  const onPick = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(RunReferenceRows, { requiredLabel: "Email", sheets: [{ libraryId: "roster", name: "Roster", currentVersionId: "current", ...sheet }], chosenSheetId: "",
      worksheets: [], worksheetsState: "ready", worksheetsError: null, busy: false, catalogError: null, onPick, onVersion: () => undefined, onWorksheet: () => undefined, onRemove: () => undefined, onRefresh: () => undefined }));
  });
  const trigger = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Add spreadsheet"));
  assert.ok(trigger);
  await act(async () => { trigger.click(); });
  const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a spreadsheet"]');
  assert.ok(search);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "roster");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.includes("Roster"));
  assert.ok(item);
  return { item, onPick, close: () => act(async () => { root.unmount(); host.remove(); }) };
}

it("keeps a spreadsheet selectable when only an earlier version can have a compatible worksheet", async () => {
  const { item, onPick, close } = await openFound({ versions, worksheets: [] });
  expect(item.getAttribute("aria-disabled") ?? item.getAttribute("data-disabled")).toBeNull();
  await act(async () => { item.click(); });
  expect(onPick).toHaveBeenCalledWith("roster", "current");
  await close();
});

it("refuses a spreadsheet with no compatible worksheet and no earlier version", async () => {
  const { item, onPick, close } = await openFound({ versions: versions.slice(1), worksheets: [] });
  expect(item.getAttribute("aria-disabled") ?? item.getAttribute("data-disabled")).not.toBeNull();
  expect(item.textContent).toContain("No worksheet has Email");
  await act(async () => { item.click(); });
  expect(onPick).not.toHaveBeenCalled();
  await close();
});
