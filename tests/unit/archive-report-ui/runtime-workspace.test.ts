// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ArchiveBrowseState } from "../../../src/dashboard/app/navigation/archive-route-model.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { RuntimeArchiveWorkspace } from "../../../src/dashboard/surfaces/archive/archive-runtime.js";
import * as archiveExportModel from "../../../src/dashboard/surfaces/archive/archive-export-model.js";
import type { SavedArchiveDetailWire, SavedArchiveGroupsWire, SavedArchiveIndexWire, SavedArchiveQuery, SavedRuntimeVersionIndexWire } from "../../../src/domain/dashboard/archive.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SavedArchiveReportWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let dispose: (() => Promise<void>) | undefined;
let restoreDownloadApis: (() => void) | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(async () => { await dispose?.(); restoreDownloadApis?.(); restoreDownloadApis = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const groups = { groups: [{ dashboardVersion: null, workflow: H_REPORT.workflow, workflowVersion: null,
  reportCount: 1, latestCompletedAt: H_REPORT.completedAt }] };
const runtime = SavedRuntimeVersionIndexWireSchema.parse({ revision: 1, dashboard: { major: 1, minor: 0 }, workflows: [
  { workflowId: "first-workflow", label: "First workflow", version: { major: 1, minor: 1 } },
  { workflowId: "second-workflow", label: "Second workflow", version: { major: 1, minor: 0 } },
], changes: [] });

async function mount(savedArchiveIndex: (query: SavedArchiveQuery, signal?: AbortSignal) => Promise<SavedArchiveIndexWire> = async () => ({ items: [H_REPORT], next: null }),
  savedArchiveGroups: () => Promise<SavedArchiveGroupsWire> = async () => groups, savedRuntimeVersions: () => Promise<SavedRuntimeVersionIndexWire> = async () => runtime,
  savedArchiveReport: () => Promise<SavedArchiveDetailWire> = async () => H_REPORT, initialBrowse?: ArchiveBrowseState, initialFolder: { dashboardKey: string; workflow: string } | null = null) {
  const calls = { savedRuntimeVersions: vi.fn(savedRuntimeVersions), savedArchiveGroups: vi.fn(savedArchiveGroups),
    savedArchiveIndex: vi.fn(savedArchiveIndex),
    savedArchiveReport: vi.fn(savedArchiveReport),
    savedArchiveFile: vi.fn(async () => ({ runId: H_REPORT.runId, digest: H_REPORT.files[0].digest,
      resource: { state: "missing", reason: "Synthetic bytes absent" } })),
    executeCommand: vi.fn(async () => ({ state: "applied" })) };
  const client = new Proxy(calls, { get(target, key) {
    if (!(key in target)) throw new Error(`Unexpected Archive client read ${String(key)}`);
    return Reflect.get(target, key) as unknown;
  } }) as unknown as DashboardClient;
  function Harness() {
    const [browse, setBrowse] = useState(initialBrowse);
    const [view, setView] = useState<"runs" | "versions">("runs");
    const [selection, setSelection] = useState("");
    const [folder, setFolder] = useState<{ dashboardKey: string; workflow: string } | null>(initialFolder);
    return createElement(DashboardClientProvider, { client, children: createElement(RuntimeArchiveWorkspace, {
      view, selection, folder, actorId: "local-operator", onView: setView, onSelection: setSelection, onFolder: setFolder,
      ...(initialBrowse === undefined ? {} : { browse, onBrowse: setBrowse }),
    }) });
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  await act(async () => root.render(createElement(Harness)));
  return calls;
}

function stubDownloadApis() {
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createObjectURL = vi.fn(() => "blob:archive-export");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  restoreDownloadApis = () => {
    if (createDescriptor === undefined) Reflect.deleteProperty(URL, "createObjectURL");
    else Object.defineProperty(URL, "createObjectURL", createDescriptor);
    if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, "revokeObjectURL");
    else Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
  };
  return { createObjectURL, revokeObjectURL, click };
}

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

const cursorOf = (report: typeof H_REPORT) => ({ completedAt: report.completedAt, runId: report.runId });

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(row => row.textContent?.trim().startsWith(label));
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}
async function clickContaining(label: string) {
  const button = [...document.querySelectorAll("button")].find(row => row.textContent?.includes(label));
  expect(button, `button containing ${label}`).toBeDefined();
  await act(async () => button!.click());
}
async function clickWorkflowExport(format: "JSON" | "CSV") {
  await click("Export");
  await click(format);
}

it("shows version groups with report detail and export in the top header", async () => {
  const calls = await mount();
  const header = document.querySelector("header");
  expect(header?.textContent).toContain("Version archives");
  expect(header?.textContent).not.toContain("Plan a bump");
  expect(header?.textContent).not.toContain("Refresh");
  expect(document.body.textContent).toContain("Version not recorded");
  await clickContaining(H_REPORT.workflow);
  expect(header?.textContent).toContain("Export");
  expect(document.querySelector('table[aria-label="removed-workflow saved runs"]')).not.toBeNull();
  expect(document.body.textContent).toContain(H_REPORT.title);
  await click(H_REPORT.title);
  const tabs = document.querySelector('[role="tablist"]');
  expect(tabs).not.toBeNull();
  expect(tabs?.textContent).not.toContain("Outputs");
  expect(document.querySelector("article")?.textContent).toContain("Synthetic subject");
  expect(calls.savedArchiveIndex).toHaveBeenCalledWith(expect.objectContaining({workflow:H_REPORT.workflow,versionState:"unrecorded",limit:50}));
});

it("keeps workflow table presentation and the saved report for detail and export", async () => {
  const blob = vi.spyOn(archiveExportModel, "archiveExportBlob");
  stubDownloadApis();
  await mount();
  await clickContaining(H_REPORT.workflow);

  const table = document.querySelector<HTMLTableElement>('table[aria-label="removed-workflow saved runs"]');
  expect(table).not.toBeNull();
  expect(table?.classList.contains("min-w-max")).toBe(true);
  const header = (name: string) => [...(table?.querySelectorAll("th") ?? [])].find(cell => cell.textContent === name);
  expect(header("Subject")).toBeDefined();
  expect(header("Subject")?.className).not.toContain("text-right");
  expect(header("Count")?.className).toContain("text-right");
  expect(header("Workflow version")?.className).toContain("text-right");
  expect(header("Archived")?.className).toContain("text-right");
  expect(header("Files")?.className).toContain("text-right");

  expect(document.querySelector('button[aria-label="Columns"]')).toBeNull();

  await click(H_REPORT.title);
  expect(document.querySelector("article")?.textContent).toContain("Synthetic subject");
  expect(document.querySelector("header")?.textContent).toContain("Export run");
  await click("Export run");
  await click("JSON");
  await act(async () => { await Promise.resolve(); });
  expect(blob).toHaveBeenCalledWith([H_REPORT], "json");
  await clickContaining(H_REPORT.workflow);
  await clickWorkflowExport("JSON");
  await act(async () => { await Promise.resolve(); });
  expect(blob).toHaveBeenCalledWith([H_REPORT], "json");
});

it("refuses run export when the detail response does not match the selected run", async () => {
  const returned = SavedArchiveReportWireSchema.parse({ ...H_REPORT, runId: "00000000-0000-4000-8000-000000000084" });
  await mount(undefined, undefined, undefined, vi.fn(async () => returned));
  await clickContaining(H_REPORT.workflow);
  await click(H_REPORT.title);
  expect(document.body.textContent).toContain(`Saved report identity does not match selected run ${H_REPORT.runId}.`);
  expect(document.querySelector("header")?.textContent).not.toContain("Export run");
});

it("projects served dashboard and workflow versions into separate report groups", async () => {
  const servedGroups: SavedArchiveGroupsWire = { groups: [
    { dashboardVersion: { major: 2, minor: 0 }, workflow: H_REPORT.workflow, workflowVersion: { major: 2, minor: 0 }, reportCount: 1, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: { major: 2, minor: 0 }, workflow: H_REPORT.workflow, workflowVersion: { major: 1, minor: 1 }, reportCount: 2, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: { major: 1, minor: 0 }, workflow: H_REPORT.workflow, workflowVersion: { major: 1, minor: 0 }, reportCount: 1, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: null, workflow: H_REPORT.workflow, workflowVersion: null, reportCount: 1, latestCompletedAt: H_REPORT.completedAt },
  ] };
  const versions = SavedRuntimeVersionIndexWireSchema.parse({ ...runtime, dashboard: { major: 2, minor: 0 }, workflows: [
    { workflowId: H_REPORT.workflow, label: "Person lookup", version: { major: 2, minor: 0 } },
  ] });
  const savedArchiveGroups = vi.fn(async () => servedGroups);
  const calls = await mount(undefined, savedArchiveGroups, vi.fn(async () => versions));

  expect(document.querySelector("header")?.textContent).toContain("Current · 2.0");
  expect(document.body.textContent).toContain("Dashboard 2.0");
  expect(document.body.textContent).toContain("Dashboard 1.0");
  expect(document.body.textContent).toContain("Version not recorded");
  expect(document.body.textContent).toContain("Workflow versions 2.0 · 1.1");
  expect(document.body.textContent).toContain("Workflow version 1.0");
  expect(document.body.textContent).not.toContain("latest");
  const workflowRows = [...document.querySelectorAll("button")].filter(button => button.textContent?.includes("Person lookup"));
  expect(workflowRows).toHaveLength(3);

  await clickContaining("Person lookup");
  expect(calls.savedArchiveIndex).toHaveBeenCalledWith(expect.objectContaining({
    workflow: H_REPORT.workflow, dashboardVersion: { major: 2, minor: 0 }, limit: 50,
  }));
  stubDownloadApis();
  await clickWorkflowExport("CSV");
  await act(async () => { await Promise.resolve(); });
  expect(calls.savedArchiveIndex).toHaveBeenCalledWith(expect.objectContaining({
    workflow: H_REPORT.workflow, dashboardVersion: { major: 2, minor: 0 }, limit: 100,
  }), expect.any(AbortSignal));
});

it("distinguishes an unavailable group query from an empty archive and retries it", async () => {
  let available = false;
  const savedArchiveGroups = vi.fn(async () => {
    if (!available) throw new Error("Archive groups unavailable");
    return { groups: [] };
  });
  await mount(undefined, savedArchiveGroups);

  expect(document.body.textContent).toContain("Archive groups unavailable");
  expect(document.body.textContent).not.toContain("Completed runs appear here");
  available = true;
  await click("Retry version archives");

  expect(document.body.textContent).toContain("Completed runs appear here after a reviewed version change.");
  expect(document.body.textContent).not.toContain("Archive groups unavailable");
});

it("resets report pagination when search changes while keeping the selected workflow open", async () => {
  const read = vi.fn((query: SavedArchiveQuery) => query.after === undefined
    ? Promise.resolve({ items: [H_REPORT], next: cursorOf(H_REPORT) })
    : Promise.resolve({ items: [H_REPORT], next: null }));
  const calls = await mount(read);
  await clickContaining(H_REPORT.workflow);
  await click("Next reports");

  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ after: cursorOf(H_REPORT) }));
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search saved reports"]');
  expect(search).not.toBeNull();
  await act(async () => {
    if (search === null) throw new Error("Workflow search input is missing");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.bind(search);
    setValue?.("Morgan");
    search?.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(document.querySelector('nav[aria-label="Archive path"] [aria-current="page"]')?.textContent).toBe(H_REPORT.workflow);
  const lastQuery = calls.savedArchiveIndex.mock.lastCall?.[0];
  expect(lastQuery).toMatchObject({ search: "Morgan" });
  expect(lastQuery).not.toHaveProperty("after");
});

it("keeps developer version commands absent while browsing a workflow", async () => {
  const calls = await mount();
  await clickContaining(H_REPORT.workflow);
  expect(document.body.textContent).not.toContain("Plan a bump");
  expect(document.querySelector('input[name="archive-bump-scope"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(calls.executeCommand).not.toHaveBeenCalled();
});

it("waits for every page before serializing and clicking the workflow download", async () => {
  const second = SavedArchiveReportWireSchema.parse({ ...H_REPORT, runId: "00000000-0000-4000-8000-000000000099" });
  const lastPage = deferred<{ items: typeof H_REPORT[]; next: null }>();
  const read = vi.fn((query: SavedArchiveQuery) => {
    if (query.limit === 50) return Promise.resolve({ items: [H_REPORT], next: null });
    return query.after === undefined
      ? Promise.resolve({ items: [H_REPORT], next: cursorOf(H_REPORT) })
      : lastPage.promise;
  });
  const downloads = stubDownloadApis();
  const blob = vi.spyOn(archiveExportModel, "archiveExportBlob");
  const calls = await mount(read);
  await clickContaining(H_REPORT.workflow);
  await clickWorkflowExport("JSON");
  await act(async () => { await Promise.resolve(); });

  expect(read).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), expect.any(AbortSignal));
  expect(blob).not.toHaveBeenCalled();
  expect(downloads.createObjectURL).not.toHaveBeenCalled();
  expect(downloads.click).not.toHaveBeenCalled();

  await act(async () => lastPage.resolve({ items: [second], next: null }));
  expect(blob).toHaveBeenCalledWith([H_REPORT, second], "json");
  expect(downloads.createObjectURL).toHaveBeenCalledTimes(1);
  expect(downloads.click).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Downloaded 2 saved reports.");
  expect(calls.savedArchiveIndex.mock.calls.filter(([query]) => query.limit === 100)).toHaveLength(2);
});

it("cancels an in-flight page without serializing or offering a partial download", async () => {
  const read = vi.fn((query: SavedArchiveQuery, signal?: AbortSignal) => {
    if (query.limit === 50) return Promise.resolve({ items: [H_REPORT], next: null });
    if (query.after === undefined) return Promise.resolve({ items: [H_REPORT], next: cursorOf(H_REPORT) });
    return new Promise<{ items: typeof H_REPORT[]; next: null }>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new Error("cancelled")), { once: true });
    });
  });
  const downloads = stubDownloadApis();
  const blob = vi.spyOn(archiveExportModel, "archiveExportBlob");
  const calls = await mount(read);
  await clickContaining(H_REPORT.workflow);
  await clickWorkflowExport("JSON");
  await act(async () => { await Promise.resolve(); });
  const exportCall = calls.savedArchiveIndex.mock.calls.find(([query]) => query.limit === 100);
  expect(exportCall?.[1]?.aborted).toBe(false);
  await click("Export");
  await click("Cancel export");

  expect(exportCall?.[1]?.aborted).toBe(true);
  expect(blob).not.toHaveBeenCalled();
  expect(downloads.createObjectURL).not.toHaveBeenCalled();
  expect(downloads.click).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Workflow export cancelled.");
});

it("discards late pages after the operator opens a different report", async () => {
  const second = SavedArchiveReportWireSchema.parse({ ...H_REPORT, runId: "00000000-0000-4000-8000-000000000099" });
  const lastPage = deferred<{ items: typeof H_REPORT[]; next: null }>();
  const read = vi.fn((query: SavedArchiveQuery) => {
    if (query.limit === 50) return Promise.resolve({ items: [H_REPORT], next: null });
    return query.after === undefined
      ? Promise.resolve({ items: [H_REPORT], next: cursorOf(H_REPORT) })
      : lastPage.promise;
  });
  const downloads = stubDownloadApis();
  const blob = vi.spyOn(archiveExportModel, "archiveExportBlob");
  const calls = await mount(read);
  await clickContaining(H_REPORT.workflow);
  await clickWorkflowExport("JSON");
  await act(async () => { await Promise.resolve(); });
  const exportCall = calls.savedArchiveIndex.mock.calls.find(([query]) => query.limit === 100);
  expect(exportCall?.[1]?.aborted).toBe(false);

  await click(H_REPORT.title);
  expect(exportCall?.[1]?.aborted).toBe(true);
  await act(async () => lastPage.resolve({ items: [second], next: null }));

  expect(blob).not.toHaveBeenCalled();
  expect(downloads.createObjectURL).not.toHaveBeenCalled();
  expect(downloads.click).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Saved archive report"]')).not.toBeNull();
});

it("keeps developer version controls absent from an unavailable version index", async () => {
  const calls = await mount(undefined, undefined, async () => { throw new Error("synthetic-version-read-unavailable"); });
  expect(document.body.textContent).toContain("synthetic-version-read-unavailable");
  expect(document.body.textContent).not.toContain("Plan a bump");
  expect(document.querySelector('button[aria-label="Workflow to bump"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(calls.executeCommand).not.toHaveBeenCalled();
});

it("announces missing persisted columns and resets only the column selection explicitly", async () => {
  const calls = await mount(undefined, undefined, undefined, undefined, { filters: { search: "Synthetic" }, columns: ["no-longer-retained"] }, { dashboardKey: "unrecorded", workflow: H_REPORT.workflow });
  expect(document.body.textContent).toContain("Saved column selection includes fields unavailable in this scope.");
  await click("Reset columns");
  expect(document.body.textContent).not.toContain("Saved column selection includes fields unavailable in this scope.");
  expect(document.querySelector("table")?.textContent).toContain("Synthetic subject");
  expect(calls.savedArchiveIndex).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Synthetic" }));
});

it("keeps unavailable page-local columns distinct from a confirmed stale complete scope", async () => {
  await mount(undefined, undefined, undefined, undefined, { filters: {}, columns: ["not-yet-loaded"], after: cursorOf(H_REPORT) }, { dashboardKey: "unrecorded", workflow: H_REPORT.workflow });
  expect(document.body.textContent).toContain("Other pages may retain these fields.");
  expect(document.body.textContent).not.toContain("Saved column selection includes fields unavailable in this scope.");
});
