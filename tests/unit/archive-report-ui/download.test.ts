// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const digest = H_REPORT.files[0].digest;
const url = `/artifacts/v1/archive/${H_REPORT.runId}/files/${digest}`;
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
    expect(host.textContent).toContain("Checking Synthetic receipt.txt");
    expect([...host.querySelectorAll("a")].some(link => link.getAttribute("download") === H_REPORT.files[0].name)).toBe(false);
    await act(async () => reject(new Error("Transport failed")));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect([...host.querySelectorAll("a")].some(link => link.getAttribute("download") === H_REPORT.files[0].name)).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
it("exports exactly the served public report wire under the stable run filename", async () => {
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => new Response(JSON.stringify({
    runId: H_REPORT.runId,
    digest,
    resource: { state: "missing", reason: "Not needed for report export" },
  }), { headers: { "content-type": "application/json" } }) });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(SavedArchiveReport, { report: H_REPORT }) })));
    const exported = [...host.querySelectorAll("a")].find(link => link.textContent?.includes("Export report"));
    expect(exported?.getAttribute("download")).toBe(`archive-${H_REPORT.runId}.json`);
    const href = exported?.getAttribute("href") ?? "";
    expect(href.startsWith("data:application/json;charset=utf-8,")).toBe(true);
    expect(JSON.parse(decodeURIComponent(href.split(",", 2)[1] ?? ""))).toEqual(H_REPORT);
    expect(href).not.toContain("sourceDigest");
    expect(href).not.toContain("sources");
  } finally { await act(async () => root.unmount()); }
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
