import assert from "node:assert/strict";
import { SavedArchiveReportWireSchema } from "../../../../../src/models/dashboard/archive.js";
import { expect, it, vi } from "vitest";
import { H_REPORT } from "../../../../support/fixtures/dashboard/fixture-archive-report.js";
import { archiveCsvFields, archiveFieldRows } from "../../../../../src/models/dashboard/archive-export.js";
import { archiveExportBlob, assertArchiveExportSize, readWorkflowExport } from "../../../../../src/dashboard/surfaces/archive-export-model.js";
import type { SavedArchiveQuery } from "../../../../../src/models/dashboard/archive.js";
import { RunIdSchema } from "../../../../../src/rules/identity/ids.js";

const formats = ["json", "csv"] as const;
type Cursor = NonNullable<SavedArchiveQuery["after"]>;

const cursorOf = (report: Pick<typeof H_REPORT, "completedAt" | "runId">): Cursor => ({ completedAt: report.completedAt, runId: report.runId });

function pagedRead(reports: readonly typeof H_REPORT[]) {
  return vi.fn(async (query: { after?: Cursor; limit: number }) => {
    const start = query.after === undefined ? 0 : reports.findIndex(report => report.runId === query.after?.runId) + 1;
    const items = reports.slice(start, start + query.limit);
    const last = items.at(-1);
    return { items, next: start + items.length < reports.length && last !== undefined ? cursorOf(last) : null };
  });
}

it("preserves public JSON values and encodes typed CSV strings for spreadsheet use", async () => {
  const report = {
    ...H_REPORT,
    title: '=HYPERLINK("bad")',
    runNumber: null,
    sections: [
      { kind: "values" as const, title: "Saved", values: [
        { label: "Formula", value: "\t+SUM(1,2)" },
        { label: "Whitespace formula", value: "  =1" },
        { label: "Control formula", value: "\u0001=1" },
        { label: "At formula", value: "@SUM(A1)" },
        { label: "Minus text formula", value: "-1+2" },
        { label: "Empty text", value: "" },
        { label: "Quoted multiline Unicode", value: 'a,"b"\n雪' },
        { label: "Missing", value: null },
        { label: "Count", value: 0 },
        { label: "Negative count", value: -42 },
        { label: "Flag", value: false },
      ] },
      { kind: "text" as const, title: "Multiline", text: 'line one,\n"line two" 雪' },
    ],
    files: [],
  };
  const rows = archiveFieldRows([report]);
  const rowFor = (path: string) => rows.find(([, fieldPath]) => fieldPath === path);

  expect(rowFor("title")).toEqual([report.runId, "title", "string", report.title]);
  expect(rowFor("sections[0].values[0].value")).toEqual([report.runId, "sections[0].values[0].value", "string", "\t+SUM(1,2)"]);
  expect(rowFor("sections[0].values[5].value")).toEqual([report.runId, "sections[0].values[5].value", "string", ""]);
  expect(rowFor("sections[0].values[7].value")?.slice(2)).toEqual(["null", "null"]);
  expect(rowFor("sections[0].values[8].value")?.slice(2)).toEqual(["number", "0"]);
  expect(rowFor("sections[0].values[9].value")?.slice(2)).toEqual(["number", "-42"]);
  expect(rowFor("sections[0].values[10].value")?.slice(2)).toEqual(["boolean", "false"]);
  expect(rowFor("sections[1].text")?.slice(2)).toEqual(["string", 'line one,\n"line two" 雪']);
  expect(rowFor("runNumber")?.slice(2)).toEqual(["null", "null"]);
  expect(rowFor("transferId")).toBeUndefined();
  expect(rowFor("files")?.slice(2)).toEqual(["array", "[]"]);
  expect(rowFor("versionChange.change.commit.state")?.slice(2)).toEqual(["string", "absent"]);

  const csv = archiveCsvFields([report]);
  expect(csv).toContain('"title","string","\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"sections[0].values[0].value","string","\'\t+SUM(1,2)"');
  expect(csv).toContain('"sections[0].values[2].value","string","\'\u0001=1"');
  expect(csv).toContain('"sections[0].values[5].value","string",""');
  expect(csv).toContain('"sections[0].values[6].value","string","a,""b""\n雪"');
  expect(csv).toContain('"sections[0].values[9].value","number","-42"');
  expect(csv).toContain('"sections[1].text","string","line one,\n""line two"" 雪"');
  expect(csv).toContain("archiveFingerprint");
  expect(csv).not.toContain("sourceDigest");

  const json = await archiveExportBlob([report], "json").text();
  expect(JSON.parse(json)).toEqual(report);
  const second = { ...H_REPORT, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000098") };
  expect(JSON.parse(await archiveExportBlob([H_REPORT, second], "json").text())).toEqual([H_REPORT, second]);

  const emptyCollections = { ...H_REPORT, sections: [], files: [] };
  const emptyRows = archiveFieldRows([emptyCollections]);
  expect(emptyRows.find(([, path]) => path === "sections")?.slice(2)).toEqual(["array", "[]"]);
  expect(emptyRows.find(([, path]) => path === "files")?.slice(2)).toEqual(["array", "[]"]);
  expect(JSON.parse(await archiveExportBlob([emptyCollections], "json").text())).toMatchObject({ sections: [], files: [] });
});

it("rejects private report data at runtime on both export paths", () => {
  const sourceDigest = Object.defineProperty({ ...H_REPORT }, "sourceDigest", { value: "private-source-digest", enumerable: true });
  const sources = Object.defineProperty({ ...H_REPORT }, "sources", { value: [{ json: "private source snapshot" }], enumerable: true });
  const sealedDigest = Object.defineProperty({ ...H_REPORT }, "digest", { value: "sealed-report-digest", enumerable: true });
  const publicVersionChange = H_REPORT.versionChange;
  if (publicVersionChange === undefined) throw new Error("Fixture must carry the public version-change projection.");
  const members = Object.defineProperty({ ...publicVersionChange }, "members", {
    value: [{ runId: H_REPORT.runId, version: 1, sourceDigest: "private-member-digest" }], enumerable: true,
  });
  const memberDigests = { ...H_REPORT, versionChange: members };

  for (const report of [sourceDigest, sources, sealedDigest, memberDigests]) {
    for (const format of formats) {
      expect(() => archiveExportBlob([report], format)).toThrow();
    }
  }
});

it("walks all pages in order, binds workflow membership and permits cancellation", async () => {
  const second = { ...H_REPORT, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000099") };
  const read = vi.fn(async (query: { after?: { runId: string } }) => query.after === undefined
    ? { items: [H_REPORT], next: { completedAt: H_REPORT.completedAt, runId: H_REPORT.runId } }
    : { items: [second], next: null });
  const progress: number[] = [];
  const records = await readWorkflowExport(read, { workflow: H_REPORT.workflow, versionState: "unrecorded" }, new AbortController().signal, "json", count => progress.push(count));
  expect(records.map(record => record.runId)).toEqual([H_REPORT.runId, second.runId]);
  expect(progress).toEqual([1, 2]);
  expect(read).toHaveBeenCalledTimes(2);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(readWorkflowExport(read, { workflow: H_REPORT.workflow }, cancelled.signal, "json", () => undefined)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(2);
});

it("cancels after a completed page and never returns a partial selection", async () => {
  const second = { ...H_REPORT, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000099") };
  const read = vi.fn()
    .mockResolvedValueOnce({ items: [H_REPORT], next: cursorOf(H_REPORT) })
    .mockResolvedValueOnce({ items: [second], next: null });
  const controller = new AbortController();
  const progress: number[] = [];

  await expect(readWorkflowExport(read, { workflow: H_REPORT.workflow }, controller.signal, "json", count => {
    progress.push(count);
    if (count === 1) controller.abort();
  })).rejects.toThrow();
  expect(progress).toEqual([1]);
  expect(read).toHaveBeenCalledTimes(1);
});

it("rejects a selection that changes while a later page is delayed", async () => {
  const second = { ...H_REPORT, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000099") };
  let resolveDelayed!: (page: { items: typeof H_REPORT[]; next: Cursor | null }) => void;
  const read = vi.fn((query: { after?: Cursor }) => query.after === undefined
    ? Promise.resolve({ items: [H_REPORT], next: cursorOf(H_REPORT) })
    : new Promise<{ items: typeof H_REPORT[]; next: Cursor | null }>(resolve => { resolveDelayed = resolve; }));
  let selectionIsCurrent = true;
  const pending = readWorkflowExport(read, { workflow: H_REPORT.workflow }, new AbortController().signal,
    "json", () => undefined, () => selectionIsCurrent);

  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  selectionIsCurrent = false;
  resolveDelayed({ items: [second], next: null });
  await expect(pending).rejects.toThrow("selection changed");
});

it("rejects repeated and cyclic cursors even when later pages contain distinct reports", async () => {
  const second = { ...H_REPORT, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000099") };
  const third = { ...H_REPORT, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000100") };
  const read = vi.fn((query: { after?: Cursor }) => {
    if (query.after === undefined) return Promise.resolve({ items: [H_REPORT], next: cursorOf(H_REPORT) });
    if (query.after.runId === H_REPORT.runId) return Promise.resolve({ items: [second], next: cursorOf(second) });
    return Promise.resolve({ items: [third], next: cursorOf(H_REPORT) });
  });

  await expect(readWorkflowExport(read, { workflow: H_REPORT.workflow }, new AbortController().signal,
    "json", () => undefined)).rejects.toThrow("cursor repeated");
  expect(read).toHaveBeenCalledTimes(3);
});

it("propagates a later page failure without returning the first page", async () => {
  const read = vi.fn()
    .mockResolvedValueOnce({ items: [H_REPORT], next: cursorOf(H_REPORT) })
    .mockRejectedValueOnce(new Error("Archive index unavailable"));
  const progress: number[] = [];

  await expect(readWorkflowExport(read, { workflow: H_REPORT.workflow }, new AbortController().signal,
    "json", count => progress.push(count))).rejects.toThrow("Archive index unavailable");
  expect(progress).toEqual([1]);
  expect(read).toHaveBeenCalledTimes(2);
});

it("binds every requested workflow and runtime-version identity", async () => {
  const stamped = { ...H_REPORT, runtimeVersion: { state: "stamped" as const,
    dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 2 } } };
  const read = vi.fn(async () => ({ items: [stamped], next: null }));

  await expect(readWorkflowExport(read, { workflow: H_REPORT.workflow, dashboardVersion: { major: 1, minor: 0 },
    workflowVersion: { major: 1, minor: 3 }, versionState: "stamped" }, new AbortController().signal,
  "json", () => undefined)).rejects.toThrow("workflow version mismatch");
  await expect(readWorkflowExport(read, { workflow: H_REPORT.workflow, dashboardVersion: { major: 1, minor: 0 },
    workflowVersion: { major: 1, minor: 2 }, versionState: "adopted" }, new AbortController().signal,
  "json", () => undefined)).rejects.toThrow("version state mismatch");
});

it("accepts exactly 5,000 reports and refuses the next matching report", async () => {
  const reports = Array.from({ length: 5_001 }, (_, index) => ({ ...H_REPORT,
    runId: RunIdSchema.parse(`00000000-0000-4000-8000-${(1_000 + index).toString(16).padStart(12, "0")}`) }));
  const exactRead = pagedRead(reports.slice(0, 5_000));
  const exact = await readWorkflowExport(exactRead, { workflow: H_REPORT.workflow }, new AbortController().signal, "json", () => undefined);
  expect(exact).toHaveLength(5_000);
  expect(exactRead).toHaveBeenCalledTimes(50);

  const overRead = pagedRead(reports);
  await expect(readWorkflowExport(overRead, { workflow: H_REPORT.workflow }, new AbortController().signal,
    "json", () => undefined)).rejects.toThrow("exceeds 5,000 reports");
  expect(overRead).toHaveBeenCalledTimes(51);
});

it("measures final UTF-8 JSON and CSV blobs at the inclusive 50 MB limit", async () => {
  assertArchiveExportSize(50_000_000);
  expect(() => assertArchiveExportSize(50_000_001)).toThrow("exceeds 50 MB");

  const seedTitle = 'Δ, "quoted"\ntext';
  for (const format of formats) {
    const seedReport = { ...H_REPORT, title: seedTitle };
    const seedSize = archiveExportBlob([seedReport], format).size;
    const exactReport = { ...seedReport, title: seedTitle + "x".repeat(50_000_000 - seedSize) };
    expect(archiveExportBlob([exactReport], format).size).toBe(50_000_000);
    const exactRead = vi.fn(async () => ({ items: [exactReport], next: null }));
    await expect(readWorkflowExport(exactRead, { workflow: H_REPORT.workflow }, new AbortController().signal,
      format, () => undefined)).resolves.toHaveLength(1);
    const oneOver = { ...exactReport, title: exactReport.title + "x" };
    expect(() => archiveExportBlob([oneOver], format)).toThrow("exceeds 50 MB");
    const overRead = vi.fn(async () => ({ items: [oneOver], next: null }));
    await expect(readWorkflowExport(overRead, { workflow: H_REPORT.workflow }, new AbortController().signal,
      format, () => undefined)).rejects.toThrow("exceeds 50 MB");
    if (format === "json") {
      const csvRead = vi.fn(async () => ({ items: [exactReport], next: null }));
      await expect(readWorkflowExport(csvRead, { workflow: H_REPORT.workflow }, new AbortController().signal,
        "csv", () => undefined)).rejects.toThrow("exceeds 50 MB");
    }
  }
});

it("encodes special object members reversibly without structural field-path collisions", () => {
  const special = { "a.b": 1, a: { b: 2 }, "x[0]": 3, x: [4], 'q"uote': 5, "back\\slash": 6, "": 7, "0": 8 };
  const report = SavedArchiveReportWireSchema.parse({ ...H_REPORT,
    sections: [{ kind: "values", title: "Special keys", values: [{ label: "Object", value: special }] }] });
  const prefix = "sections[0].values[0].value";
  const rows = archiveFieldRows([report]).filter(([, path]) => path.startsWith(prefix));
  assert.equal(new Set(rows.map(([, path]) => path)).size, 8);
  const actual = new Map(rows.map(([, path, , value]) => [path, value]));
  for (const [path, expected] of [[`${prefix}["a.b"]`, "1"], [`${prefix}.a.b`, "2"],
    [`${prefix}["x[0]"]`, "3"], [`${prefix}.x[0]`, "4"],
    [`${prefix}[${JSON.stringify('q"uote')}]`, "5"], [`${prefix}[${JSON.stringify("back\\slash")}]`, "6"],
    [`${prefix}[""]`, "7"], [`${prefix}["0"]`, "8"]]) assert.equal(actual.get(path), expected);
  assert.ok(archiveCsvFields([report]).includes('sections[0].values[0].value.a.b'));
  for (const [, path, type, value] of rows) {
    const tokens = [...path.matchAll(/(?:^|\.)([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+|"(?:\\.|[^"\\])*")\]/gu)];
    assert.equal(tokens.map(token => token[0]).join(""), path);
    let resolved: unknown = report;
    for (const token of tokens) {
      const key: string | number = token[1] ?? JSON.parse(token[2]);
      assert.ok(resolved !== null && typeof resolved === "object");
      resolved = Reflect.get(resolved, key);
    }
    assert.equal(type, "number");
    assert.equal(String(resolved), value);
  }
});
