// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
import { savedFilterQuery } from "../../../src/dashboard/surfaces/archive-report-model.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); dispose = undefined; document.body.replaceChildren(); });
async function clickSection(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("nav[aria-label='Run sections'] button")].find(row => (row.getAttribute("aria-label") ?? row.textContent?.trim()) === label);
  if (button === undefined) throw new Error(`Missing report section ${label}.`);
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
it("renders saved facts without provider, live descriptors, records, or execution doors", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  const unsafe = "<script>unsafe()</script>";
  const sections = H_REPORT.sections.map((section, index) => index !== 0 || section.kind !== "values" ? section : { ...section, values: [...section.values, { label: "Literal text", value: unsafe }] });
  await act(async () => root.render(createElement(SavedArchiveReport, { report: { ...H_REPORT, sections, files: [] } })));
  expect(host.textContent).toContain("Synthetic subject");
  expect(host.textContent).toContain(unsafe);
  expect(host.textContent).toContain("Not recorded");
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector("nav[aria-label='Run sections']")?.textContent).not.toContain("Outputs");
  expect(H_REPORT.sections.find(section => section.title === "Retained work")).toBeDefined();
  expect(host.querySelector("script")).toBeNull();
  await clickSection("Logs");
  expect(host.textContent).not.toContain("No live resolution is available.");
  expect(host.querySelector("script")).toBeNull();
  await clickSection("Retained files");
  expect(host.textContent).toContain("No attachment was retained");
  expect(host.textContent).not.toMatch(/Relaunch|Restart|Retry/);
  expect(host.querySelector("article")?.textContent).not.toContain("Export report");
  expect(host.querySelectorAll("a")).toHaveLength(0);
});
it.each(["workflow", "title", "descriptorVersion", "outcome", "from", "to", "capturedFrom", "capturedTo"] as const)("resets cursor for %s while preserving other query facts", key => {
  const query = { limit: 50, title: "Exact title", after: { completedAt: H_REPORT.completedAt, runId: H_REPORT.runId } };
  expect(savedFilterQuery(query, key, "value")).toEqual({ limit: 50, title: "Exact title", [key]: "value" });
  expect(savedFilterQuery(query, key, "")).not.toHaveProperty(key);
  expect(query).toHaveProperty("after");
});
