// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { SavedArchiveReport } from "../../../../../src/dashboard/surfaces/archive-report.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { SavedArchiveReportWireSchema } from "../../../../../src/models/dashboard/archive.js";
import { H_REPORT } from "../../../../support/fixtures/dashboard/fixture-archive-report.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

const longName = `Employee and document ${"Longname".repeat(12)}.pdf`;
const report = SavedArchiveReportWireSchema.parse({
  ...H_REPORT,
  title: `Failed saved run for ${longName}`,
  outcome: "failed",
  transferId: "00000000-0000-4000-8000-000000000084",
  itemId: `item-${"identity".repeat(8)}`,
  attempt: 2,
  runNumber: null,
  reportIntegrity: "verified",
  runtimeVersion: { state: "adopted", dashboard: { major: 4, minor: 1 }, workflow: { major: 6, minor: 2 } },
  sections: [
    { kind: "values", title: "Captured facts", values: [
      { label: "Employee name", value: longName }, { label: "Empty", value: "" }, { label: "Zero", value: 0 },
      { label: "False", value: false }, { label: "Null", value: null }, { label: "Empty list", value: [] },
      { label: "Empty record", value: {} }, { label: "Structured", value: { city: "München", flags: [false, 0] } },
    ] },
    { kind: "table", title: "Retained work", columns: ["Document", "Result"], rows: [[longName, "Failed"]] },
    { kind: "text", title: "Saved logs", text: `Failure recorded for ${longName}.` },
    { kind: "unavailable", title: "Old evidence", reason: "These bytes were not retained." },
  ],
  files: [{ ...H_REPORT.files[0], name: longName, artifactIds: ["00000000-0000-4000-8000-000000000085"] }],
});

async function mount(savedReport = report) {
  const calls = { savedArchiveFile: vi.fn(async () => ({ runId: savedReport.runId, digest: savedReport.files[0]?.digest ?? "b".repeat(64),
    resource: { state: "missing" as const, reason: "Bytes unavailable in this synthetic report." } })) };
  const client = new Proxy(calls, { get(target, key) {
    if (!(key in target)) throw new Error(`Unexpected saved report client read ${String(key)}`);
    return Reflect.get(target, key) as unknown;
  } }) as unknown as DashboardClient;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  await act(async () => root.render(createElement(DashboardClientProvider, {
    client, children: createElement(SavedArchiveReport, { report: savedReport }),
  })));
  await act(async () => { await Promise.resolve(); });
  const rerender = async (nextReport: typeof report) => {
    await act(async () => root.render(createElement(DashboardClientProvider, {
      client, children: createElement(SavedArchiveReport, { report: nextReport }),
    })));
  };
  return { calls, rerender };
}

async function clickSection(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("nav[aria-label='Run sections'] button")].find(row => (row.getAttribute("aria-label") ?? row.textContent?.trim()) === label);
  if (button === undefined) throw new Error(`Missing report section ${label}.`);
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

it("renders retained document with no provider, descriptors, live records, or files", () => {
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report: { ...H_REPORT, files: [] } }));
  expect(html).toContain("Workflow details"); expect(html).toContain("Synthetic subject");
  expect(html).toContain("Yes"); expect(html).toContain("No"); expect(html).toContain("Null");
  expect(html).toContain("Dashboard version"); expect(html).toContain("Workflow version");
  expect(html).toContain('aria-current="page"'); expect(html).not.toContain("Export report");
  expect(html.match(/<a /gu)).toBeNull();
});

it("shows historical run summary facts only from retained fields and formats elapsed time", () => {
  const legacy = SavedArchiveReportWireSchema.parse({ ...report, sections: [
    { kind: "values", title: "Run and frozen inputs", values: [
      { label: "envelope.enqueuedAt", value: "2026-09-10T10:00:00.000Z" },
      { label: "envelope.attempt", value: 2 },
      { label: "envelope.dryRun", value: true },
    ] }, ...report.sections,
  ], completedAt: "2026-09-10T11:02:03.000Z" });
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report: legacy }));
  expect(html).toContain("Run summary");
  expect(html).toContain("Not recorded");
  expect(html).toContain("1h 2m 3s");
  expect(html).toContain("Includes queued and waiting time");
  expect(html).toContain("Dry run");
  const missing = renderToStaticMarkup(createElement(SavedArchiveReport, { report: { ...report, sections: [] } }));
  expect(missing).toContain("Run summary");
  expect(missing).toContain("Not recorded");
});

it("shows workflow facts while retaining hidden technical sections and exact value distinctions", async () => {
  const { calls } = await mount();
  expect(document.body.textContent).toContain(longName);
  expect(document.body.textContent).toContain('""');
  expect(document.body.textContent).toContain("0");
  expect(document.body.textContent).toContain("false");
  expect(document.body.textContent).toContain("Null");
  expect(document.body.textContent).toContain("Empty list");
  expect(document.body.textContent).toContain("Empty record");
  expect(document.body.textContent).toContain('"München"');
  expect(document.querySelector("nav[aria-label='Run sections'] [aria-current='page']")?.textContent).toBe("Workflow details");

  expect(document.querySelector("nav[aria-label='Run sections']")?.textContent).not.toContain("Outputs");
  expect(report.sections.find(section => section.title === "Retained work")).toBeDefined();
  await clickSection("Logs");
  expect(document.body.textContent).not.toContain(`Failure recorded for ${longName}.`);
  expect(document.body.textContent).not.toContain("Prepare");
  expect(document.querySelector("nav[aria-label='Run sections']")?.textContent).not.toContain("Old evidence");
  await clickSection("Retained files");
  expect(document.body.textContent).toContain("Bytes unavailable in this synthetic report.");
  const fileDetails = document.querySelector<HTMLButtonElement>('section[aria-label="Retained attachments"] button[aria-expanded]');
  expect(fileDetails).not.toBeNull();
  await act(async () => fileDetails!.click());
  expect(document.body.textContent).toContain("Artifact IDs");
  expect(document.body.textContent).not.toContain("Total size");
  expect(document.body.textContent).toContain(report.files[0].artifactIds![0]);
  expect(document.querySelector("nav[aria-label='Run sections']")?.textContent).not.toContain("Record details");
  expect(document.querySelector("nav[aria-label='Run sections']")?.textContent).not.toContain("All fields");
  expect(calls.savedArchiveFile).toHaveBeenCalledWith(report.runId, report.files[0].digest);
});

it("shows only exact sealed file task/action links", async () => {
  const file = report.files[0];
  const linked = SavedArchiveReportWireSchema.parse({ ...report, sections: [...report.sections,
    { kind: "values", title: "Retained file relationships", values: [
      { label: file.digest, value: { taskId: "ucpath/search-person-org", actionId: "00000000-0000-4000-8000-000000000087" } },
      { label: "f".repeat(64), value: { taskId: "unrelated/task", actionId: "00000000-0000-4000-8000-000000000088" } },
    ] },
  ] });
  await mount(linked);
  await clickSection("Retained files");
  const details = document.querySelector<HTMLButtonElement>('section[aria-label="Retained attachments"] button[aria-expanded]');
  await act(async () => details!.click());
  expect(document.body.textContent).toContain("Retained task ID");
  expect(document.body.textContent).toContain("ucpath/search-person-org");
  expect(document.body.textContent).not.toContain("unrelated/task");
});

it("discloses structured values with exact JSON and keeps public identifiers selectable", async () => {
  await mount();
  const summary = [...document.querySelectorAll("summary")].find(node => node.textContent?.startsWith("Record ·"));
  expect(summary).toBeDefined();
  await act(async () => summary!.click());
  expect(summary?.parentElement?.textContent).toContain('"city":"München"');

});

it("resets a selected pane when the saved run changes", async () => {
  const { rerender } = await mount();
  await clickSection("Logs");
  const { versionChange: _versionChange, ...withoutVersionChange } = report;
  const nextReport = SavedArchiveReportWireSchema.parse({ ...withoutVersionChange,
    runId: "00000000-0000-4000-8000-000000000086", sections: [], files: [] });
  await rerender(nextReport);
  expect(document.querySelector("nav[aria-label='Run sections'] [aria-current='page']")?.getAttribute("aria-label")).toBe("Workflow details");
  await clickSection("Retained files");
  expect(document.body.textContent).toContain("No attachment was retained with this report.");
  expect(document.body.textContent).not.toContain(longName);
});

it("announces a stale routed report section instead of silently selecting its default", () => {
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report, section: 999 }));
  expect(html).toContain("This view is no longer shown. Choose a section below.");
  expect(html).toContain('role="alert"');
  expect(html).toContain("Workflow details");
});

it("shows the known missing settings reason without an expandable metadata record", async () => {
  await mount(SavedArchiveReportWireSchema.parse({ ...report, sections: [{ kind: "values", title: "Inputs & settings", values: [
    { label: "Captured settings", value: { state: "unavailable", reason: "No settings snapshot was retained for this run" } },
  ] }] }));
  expect(document.body.textContent).toContain("No settings snapshot was retained for this run");
  const settings = document.querySelector("section[aria-label='Settings']");
  expect(settings).not.toBeNull();
  expect(settings?.querySelector("summary")).toBeNull();
});

it("renders submitted input fields directly in one selected table", async () => {
  await mount(SavedArchiveReportWireSchema.parse({ ...report, sections: [{ kind: "values", title: "Inputs & settings", values: [
    { label: "Run mode", value: "Dry run" },
    { label: "Submitted input", value: { employeeId: "DEMO-01", lastDayWorked: "2026-09-14", verified: false, count: 0 } },
    { label: "Parsed input", value: { employeeId: "DEMO-01" } },
    { label: "Captured settings", value: { state: "unavailable", reason: "No settings snapshot was retained for this run" } },
  ] }] }));
  const submitted = document.querySelector("section[aria-label='Submitted input']");
  expect(submitted).not.toBeNull();
  expect(submitted?.textContent).toContain("Employee ID");
  expect(submitted?.textContent).toContain("Last day worked");
  expect(submitted?.textContent).toContain("No");
  expect(submitted?.textContent).toContain("0");
  expect(submitted?.querySelector("summary")).toBeNull();
  expect([...document.querySelectorAll("article h3")].map(node => node.textContent)).toContain("Submitted input");
});
