import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { encodeEditableWorkbook, decodeSavedWorkbook } from "../../../../../src/models/dashboard/workbooks.js";
import { disposeHttpRouteHarness, foreignOriginCases, harness } from "../../../../support/helpers/backend/http-route-harness.js";

afterEach(disposeHttpRouteHarness);
const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const workbook = { name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };
it("serves create/list/open/save/conflict/history with exact Date transport and durable CAS", async () => {
  const h = harness();
  const created = await h.app.request("http://localhost/api/v1/workbooks", { method: "POST", headers, body: JSON.stringify({ workbook: encodeEditableWorkbook(workbook) }) });
  assert.equal(created.status, 201);
  const first = decodeSavedWorkbook(await created.json());
  const path = `http://localhost/api/v1/workbooks/${first.libraryId}`;
  const list = await h.app.request("http://localhost/api/v1/workbooks/list");
  assert.equal(list.status, 200); assert.equal((await list.json() as unknown[]).length, 1);
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(path)).json()), first);
  const save = await h.app.request(`${path}/save`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1, workbook: encodeEditableWorkbook({ ...first.workbook, name: "Saved.xlsx" }) }) });
  assert.equal(save.status, 200); const second = decodeSavedWorkbook(await save.json());
  const conflict = await h.app.request(`${path}/save`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1, workbook: encodeEditableWorkbook(first.workbook) }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json() as { code: string }).code, "WORKBOOK_VERSION_CONFLICT");
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(path)).json()), second);
  assert.deepEqual((await (await h.app.request(`${path}/history`)).json() as unknown[]).map(decodeSavedWorkbook), [first, second]);
});
it.each(["/api/v1/workbooks", "/api/v1/workbooks/id/save", "/api/v1/workbooks/id/intake"])("requires JSON before effects for %s", async path => {
  const h = harness(), generation = h.database.getMeta().authorityGeneration;
  const response = await h.app.request(`http://localhost${path}`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: "{}" });
  assert.equal(response.status, 415); assert.equal(h.database.getMeta().authorityGeneration, generation);
});
it.each(foreignOriginCases())("rejects foreign workbook mutation %s before reading the body", async (_label, originHeaders) => {
  const h = harness();
  for (const path of ["/api/v1/workbooks", "/api/v1/workbooks/id/save", "/api/v1/workbooks/id/intake"]) {
    const request = new Request(`http://localhost${path}`, { method: "POST", headers: { ...originHeaders, "content-type": "application/json" }, body: "{}" });
    const read = vi.spyOn(request, "json");
    assert.equal((await h.app.request(request)).status, 403); assert.equal(request.bodyUsed, false); assert.equal(read.mock.calls.length, 0);
  }
});

it("refuses malformed workbook dates and dimensions with WORKBOOK_INVALID before library effects", async () => {
  const h = harness();
  const wire = encodeEditableWorkbook(workbook);
  for (const malformed of [
    { ...wire, sheets: [{ ...wire.sheets[0], width: 2 }] },
    { ...wire, sheets: [{ ...wire.sheets[0], rows: [{ id: "row", cells: [{ value: { type: "date", value: "invalid" } }] }] }] },
  ]) {
    const response = await h.app.request("http://localhost/api/v1/workbooks", { method: "POST", headers, body: JSON.stringify({ workbook: malformed }) });
    assert.equal(response.status, 400); assert.equal((await response.json() as { code: string }).code, "WORKBOOK_INVALID");
    assert.deepEqual(h.database.authority.workbooks.list(), []);
  }
});
