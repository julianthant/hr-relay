// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { DashboardClientError, networkError, schemaError } from "../../../../src/dashboard/client/errors.js";
import { SETTINGS_READ_DEADLINE_MS } from "../../../../src/dashboard/client/read-deadline.js";
import { WorkbookLibraryVersionSchema, WorkbookLibraryVersionViewSchema } from "../../../../src/models/dashboard/workbook-library.js";
import { useWorkbookRows } from "../../../../src/dashboard/surfaces/run-start/run-workbook-rows-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const version = (id: string) => WorkbookLibraryVersionSchema.parse({ id, name: id, version: 1, snapshotId: id, savedAt: "2026-11-01T00:00:00Z", source: "operator" });
const first = version("first"), second = version("second"), authority = {};
const view = (id: string, rows: string[] = [id]) => WorkbookLibraryVersionViewSchema.parse({ libraryId: "library", version: version(id), workbook: {
  name: "Rows", libraryId: "library", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Sheet", width: 1, hidden: [],
    columnBindings: [{ id: "column", fieldId: "email", sourceColumn: 0, sourceHeader: "Email", basis: "manual" }],
    rows: [{ id: "header", cells: [{ value: "Email" }] }, ...rows.map(id => ({ id, cells: [{ value: `${id}@example.test` }] }))],
  }],
} });
let root: Root | undefined;
let observed: ReturnType<typeof useWorkbookRows> | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; observed = undefined; document.body.replaceChildren(); vi.useRealTimers(); });
type Props = { client: Parameters<typeof useWorkbookRows>[0]; identity?: string; authority?: object; ready?: boolean; version?: typeof first };
function Probe(props: Props) {
  observed = useWorkbookRows(props.client, props.identity ?? "workflow/catalog-revision-1/library", props.authority ?? authority, true, props.ready ?? true, "library", props.version ?? first, "email", "sheet");
  return null;
}
async function render(props: Props) {
  if (root === undefined) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(createElement(Probe, props)));
}
function deferred() {
  let resolve!: (value: ReturnType<typeof view>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof view>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("rejects late named-version responses and keeps the latest row authority", async () => {
  const old = deferred(), latest = deferred();
  const client = { workbookLibraryVersion: (_library: string, id: string) => id === "first" ? old.promise : latest.promise };
  await render({ client }); expect(observed?.state).toBe("loading");
  await render({ client, version: second });
  await act(async () => latest.resolve(view("second")));
  expect(observed?.state).toBe("ready"); expect(observed?.choices.map(row => row.rowId)).toEqual(["second"]);
  const held = observed?.authority;
  await act(async () => old.resolve(view("first")));
  expect(observed?.authority).toBe(held); expect(observed?.choices.map(row => row.rowId)).toEqual(["second"]);
});

it("retains displayed rows stale during catalog refresh and publishes an explicit verified empty version", async () => {
  let rows = ["saved"];
  const client = { workbookLibraryVersion: async () => view("first", rows) };
  await render({ client }); expect(observed?.state).toBe("ready");
  const held = observed?.authority;
  await render({ client, ready: false }); expect(observed?.state).toBe("stale"); expect(observed?.choices).toHaveLength(1); expect(observed?.authority).not.toBe(held);
  rows = [];
  await render({ client, identity: "workflow/catalog-revision-2/library" });
  expect(observed?.state).toBe("ready"); expect(observed?.choices).toEqual([]);
});

it("invalidates profile/client authority and does not publish its late errors", async () => {
  const old = deferred();
  const previous = { workbookLibraryVersion: () => old.promise };
  await render({ client: previous });
  const next = { workbookLibraryVersion: async () => view("first", ["new-profile"]) };
  await render({ client: next, authority: {} }); expect(observed?.choices.map(row => row.rowId)).toEqual(["new-profile"]);
  await act(async () => old.reject(new Error("old-profile-error")));
  expect(observed?.state).toBe("ready"); expect(observed?.error).toBeNull();
});

it("shows current read errors with retained disabled rows and refuses mismatched version metadata", async () => {
  let fail = false;
  const client = { workbookLibraryVersion: async () => { if (fail) throw new Error("Saved version read failed"); return view("first"); } };
  await render({ client }); fail = true;
  await render({ client, identity: "workflow/catalog-revision-2/library" });
  expect(observed?.state).toBe("error"); expect(observed?.error).toBe(ERROR_CATALOG.DASHBOARD_READ_FAILED.text); expect(observed?.choices).toHaveLength(1);
  await render({ client: { workbookLibraryVersion: async () => view("second") } });
  expect(observed?.state).toBe("error"); expect(observed?.error).toBe("The supplied data does not match the expected contract.");
});

it.each([
  { kind: "untyped", failure: new Error("GET /api/v1/workbooks/private-roster/versions/private-version Failed to fetch") },
  { kind: "typed network", failure: networkError("GET /api/v1/workbooks/private-roster/versions/private-version", new Error("Failed to fetch")) },
])("shows catalog read failure text without raw transport routes for $kind", async ({ failure }) => {
  await render({ client: { workbookLibraryVersion: async () => { throw failure; } } });
  expect(observed?.state).toBe("error");
  expect(observed?.error).toBe(ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
  expect(observed?.error).not.toMatch(/GET|\/api\/|private-roster|private-version|Failed to fetch/u);
});

it("retains a typed provider refusal's registered catalog sentence without its transport message", async () => {
  await render({ client: { workbookLibraryVersion: async () => { throw new DashboardClientError({ kind: "http", status: 404, code: "WORKBOOK_NOT_FOUND", message: "GET /api/v1/workbooks/private-roster failed" }); } } });
  expect(observed?.state).toBe("error"); expect(observed?.error).toBe(ERROR_CATALOG.WORKBOOK_NOT_FOUND.text);
});

it("keeps malformed typed responses classified as boundary failures", async () => {
  await render({ client: { workbookLibraryVersion: async () => { throw schemaError("GET /api/v1/workbooks/private-roster", new Error("private-version schema mismatch")); } } });
  expect(observed?.state).toBe("error"); expect(observed?.error).toBe(ERROR_CATALOG.BOUNDARY_VALIDATION_FAILED.text);
});

it("uses the same public read failure when the unchanged read deadline expires", async () => {
  vi.useFakeTimers();
  const pending = deferred();
  await render({ client: { workbookLibraryVersion: () => pending.promise } });
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTINGS_READ_DEADLINE_MS); });
  expect(observed?.state).toBe("error"); expect(observed?.error).toBe(ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
});
