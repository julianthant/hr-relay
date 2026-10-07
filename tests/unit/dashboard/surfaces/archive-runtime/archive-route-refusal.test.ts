// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { RuntimeArchiveWorkspace } from "../../../../../src/dashboard/surfaces/archive-runtime.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { parseRoute } from "../../../../../src/dashboard/app/url-state.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("shows malformed Archive route refusal and blocks an otherwise available workflow export", async () => {
  const route = parseRoute(`?archive=&archiveBrowse=${encodeURIComponent("{")}`);
  let exports = 0;
  const served = {
    savedRuntimeVersions: async () => ({ revision: 1, dashboard: { major: 1, minor: 0 }, workflows: [], changes: [] }),
    savedArchiveGroups: async () => ({ groups: [{ dashboardVersion: { major: 1, minor: 0 }, workflow: "person-lookup", workflowVersion: { major: 1, minor: 0 }, reportCount: 1, latestCompletedAt: "2026-09-26T12:00:00.000Z" }] }),
    savedArchiveIndex: async () => ({ items: [], next: null }),
    exportArchiveWorkflow: async () => { exports++; throw new Error("refused route must not export"); },
  };
  const client = new Proxy(served, { get(target, key) {
    if (!(key in target)) throw new Error(`unexpected Archive client.${String(key)}`);
    return Reflect.get(target, key) as unknown;
  } }) as unknown as DashboardClient;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  async function render(invalid: boolean) {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(RuntimeArchiveWorkspace, {
      selection: "", view: "runs", folder: { dashboardKey: "1.0", workflow: "person-lookup" }, actorId: "local-operator",
      onSelection: () => undefined, onView: () => undefined, onFolder: () => undefined, onBrowse: () => undefined,
      browseInvalid: invalid,
    }) })));
  }
  try {
    await render(false);
    assert.ok([...host.querySelectorAll("button")].some(button => button.textContent?.includes("Export workflow")), "positive valid scope can export");
    await render(route.archiveBrowseInvalid === true);
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Invalid Archive browsing state/u);
    assert.equal([...host.querySelectorAll("button")].some(button => button.textContent?.includes("Export workflow")), false);
    assert.equal(exports, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
