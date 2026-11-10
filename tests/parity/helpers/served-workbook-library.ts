import type { Page } from "@playwright/test";
import { harness } from "../../support/helpers/backend/http-route-harness.js";

/** The fixture BFF serves no workbook library: answer /api/v1/workbooks from the real route harness, seeded with a Roster type and the named workbooks. Pair with disposeHttpRouteHarness. */
export async function serveWorkbookLibrary(page: Page, names: readonly string[]): Promise<void> {
  const h = await harness();
  const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
  const post = async (path: string, body: unknown) => {
    const response = await h.app.request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (response.status >= 300) throw new Error(`workbook library seed ${path} failed: ${response.status}`);
  };
  await post("/api/v1/workbooks/types", { id: "roster", name: "Roster", keyFieldId: "email", fields: ["email", "fullName"], defaultWorkbookId: null });
  for (const name of names) {
    await post("/api/v1/workbooks", { workbook: { name, hasFormulas: false, themes: [], sheets: [{ id: "people", name: "July 6", width: 2, hidden: [], headerRow: 1,
      columnBindings: ["email", "fullName"].map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
      rows: [["email", "fullName"], ["example@example.edu", "Example, Person"]].map((cells, index) => ({ id: `row-${index}`, cells: cells.map(value => ({ value })) })) }] } });
  }
  await page.route("**/api/v1/workbooks**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const response = await h.app.request(`http://localhost${path}`, { method: request.method(), headers, ...(request.postData() ? { body: request.postData()! } : {}) });
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
}
