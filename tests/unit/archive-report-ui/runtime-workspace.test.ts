// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { RuntimeArchiveWorkspace } from "../../../src/dashboard/surfaces/archive-runtime.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); document.body.replaceChildren(); });

const groups = { groups: [{ dashboardVersion: null, workflow: H_REPORT.workflow, workflowVersion: null,
  reportCount: 1, latestCompletedAt: H_REPORT.completedAt }] };
const runtime = { revision: 1, dashboard: { major: 1, minor: 0 }, workflows: [
  { workflowId: "first-workflow", label: "First workflow", version: { major: 1, minor: 1 } },
  { workflowId: "second-workflow", label: "Second workflow", version: { major: 1, minor: 0 } },
], changes: [] };

async function mount() {
  const calls = { savedRuntimeVersions: vi.fn(async () => runtime), savedArchiveGroups: vi.fn(async () => groups),
    savedArchiveIndex: vi.fn(async () => ({ items: [H_REPORT], next: null })),
    savedArchiveReport: vi.fn(async () => H_REPORT),
    savedArchiveFile: vi.fn(async () => ({ runId: H_REPORT.runId, digest: H_REPORT.files[0].digest,
      resource: { state: "missing", reason: "Synthetic bytes absent" } })),
    executeCommand: vi.fn(async () => ({ state: "applied" })) };
  const client = new Proxy(calls, { get(target, key) {
    if (!(key in target)) throw new Error(`Unexpected Archive client read ${String(key)}`);
    return Reflect.get(target, key) as unknown;
  } }) as unknown as DashboardClient;
  function Harness() {
    const [view, setView] = useState<"runs" | "versions">("runs");
    const [selection, setSelection] = useState("");
    return createElement(DashboardClientProvider, { client, children: createElement(RuntimeArchiveWorkspace, {
      view, selection, actorId: "local-operator", onView: setView, onSelection: setSelection, onClose: () => undefined,
    }) });
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  await act(async () => root.render(createElement(Harness)));
  return calls;
}

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(row => row.textContent?.trim().startsWith(label));
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

it("shows version groups with report detail and keeps the two views in the top header", async () => {
  const calls = await mount();
  const header = document.querySelector("header");
  expect(header?.textContent).toContain("Version archives");
  expect(header?.textContent).toContain("Plan a bump");
  expect(header?.textContent).not.toContain("Refresh");
  expect(document.body.textContent).toContain("Version not recorded");
  expect(document.body.textContent).toContain(H_REPORT.title);
  await click(H_REPORT.title);
  expect(document.querySelector("article")?.textContent).toContain("Captured approval");
  expect(calls.savedArchiveIndex).toHaveBeenCalledWith(expect.objectContaining({workflow:H_REPORT.workflow,versionState:"unrecorded",limit:50}));
});

it("reviews one workflow without changing the dashboard scope, then offers the all-workflow action", async () => {
  const calls = await mount();
  await click("Plan a bump");
  await click("Review affected runs");
  expect(calls.executeCommand).toHaveBeenCalledWith(expect.objectContaining({type:"plan-runtime-version",
    target:{scope:{kind:"workflows",workflowIds:["first-workflow"]}}}));
  await click("Dashboard versionAdvance every workflow to 2.0");
  await click("Review affected runs");
  expect(calls.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({type:"plan-runtime-version",
    target:{scope:{kind:"dashboard"}}}));
});
