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
async function mount(overrides: Record<string, unknown> = {}, selection: string = H_REPORT.runId, view: "runs" | "versions" = "runs") {
  const calls = { savedArchiveIndex: vi.fn(async () => ({ items: [H_REPORT], next: null })), savedArchiveReport: vi.fn(async () => H_REPORT), savedArchiveFile: vi.fn(async () => ({ runId: H_REPORT.runId, digest: H_REPORT.files[0].digest, resource: { state: "missing", reason: "Missing bytes" } })), executeCommand: vi.fn(), ...overrides };
  const client = new Proxy(calls, { get(target, key) { if (!(key in target)) throw new Error(`Forbidden live read ${String(key)}`); return Reflect.get(target, key) as unknown; } }) as unknown as DashboardClient;
  function Harness() { const [selected, select] = useState(selection); return createElement(DashboardClientProvider, { client, children: createElement(SavedArchiveWorkspace, { selection: selected, view, actorId: "synthetic", onSelection: select, onView: () => undefined }) }); }
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
it.each(["missing", "unavailable"])("names the served %s detail state", async state => {
  await mount({ savedArchiveReport: async () => ({ state, runId: H_REPORT.runId, reason: "Served reason" }) });
  expect(document.body.textContent).toContain(`Report ${state}: Served reason`); expect(document.querySelector("article")).toBeNull();
});
it("draws the served deleted detail status", async () => {
  await mount({ savedArchiveReport: async () => deletedDetail() });
  expect(document.body.textContent).toContain("Saved report deleted");
  expect(document.body.textContent).toContain("File cleanup: complete");
  expect(document.querySelector("article")).toBeNull();
});
it("reports transport errors without claiming empty or deleted", async () => {
  await mount({ savedArchiveIndex: async () => { throw new Error("Index unavailable"); }, savedArchiveReport: async () => { throw new Error("Detail unavailable"); } });
  expect(document.body.textContent).toContain("Index unavailable"); expect(document.body.textContent).toContain("Detail unavailable"); expect(document.body.textContent).not.toContain("No saved reports match");
});
it("confirms exact deletion, preserves uncertain request identity, and refreshes canonical status after applied", async () => {
  let deleted = false;
  const execute = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockImplementationOnce(async () => { deleted = true; return { state: "applied" }; });
  const calls = await mount({ executeCommand: execute, savedArchiveReport: async () => deleted ? deletedDetail() : H_REPORT }); await click("Delete saved report"); expect(execute).not.toHaveBeenCalled();
  await click("Confirm deletion"); expect(document.querySelector("article")).not.toBeNull(); expect(document.body.textContent).toContain("Connection lost");
  await click("Confirm deletion"); expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]); expect(execute.mock.calls[0][0]).toMatchObject({ target: { archivedRunId: H_REPORT.runId, archiveFingerprint: H_REPORT.archiveFingerprint } });
  expect(document.querySelector("article")).toBeNull(); expect(document.body.textContent).toContain("Saved report deleted"); expect(calls.savedArchiveIndex).toHaveBeenCalledTimes(2);
});
it("late deletion settlement cannot clear a replacement selection", async () => {
  const result = deferred<unknown>(); const second = { ...H_REPORT, runId: "00000000-0000-4000-8000-000000000083", title: "Second report" };
  const index = vi.fn(async () => ({ items: [H_REPORT, second], next: null }));
  await mount({ savedArchiveIndex: index, savedArchiveReport: async (id: string) => id === H_REPORT.runId ? H_REPORT : second, executeCommand: () => result.promise });
  await click("Delete saved report"); await click("Confirm deletion"); await click("Second report"); await act(async () => result.resolve({ state: "applied" }));
  expect(document.querySelector("article")!.textContent).toContain("Second report"); expect(document.body.textContent).not.toContain("Confirm deletion"); expect(index).toHaveBeenCalledTimes(2);
});

const reviewedChange = { changeId: "00000000-0000-4000-8000-000000009500", state: "planned", targetVersion: "2.0.0",
  change: { kind: "major", what: "Synthetic review", why: "Recovery proof" }, reviewFingerprint: "a".repeat(64),
  scope: { kind: "workflows", workflowIds: ["removed-workflow"] }, memberRunIds: [], completedRunIds: [], blockerRunIds: [] };
const versionWire = (change: Record<string, unknown>) => ({ appVersion: "0.1.0", workflows: [], changes: [change], historicalChanges: 0 });
const retainedDeleteRequest = { commandId: "00000000-0000-4000-8000-000000009502", requestedAt: "2026-09-10T00:00:00.000Z",
  requestedBy: "local-operator", source: "dashboard", family: "version-archive", type: "delete-archived-run",
  target: { archivedRunId: H_REPORT.runId, archiveFingerprint: H_REPORT.archiveFingerprint } };
const deletedDetail = (command: Record<string, unknown> = { state: "complete", commandId: retainedDeleteRequest.commandId, completedAt: "2026-09-10T00:01:00.000Z" }) => ({
  state: "deleted", runId: H_REPORT.runId, reason: "This run was explicitly deleted.",
  deletion: { state: "deleted", runId: H_REPORT.runId, deletedAt: "2026-09-10T00:00:00.000Z",
    removed: [{ table: "workflow_runs", rows: 1 }], cleanup: { state: "complete", fileCount: 1 }, command },
});
it("reuses the exact apply envelope after a lost response", async () => {
  const execute = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ state: "applied" });
  await mount({ savedArchiveVersions: async () => versionWire(reviewedChange), executeCommand: execute }, "", "versions");
  await click("Apply reviewed change");
  expect(document.body.textContent).toContain("Connection lost");
  await click("Apply reviewed change");
  expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);
});
it("uses the served authenticated apply envelope after reload", async () => {
  const resumeRequest = { commandId: "00000000-0000-4000-8000-000000009501", requestedAt: "2026-09-10T00:00:00.000Z",
    requestedBy: "synthetic", source: "archive", family: "version-archive", type: "apply-version-bump",
    target: { versionPlanId: reviewedChange.changeId, expectedVersion: 1 }, payload: { planFingerprint: reviewedChange.reviewFingerprint } };
  const execute = vi.fn().mockResolvedValue({ state: "applied" });
  await mount({ savedArchiveVersions: async () => versionWire({ ...reviewedChange, state: "applying", resumeRequest }), executeCommand: execute }, "", "versions");
  await click("Apply reviewed change");
  expect(execute).toHaveBeenCalledWith(resumeRequest);
});
it("refuses to invent an envelope for an unrecoverable applying claim", async () => {
  const execute = vi.fn();
  await mount({ savedArchiveVersions: async () => versionWire({ ...reviewedChange, state: "applying" }), executeCommand: execute }, "", "versions");
  await click("Apply reviewed change");
  expect(execute).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Original apply request unavailable");
});
it("refreshes a replacement review after membership refusal and requires a new explicit confirmation", async () => {
  const replacement = { ...reviewedChange, changeId: "00000000-0000-4000-8000-000000009503", reviewFingerprint: "c".repeat(64) };
  const reads = vi.fn()
    .mockResolvedValueOnce(versionWire({ ...reviewedChange, memberRunIds: [H_REPORT.runId] }))
    .mockResolvedValue({ ...versionWire(replacement), changes: [{ ...reviewedChange, state: "superseded" }, replacement] });
  const execute = vi.fn().mockResolvedValueOnce({ state: "rejected", commandId: "unused", code: "replan-required", message: "Membership changed." })
    .mockResolvedValueOnce({ state: "applied" });
  await mount({ savedArchiveVersions: reads, executeCommand: execute }, "", "versions");
  expect(document.body.textContent).toContain("Reviewed membership");
  await click("Apply reviewed change");
  expect(reads).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Membership changed.");
  const applyButtons = [...document.querySelectorAll("button")].filter(button => button.textContent === "Apply reviewed change");
  expect(applyButtons).toHaveLength(1);
  await act(async () => applyButtons[0].click());
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1][0]).not.toEqual(execute.mock.calls[0][0]);
});
it("resumes only the authenticated retained deletion", async () => {
  let completed = false;
  const execute = vi.fn().mockImplementation(async () => { completed = true; return { state: "applied" }; });
  const pending = { state: "pending", reason: "Final audit pending.", resumeRequest: retainedDeleteRequest };
  await mount({ savedArchiveReport: async () => completed ? deletedDetail() : deletedDetail(pending), executeCommand: execute });
  expect(document.body.textContent).toContain("File cleanup: complete");
  await click("Resume deletion cleanup");
  expect(execute).toHaveBeenCalledWith(retainedDeleteRequest);
  expect(document.body.textContent).toContain("Command settlement: complete");
});
it("keeps historical deletion recovery without retained evidence explicit and inert", async () => {
  const execute = vi.fn();
  await mount({ savedArchiveReport: async () => deletedDetail({ state: "unavailable", reason: "Historical request metadata absent." }), executeCommand: execute });
  expect(document.body.textContent).toContain("Historical request metadata absent.");
  expect([...document.querySelectorAll("button")].some(button => button.textContent === "Resume deletion cleanup")).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});
