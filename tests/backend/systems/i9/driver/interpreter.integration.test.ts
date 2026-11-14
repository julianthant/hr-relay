import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createI9Driver } from "../../../../../src/backend/systems/i9/driver/interpreter.js";
import { I9_APP_ORIGIN } from "../../../../../src/backend/systems/i9/driver/ui-registry.js";

type Scenario = "empty" | "rows" | "restricted";

// Search dialog structure recorded by the read-only live probe (onboarding-served-switch-04, update 3006);
// the closed change-password inputs present on every I-9 page by onboarding-served-switch-05, updates 3477 and 3561.
const RESULTS: Record<Scenario, string> = {
  empty: "<h2>No results found. Search again or click Create New Profile to create a new employee.</h2>",
  restricted: "<h2>No results found. Search again or click Create New Profile to create a new employee.</h2>",
  rows: `<table role="grid"><thead><tr role="row">${["Last Name", "First Name", "Employer", "Worksite Name", "Employee Profile ID", "I-9 ID", "Next Action", "Start Date", "Created On"].map(name => `<th role="columnheader">${name}</th>`).join("")}</tr></thead></table>
    <table role="grid"><tbody><tr role="row">${["Example", "Person", "Example Employer", "Example Worksite", "900001", "900002", "Purge", "01/01/2030", "01/01/2030"].map(cell => `<td role="gridcell">${cell}</td>`).join("")}</tr></tbody></table>`,
};

function i9App(scenario: Scenario): string {
  return `<!doctype html><style>.hidden{display:none}</style>
<table role="grid"><tbody><tr role="row"><td role="gridcell">Dashboard</td></tr></tbody></table>
<div id="divSearchOptions">Search Options</div>
<div class="hidden"><input type="password" id="OldPassword"><input type="password" id="WebPassword"><input type="password" id="ConfirmWebPassword"></div>
<div id="dialog" role="dialog" aria-label="Search for Existing Employee" class="hidden">
  <h3>Search Filter</h3>
  <table><tbody><tr><td>
    <label for="ln">Last Name</label><input id="ln">
    <label for="fn">First Name</label><input id="fn">
    <label for="ssn">Social Security Number</label><input id="ssn">
  </td></tr></tbody></table>
  <a href="#" id="clear">Clear Search Filters &amp; Results</a>
  <button type="button" id="search">Search</button>
  <h3>Search Results By default, the application will perform an exact match search</h3>
  <div id="alert" class="search-employee-alert hidden errors-container">ALERT: Additional records matched your search criteria but your user account has not been granted access to view those employees.</div>
  <div class="errors-container hidden">ALERT: Only the top 40 results were returned.</div>
  <h2 class="hidden">Sorry, no results found</h2>
  <div id="results"></div>
</div>
<script>
  const results = document.getElementById("results"), alert = document.getElementById("alert");
  document.getElementById("divSearchOptions").onclick = () => document.getElementById("dialog").classList.remove("hidden");
  document.getElementById("clear").onclick = event => { event.preventDefault(); results.innerHTML = ""; alert.classList.add("hidden"); };
  document.getElementById("search").onclick = () => {
    results.innerHTML = ${JSON.stringify(RESULTS[scenario])};
    if (${JSON.stringify(scenario)} === "restricted") alert.classList.remove("hidden");
  };
</script>`;
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function withI9App(scenario: Scenario, check: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  try {
    await context.route(`${I9_APP_ORIGIN}/**`, route => route.fulfill({ contentType: "text/html", body: i9App(scenario) }));
    const page = await context.newPage();
    await page.goto(I9_APP_ORIGIN);
    await check(page);
  } finally {
    await context.close();
  }
}

const input = { lastName: "Example", firstName: "Person", ssn: "123456789" };

describe("I-9 search dialog as rendered by I-9 Complete", () => {
  it("settles a zero-result search on the visible empty-state heading and reports not found", async () => {
    await withI9App("empty", async page => {
      const driver = createI9Driver(() => undefined, page);
      assert.deepEqual(await driver.searchEmployees(input), { rows: [], restricted: false });
      assert.deepEqual(await driver.readSection2Signer(input), { i9Status: "not-found", signerName: "" });
    });
  });

  it("reports unable to access only when the restricted-access alert is shown", async () => {
    await withI9App("restricted", async page => {
      assert.deepEqual(await createI9Driver(() => undefined, page).readSection2Signer(input), { i9Status: "unable-to-access", signerName: "" });
    });
  });

  it("parses result rows of nine grid cells", async () => {
    await withI9App("rows", async page => {
      assert.deepEqual(await createI9Driver(() => undefined, page).searchEmployees({ lastName: "Example" }), {
        restricted: false,
        rows: [{ lastName: "Example", firstName: "Person", employer: "Example Employer", worksite: "Example Worksite",
          profileId: "900001", i9Id: "900002", nextAction: "Purge", startDate: "01/01/2030", createdOn: "01/01/2030" }],
      });
    });
  });
});
