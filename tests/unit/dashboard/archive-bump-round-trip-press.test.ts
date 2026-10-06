// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { MockArchiveWorkspace } from "../../../src/dashboard/surfaces/archive/archive-mock.js";
import { MOCK_ARCHIVE_RUNS } from "../../../src/dashboard/surfaces/archive/archive-mock-model.js";
import { RuntimeArchiveWorkspace } from "../../../src/dashboard/surfaces/archive/archive-runtime.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { SavedRuntimeVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

async function mount(element: ReturnType<typeof createElement>) {
  host = document.createElement("div"); document.body.append(host);
  await act(async () => { root = createRoot(host!); root.render(element); await Promise.resolve(); });
}
function noVersionControls() {
  assert.ok(host);
  assert.doesNotMatch(host.textContent ?? "", /Plan a bump|Plan a version bump|Review change|Apply reviewed change|Apply the bump/u);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(host.querySelector('[name="archive-bump-scope"]'), null);
}

const sample = MOCK_ARCHIVE_RUNS[0];
if (!sample) throw new Error("archive-retirement-fixture-missing");
const mockCases = [
  { label: "mock index", view: "runs", selection: "", folder: null },
  { label: "old mock versions URL", view: "versions", selection: "", folder: null },
  { label: "mock workflow folder", view: "versions", selection: "", folder: { dashboardKey: sample.dashboard, workflow: sample.workflow } },
  { label: "mock saved report", view: "versions", selection: sample.id, folder: null },
  { label: "mock exact-run search", view: "versions", selection: "", folder: null, search: sample.id },
] as const;
it.each(mockCases)("keeps developer version controls out of $label", async scenario => {
  const onView = vi.fn(), onBrowse = vi.fn();
  await mount(createElement(ToastProvider, { children: createElement(MockArchiveWorkspace, {
    catalog: [], selection: scenario.selection, view: scenario.view, folder: scenario.folder,
    browse: { filters: "search" in scenario ? { search: scenario.search } : {} },
    onView, onBrowse, onSelection: vi.fn(), onFolder: vi.fn(), onOpenReport: vi.fn(),
  }) }));
  noVersionControls();
  assert.ok(host?.textContent?.includes(scenario.selection ? sample.title : "Archive"));
  assert.equal(onView.mock.calls.length, 0);
  assert.equal(onBrowse.mock.calls.length, 0, "reading an old route does not publish a replacement version stage");
});

const runtime = SavedRuntimeVersionIndexWireSchema.parse({ revision: 7, dashboard: { major: 1, minor: 0 }, workflows: [
  { workflowId: H_REPORT.workflow, label: "Saved workflow", version: { major: 1, minor: 2 } },
  { workflowId: "second-workflow", label: "Second workflow", version: { major: 1, minor: 0 } },
], changes: [] });
const runtimeCases = [
  { label: "runtime index", view: "runs" },
  { label: "old runtime versions URL", view: "versions" },
  { label: "runtime saved report", view: "runs", selection: H_REPORT.runId },
  { label: "saved report on the old versions URL", view: "versions", selection: H_REPORT.runId },
  { label: "runtime workflow folder", view: "versions", folder: { dashboardKey: "unrecorded", workflow: H_REPORT.workflow } },
  { label: "runtime recorded-version folder", view: "versions", folder: { dashboardKey: "1.0", workflow: H_REPORT.workflow } },
  { label: "runtime retired workflow folder", view: "versions", folder: { dashboardKey: "unrecorded", workflow: "retired-workflow" } },
  { label: "runtime empty registration", view: "versions", workflowCount: 0 },
  { label: "runtime single registration", view: "versions", workflowCount: 1 },
  { label: "runtime unavailable version authority", view: "versions", unavailable: true },
] as const;
it.each(runtimeCases)("keeps developer version controls out of $label", async scenario => {
  const executeCommand = vi.fn(), onView = vi.fn();
  const reads = {
    savedRuntimeVersions: async () => {
      if ("unavailable" in scenario) throw new Error("synthetic-version-read-unavailable");
      return "workflowCount" in scenario ? { ...runtime, workflows: runtime.workflows.slice(0, scenario.workflowCount) } : runtime;
    },
    savedArchiveGroups: async () => ({ groups: [{ dashboardVersion: null, workflow: H_REPORT.workflow, workflowVersion: null, reportCount: 1, latestCompletedAt: H_REPORT.completedAt }] }),
    savedArchiveIndex: async () => ({ items: [H_REPORT], next: null }),
    savedArchiveReport: async () => H_REPORT,
    savedArchiveFile: async () => ({ runId: H_REPORT.runId, digest: H_REPORT.files[0].digest, resource: { state: "missing", reason: "Synthetic bytes absent" } }),
    executeCommand,
  };
  const client = new Proxy(reads, { get(target, key) {
    if (!(key in target)) throw new Error(`unexpected-archive-retirement-read:${String(key)}`);
    return Reflect.get(target, key) as unknown;
  } }) as unknown as DashboardClient;
  await mount(createElement(DashboardClientProvider, { client, children: createElement(RuntimeArchiveWorkspace, {
    view: scenario.view, selection: "selection" in scenario ? scenario.selection : "", folder: "folder" in scenario ? scenario.folder : null,
    actorId: "local-operator", onView, onSelection: vi.fn(), onFolder: vi.fn(),
  }) }));
  noVersionControls();
  assert.match(host?.textContent ?? "", /Archive/u);
  assert.equal(executeCommand.mock.calls.length, 0, "archive reads do not plan, resume or apply version changes");
  assert.equal(onView.mock.calls.length, 0);
});
