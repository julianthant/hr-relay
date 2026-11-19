import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it } from "vitest";
import { searchCrmOnboardingOfferRows } from "../../../../../src/backend/systems/crm/driver/hire-operation.js";

it("reads offer rows that render after the CRM search heading", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const origin = "https://act-crm.my.site.com";
    const recordPath = "/hr/ONB_ViewOnboarding?id=fixture-offer";
    await page.route("**/*", route => {
      if (route.request().url() !== `${origin}/hr/ONB_SearchOnboardings?q=hire%40example.test`) return route.abort();
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><h1>Search Results</h1>
        <table><tbody id="results"></tbody></table>
        <script>setTimeout(() => document.getElementById("results").insertAdjacentHTML("beforeend",
          '<tr><td><a href="${recordPath}">Fixture Hire</a></td><td>08/01/2026</td><td></td><td></td><td>Campus Forms Pending</td></tr>'), 750);</script>` });
    });

    const offers = await searchCrmOnboardingOfferRows(() => undefined, page, "hire@example.test");
    assert.deepEqual(offers, [{ recordId: "fixture-offer", recordUrl: `${origin}${recordPath}`,
      offerSentOn: "08/01/2026", processStage: "Campus Forms Pending" }]);
  } finally {
    await browser.close();
  }
}, 45_000);
