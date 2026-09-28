// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SavedArchiveReportWireSchema } from "../../../src/domain/dashboard/archive.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

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
  expect(html).toContain("Captured facts"); expect(html).toContain("Synthetic subject");
  expect(html).toContain("Yes"); expect(html).toContain("No"); expect(html).toContain("Null");
  expect(html).toContain("Dashboard version"); expect(html).toContain("Workflow version");
  expect(html).toContain('aria-current="page"'); expect(html).not.toContain("Export report");
  expect(html.match(/<a /gu)).toBeNull();
});

it("renders each immutable saved section and keeps absent, null, false, zero, empty, and long values distinct", async () => {
  const { calls } = await mount();
  expect(document.body.textContent).toContain(longName);
  expect(document.body.textContent).toContain('""');
  expect(document.body.textContent).toContain("0");
  expect(document.body.textContent).toContain("false");
  expect(document.body.textContent).toContain("Null");
  expect(document.body.textContent).toContain("Empty list");
  expect(document.body.textContent).toContain("Empty record");
  expect(document.body.textContent).toContain('"München"');
  expect(document.querySelector("nav[aria-label='Run sections'] [aria-current='page']")?.textContent).toBe("Captured facts");

  await clickSection("Retained work");
  expect(document.body.textContent).toContain("Failed");
  expect(document.body.textContent).toContain(longName);
  await clickSection("Saved logs");
  expect(document.body.textContent).toContain(`Failure recorded for ${longName}.`);
  await clickSection("Old evidence");
  expect(document.body.textContent).toContain("These bytes were not retained.");
  await clickSection("Recorded version change");
  expect(document.body.textContent).toContain("Archived old workflow");
  expect(document.body.textContent).toContain("Synthetic operator");
  expect(document.body.textContent).toContain("Commit not captured");
  await clickSection("Retained files");
  expect(document.body.textContent).toContain("Bytes unavailable in this synthetic report.");
  const fileDetails = document.querySelector<HTMLButtonElement>('section[aria-label="Retained attachments"] button[aria-expanded]');
  expect(fileDetails).not.toBeNull();
  await act(async () => fileDetails!.click());
  expect(document.body.textContent).toContain("Artifact IDs");
  expect(document.body.textContent).toContain(report.files[0].artifactIds![0]);
  await clickSection("Record details");
  for (const value of [report.runId, report.transferId!, report.itemId!, "2", "Null", "failed", "verified", "4.1", "6.2", "adopted", "Absent", report.archiveFingerprint]) {
    expect(document.body.textContent).toContain(value);
  }
  await clickSection("All fields");
  expect(document.body.textContent).toContain("sections[0].values[1].value");
  expect(document.body.textContent).toContain("sections[0].values[2].value");
  expect(document.body.textContent).toContain("sections[0].values[3].value");
  expect(document.body.textContent).toContain("sections[0].values[4].value");
  expect(document.body.textContent).toContain("sections[0].values[5].value");
  expect(document.body.textContent).toContain("sections[0].values[6].value");
  expect(document.body.textContent).toContain("sections[0].values[7].value");
  const rawFields = document.querySelector('section[aria-label="All public retained fields"]')?.textContent ?? document.body.textContent;
  for (const raw of ["false", "null", "[]", "{}", "0"]) expect(rawFields).toContain(raw);
  expect(calls.savedArchiveFile).toHaveBeenCalledWith(report.runId, report.files[0].digest);
});

it("keeps All fields search explicit and restores focus after clearing no matches", async () => {
  await mount();
  await clickSection("All fields");
  const table = document.querySelector<HTMLTableElement>('table[aria-label="All public retained fields"]');
  expect([...table!.querySelectorAll("th")].map(cell => cell.textContent)).toEqual(["Field", "Saved value", "Type"]);
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Search all report fields"]');
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "no-such-retained-field"); input!.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(table?.textContent).toContain("No public fields match");
  const clear = [...table!.querySelectorAll("button")].find(button => button.textContent?.trim() === "Clear search");
  expect(clear).toBeDefined();
  await act(async () => clear!.click());
  expect(input?.value).toBe("");
  expect(document.activeElement).toBe(input);
  expect(table?.querySelectorAll("tbody tr").length).toBeGreaterThan(1);
});

it("discloses structured values with exact JSON and keeps public identifiers selectable", async () => {
  await mount();
  const summary = [...document.querySelectorAll("summary")].find(node => node.textContent?.startsWith("Record ·"));
  expect(summary).toBeDefined();
  await act(async () => summary!.click());
  expect(summary?.parentElement?.textContent).toContain('"city":"München"');
  await clickSection("Record details");
  const run = [...document.querySelectorAll("dt")].find(node => node.textContent === "Run ID")?.parentElement;
  expect(run?.textContent).toContain(report.runId);
  const copy = run?.querySelector<HTMLButtonElement>('button[aria-label="Copy Run ID"]');
  expect(copy).not.toBeNull();
  await act(async () => copy!.click());
  expect(run?.textContent).toContain("could not be copied");
});

it("resets a selected pane and field search when the saved run changes", async () => {
  const { rerender } = await mount();
  await clickSection("All fields");
  const { versionChange: _versionChange, ...withoutVersionChange } = report;
  const nextReport = SavedArchiveReportWireSchema.parse({ ...withoutVersionChange,
    runId: "00000000-0000-4000-8000-000000000086", sections: [], files: [] });
  await rerender(nextReport);
  expect(document.querySelector("nav[aria-label='Run sections'] [aria-current='page']")?.getAttribute("aria-label")).toBe("Retained files");
  expect(document.body.textContent).toContain("No attachment was retained with this report.");
  expect(document.body.textContent).not.toContain("All public retained fields");
});

it("announces a stale routed report section instead of silently selecting its default", () => {
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report, section: 999 }));
  expect(html).toContain("Saved report section is unavailable. Select a retained section.");
  expect(html).toContain('role="alert"');
  expect(html).toContain("Captured facts");
});
