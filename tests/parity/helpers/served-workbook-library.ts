import type { Page } from "@playwright/test";
import { emergencyContactWorkflow } from "../../../src/workflows/emergency-contact/workflow.js";
import { harness } from "../../support/helpers/backend/http-route-harness.js";

/** The fixture BFF serves no workbook library: answer /api/v1/workbooks from the real route harness, seeded with a Roster type and the named workbooks. Pair with disposeHttpRouteHarness. */
export async function serveWorkbookLibrary(page: Page, names: readonly string[], options: { readonly requiredFields?: boolean } = {}): Promise<void> {
  const h = await harness(options.requiredFields ? { workbookWorkflows: [emergencyContactWorkflow] } : {});
  const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
  const post = async (path: string, body: unknown) => {
    const response = await h.app.request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (response.status >= 300) throw new Error(`workbook library seed ${path} failed: ${response.status} ${await response.text()}`);
  };
  const rich = options.requiredFields === true;
  const fields = rich ? ["eid", "fullName"] : ["email", "fullName"], columns = rich ? ["Employee ID", "Full name", "Work email"] : ["email", "fullName"];
  const people = rich ? Array.from({ length: 14 }, (_, i) => [`${10000006 + i * 13}`, `Example, Person ${String.fromCharCode(65 + i)}`, `person${i}@example.org`]) : [["example@example.edu", "Example, Person"]];
  await post("/api/v1/workbooks/types", { id: rich ? "ocr-roster" : "roster", name: "Roster", keyFieldId: fields[0], fields, defaultWorkbookId: null });
  for (const name of names) {
    await post("/api/v1/workbooks", { workbook: { name, hasFormulas: false, themes: [], sheets: [{ id: "people", name: rich ? "Roster" : "July 6", width: columns.length, hidden: [], headerRow: 1,
      columnBindings: columns.map((header, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: header, fieldId: fields[index] ?? null, basis: fields[index] ? "manual" : "unmapped" })),
      rows: [columns, ...people].map((cells, index) => ({ id: `row-${index}`, cells: cells.map(value => ({ value })) })) }] } });
    h.clock.advanceWall(1000); // distinct creation times keep the library order stable
  }
  await page.route("**/api/v1/workbooks**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const response = await h.app.request(`http://localhost${path}`, { method: request.method(), headers, ...(request.postData() ? { body: request.postData()! } : {}) });
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
}
