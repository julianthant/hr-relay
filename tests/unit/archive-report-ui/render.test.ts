// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SavedArchiveWorkspace } from "../../../src/dashboard/surfaces/archive-report.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); document.body.replaceChildren(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function mount(overrides: Record<string, unknown> = {}, selection: string = H_REPORT.runId) {
  const calls = { savedArchiveIndex: vi.fn(async () => ({ items: [H_REPORT], next: null })), savedArchiveReport: vi.fn(async () => H_REPORT), savedArchiveFile: vi.fn(async () => ({ runId: H_REPORT.runId, digest: H_REPORT.files[0].digest, resource: { state: "missing", reason: "Missing bytes" } })), executeCommand: vi.fn(), ...overrides };
  const client = new Proxy(calls, { get(target, key) { if (!(key in target)) throw new Error(`Forbidden live read ${String(key)}`); return Reflect.get(target, key) as unknown; } }) as unknown as DashboardClient;
  function Harness() { const [selected, select] = useState(selection); return createElement(DashboardClientProvider, { client, children: createElement(SavedArchiveWorkspace, { selection: selected, view: "runs", actorId: "synthetic", onSelection: select, onView: () => undefined, onClose: () => undefined }) }); }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  await act(async () => root.render(createElement(Harness)));
  return calls;
}
async function click(name: string) { const button = [...document.querySelectorAll("button")].find(b => b.textContent === name); expect(button).toBeDefined(); await act(async () => button!.click()); }
async function input(label: string, value: string) { const field = [...document.querySelectorAll("label")].find(el => el.textContent === label)!.querySelector("input")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
it("renders generic sections and exact outcomes without live reads or execution doors", async () => {
  await mount(); const text = document.body.textContent;
  for (const value of ["Synthetic subject", "Captured approval", "No", "Yes", "Not recorded", "These bytes were not retained.", "Commit not captured", "superseded", "Synthetic operator"]) expect(text).toContain(value);
  expect(document.querySelector("script")).toBeNull(); expect(text).not.toMatch(/Relaunch|Restart|Retry/);
});
it("sends indexed filters, discards cursor/selection, and does not reconstruct an empty response", async () => {
  const read = vi.fn().mockResolvedValueOnce({ items: [H_REPORT], next: { runId: H_REPORT.runId, completedAt: H_REPORT.completedAt } }).mockResolvedValueOnce({ items: [], next: null }).mockResolvedValue({ items: [], next: null });
  await mount({ savedArchiveIndex: read }); await click("Next reports"); expect(read.mock.calls[1][0]).toHaveProperty("after");
  await input("Workflow", "removed-workflow"); expect(read.mock.calls.at(-1)![0]).toEqual({ limit: 50, workflow: "removed-workflow" });
  expect(document.body.textContent).toContain("No saved reports match"); expect(document.querySelector("article")).toBeNull();
});
it("keeps refresh loading honest and ignores superseded list responses", async () => {
  const old = deferred<unknown>(); const fresh = deferred<unknown>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await mount({ savedArchiveIndex: read }, ""); expect(document.body.textContent).toContain("Loading saved reports");
  await click("Refresh"); await act(async () => fresh.resolve({ items: [], next: null })); await act(async () => old.resolve({ items: [H_REPORT], next: null }));
  expect(document.body.textContent).toContain("No saved reports match"); expect(document.body.textContent).not.toContain(H_REPORT.title);
});
it.each(["missing", "deleted", "unavailable"])("names the served %s detail state", async state => {
  await mount({ savedArchiveReport: async () => ({ state, runId: H_REPORT.runId, reason: "Served reason" }) });
  expect(document.body.textContent).toContain(`Report ${state}: Served reason`); expect(document.querySelector("article")).toBeNull();
});
it("reports transport errors without claiming empty or deleted", async () => {
  await mount({ savedArchiveIndex: async () => { throw new Error("Index unavailable"); }, savedArchiveReport: async () => { throw new Error("Detail unavailable"); } });
  expect(document.body.textContent).toContain("Index unavailable"); expect(document.body.textContent).toContain("Detail unavailable"); expect(document.body.textContent).not.toContain("No saved reports match");
});
it("confirms exact deletion, preserves uncertain request identity, and clears only after applied", async () => {
  const execute = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ state: "applied" });
  const calls = await mount({ executeCommand: execute }); await click("Delete saved report"); expect(execute).not.toHaveBeenCalled();
  await click("Confirm deletion"); expect(document.querySelector("article")).not.toBeNull(); expect(document.body.textContent).toContain("Connection lost");
  await click("Confirm deletion"); expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]); expect(execute.mock.calls[0][0]).toMatchObject({ target: { archivedRunId: H_REPORT.runId, archiveFingerprint: H_REPORT.archiveFingerprint } });
  expect(document.querySelector("article")).toBeNull(); expect(calls.savedArchiveIndex).toHaveBeenCalledTimes(2);
});
it("late deletion settlement cannot clear a replacement selection", async () => {
  const result = deferred<unknown>(); const second = { ...H_REPORT, runId: "00000000-0000-4000-8000-000000000083", title: "Second report" };
  const index = vi.fn(async () => ({ items: [H_REPORT, second], next: null }));
  await mount({ savedArchiveIndex: index, savedArchiveReport: async (id: string) => id === H_REPORT.runId ? H_REPORT : second, executeCommand: () => result.promise });
  await click("Delete saved report"); await click("Confirm deletion"); await click("Second report"); await act(async () => result.resolve({ state: "applied" }));
  expect(document.querySelector("article")!.textContent).toContain("Second report"); expect(document.body.textContent).not.toContain("Confirm deletion"); expect(index).toHaveBeenCalledTimes(2);
});
