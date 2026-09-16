import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
import { savedFilterQuery } from "../../../src/dashboard/surfaces/archive-report-model.js";
it("renders retained document with no provider, descriptors, live records, or files", () => {
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report: { ...H_REPORT, files: [] } }));
  expect(html).toContain("retired-v7"); expect(html).toContain("Captured approval"); expect(html).toContain("No attachment was retained");
  expect(html).not.toContain("<button"); expect(html.match(/<a /gu)).toHaveLength(1);
  expect(html).toContain(`download="archive-${H_REPORT.runId}.json"`);
});
it.each(["workflow", "title", "descriptorVersion", "outcome", "from", "to", "capturedFrom", "capturedTo"] as const)("resets cursor for %s while preserving other query facts", key => {
  const query = { limit: 50, title: "Exact title", after: { completedAt: H_REPORT.completedAt, runId: H_REPORT.runId } };
  expect(savedFilterQuery(query, key, "value")).toEqual({ limit: 50, title: "Exact title", [key]: "value" });
  expect(savedFilterQuery(query, key, "")).not.toHaveProperty(key);
  expect(query).toHaveProperty("after");
});
