// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { StorageNotice } from "../../../../src/dashboard/surfaces/settings/storage/storage-settings.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("a real Storage checks click opens Settings with no section argument", async () => {
  const calls: unknown[][] = [];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const storage = StorageHealthSummaryWireSchema.parse({ authority: "unavailable", backup: "current", checkedAt: "2026-08-27T16:00:00.000Z" });
  await act(async () => root.render(createElement(StorageNotice, { storage, onOpenSettings: (...args: unknown[]) => { calls.push(args); } })));
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === "Storage checks");
  assert.ok(button);
  await act(async () => { button.click(); });
  assert.deepEqual(calls, [[]]);
  await act(async () => root.unmount()); host.remove();
});
