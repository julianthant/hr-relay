// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { RuntimeArchiveWorkspace } from "../../../src/dashboard/surfaces/archive-runtime.js";
import { archiveCsvFields } from "../../../src/domain/dashboard/archive-export.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const digest = H_REPORT.files[0].digest;
const url = `/artifacts/v1/archive/${H_REPORT.runId}/files/${digest}`;
async function showRetainedFiles(host: HTMLElement) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("nav[aria-label='Run sections'] button")].find(row => row.textContent?.trim() === "Retained files");
  if (button === undefined) throw new Error("Missing Retained files section.");
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}
it.each([
  ["available", { state: "available", downloadUrl: url }, true],
  ["missing", { state: "missing", reason: "Bytes removed" }, false],
  ["error", { state: "error", message: "Integrity failed" }, false],
  ["foreign sink", { state: "available", downloadUrl: "https://example.invalid/file" }, false],
  ["script sink", { state: "available", downloadUrl: "javascript:alert(1)" }, false],
  ["malformed", { state: "available" }, false],
  ["foreign member", { state: "available", downloadUrl: url.replace(digest, "c".repeat(64)) }, false],
] as const)("exposes a native link only for authorized %s", async (_name, resource, allowed) => {
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => new Response(JSON.stringify({ runId: H_REPORT.runId, digest, resource }), { headers: { "content-type": "application/json" } }) });
  const host = document.createElement("div"); const root = createRoot(host);
  try { await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(SavedArchiveReport, { report: H_REPORT }) })));
    await showRetainedFiles(host);
    const attachment = [...host.querySelectorAll("a")].find(link => link.getAttribute("download") === H_REPORT.files[0].name);
    expect(attachment?.getAttribute("href") ?? null).toBe(allowed ? url : null);
    expect(attachment?.getAttribute("download") ?? null).toBe(allowed ? H_REPORT.files[0].name : null);
    if (!allowed) expect(host.querySelector('[role="alert"], [role="status"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});
it.each(["run", "digest"])("rejects a well-formed response for a different %s", async changed => {
  const runId = changed === "run" ? "00000000-0000-4000-8000-000000000084" : H_REPORT.runId;
  const returnedDigest = changed === "digest" ? "c".repeat(64) : digest;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => new Response(JSON.stringify({ runId, digest: returnedDigest, resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${runId}/files/${returnedDigest}` } }), { headers: { "content-type": "application/json" } }) });
  await expect(client.savedArchiveFile(H_REPORT.runId, digest)).rejects.toThrow();
});
it("does not expose a link while authorization is pending or after transport failure", async () => {
  let reject!: (reason: Error) => void;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: () => new Promise<Response>((_resolve, fail) => { reject = fail; }) });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(SavedArchiveReport, { report: H_REPORT }) })));
    await showRetainedFiles(host);
    expect(host.textContent).toContain("Checking Synthetic receipt.txt");
    expect([...host.querySelectorAll("a")].some(link => link.getAttribute("download") === H_REPORT.files[0].name)).toBe(false);
    await act(async () => reject(new Error("Transport failed")));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect([...host.querySelectorAll("a")].some(link => link.getAttribute("download") === H_REPORT.files[0].name)).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("exports exactly the selected served public report as JSON and typed CSV under the run filename", async () => {
  const runtime = { revision: 1, dashboard: { major: 1, minor: 0 }, workflows: [], changes: [] };
  const groups = { groups: [{ dashboardVersion: null, workflow: H_REPORT.workflow, workflowVersion: null,
    reportCount: 1, latestCompletedAt: H_REPORT.completedAt }] };
  const calls = { savedRuntimeVersions: async () => runtime, savedArchiveGroups: async () => groups,
    savedArchiveReport: async (runId: string) => runId === H_REPORT.runId ? H_REPORT : Promise.reject(new Error("Unknown saved run")),
    savedArchiveIndex: async () => ({ items: [H_REPORT], next: null }),
    savedArchiveFile: async () => ({ runId: H_REPORT.runId, digest, resource: { state: "missing", reason: "Not needed for run export" } }),
    executeCommand: async () => ({ state: "applied" as const }) };
  const client = calls as unknown as DashboardClient;
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const blobs: Blob[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return `blob:archive-${blobs.length}`; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const downloads: { name: string; href: string }[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(RuntimeArchiveWorkspace, {
      view: "runs", selection: H_REPORT.runId, folder: null, actorId: "synthetic", onSelection: () => undefined, onView: () => undefined, onFolder: () => undefined,
    }) })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const button = (name: string) => {
      const target = [...document.querySelectorAll("button")].find(row => row.textContent?.trim() === name);
      expect(target, `button ${name}; body=${document.body.textContent}`).toBeDefined();
      return target!;
    };
    expect(host.querySelector("header")?.textContent).toContain("Export run");
    await act(async () => button("Export run").click());
    await act(async () => button("JSON").click());
    await act(async () => { await Promise.resolve(); });
    expect(downloads[0]).toEqual({ name: `archive-${H_REPORT.runId}.json`, href: "blob:archive-1" });
    expect(JSON.parse(await blobs[0].text())).toEqual(H_REPORT);
    expect((await blobs[0].text())).not.toContain("sourceDigest");
    expect((await blobs[0].text())).not.toContain("sources");

    await act(async () => button("Export run").click());
    await act(async () => button("CSV").click());
    await act(async () => { await Promise.resolve(); });
    expect(downloads[1]).toEqual({ name: `archive-${H_REPORT.runId}.csv`, href: "blob:archive-2" });
    expect(await blobs[1].text()).toBe(archiveCsvFields([H_REPORT]));
    expect(click).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    click.mockRestore();
    if (createDescriptor === undefined) Reflect.deleteProperty(URL, "createObjectURL"); else Object.defineProperty(URL, "createObjectURL", createDescriptor);
    if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, "revokeObjectURL"); else Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
  }
});
it.each(["valid", "foreign status", "foreign resume"] as const)("binds deletion readback and recovery to the selected report: %s", async shape => {
  const other = "00000000-0000-4000-8000-000000000084";
  const report = { state: "deleted", runId: H_REPORT.runId, reason: "Deleted", deletion: {
    state: "deleted", runId: shape === "foreign status" ? other : H_REPORT.runId, deletedAt: H_REPORT.completedAt,
    removed: [], cleanup: { state: "pending", fileCount: 1 },
    command: { state: "pending", reason: "Final audit pending", resumeRequest: {
      commandId: other, requestedAt: H_REPORT.completedAt, requestedBy: "local-operator", source: "dashboard",
      family: "version-archive", type: "delete-archived-run",
      target: { archivedRunId: shape === "foreign resume" ? other : H_REPORT.runId, archiveFingerprint: H_REPORT.archiveFingerprint },
    } },
  } };
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } }) });
  if (shape === "valid") await expect(client.savedArchiveReport(H_REPORT.runId)).resolves.toEqual(report);
  else await expect(client.savedArchiveReport(H_REPORT.runId)).rejects.toThrow(/ARCHIVED_RUN_IDENTITY_MISMATCH/);
});
