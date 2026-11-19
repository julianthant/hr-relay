import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it } from "vitest";
import { createCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/interpreter.js";

const origin = "https://act-crm.my.site.com";
const recordPath = "/hr/ONB_ViewOnboarding?id=fixture-record";

it("discovers the displayed employee when the CRM search row follows the heading", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.href === `${origin}/hr/ONB_SearchOnboardings?q=10000001`) {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><h1>Search Results</h1>
          <table><tbody id="results"><tr><td>Search</td><td>Controls</td></tr></tbody></table>
          <script>setTimeout(() => document.getElementById("results").insertAdjacentHTML("beforeend",
            '<tr><td><a href="${recordPath}">Fixture, Person</a></td><td>08/01/2026</td><td></td><td></td><td>Completed</td></tr>'), 750);</script>` });
      } else if (url.href === `${origin}${recordPath}`) {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><table><tbody>
          <tr><th>UCPath Employee ID</th><td>10000001</td></tr>
          <tr><th>Employee First Name</th><td>Person</td></tr><tr><th>Employee Last Name</th><td>Fixture</td></tr>
          <tr><th>First Day of Service (Effective Date)</th><td>08/01/2026</td></tr>
          <tr><th>Department</th><td>Example</td></tr><tr><th>Date Signed</th><td></td></tr>
          </tbody></table>` });
      } else {
        await route.abort();
      }
    });

    const driver = createCrmOnboardingDriver(() => undefined, page);
    const found = await driver.searchOnboardingRecords({ eid: "10000001" });
    assert.deepEqual(found, [{ recordId: "fixture-record", recordUrl: `${origin}${recordPath}`, emplId: "10000001",
      name: "Fixture, Person", department: "Example", firstDayOfService: "08/01/2026", dateSigned: "" }]);
  } finally {
    await browser.close();
  }
}, 45_000);
