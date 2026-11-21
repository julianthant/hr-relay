import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createI9Driver } from "../../../../../src/backend/systems/i9/driver/interpreter.js";
import { I9_APP_ORIGIN } from "../../../../../src/backend/systems/i9/driver/ui-registry.js";
import { I9LookupError } from "../../../../../src/models/systems/i9/read-section2-signer.js";
import { I9_PROFILE_EXAMPLE } from "../../../../../src/models/ui/i9-creation.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";

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
    <label for="profile-id">Profile ID</label><input id="profile-id">
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

async function withI9App(scenario: Scenario, check: (page: Page) => Promise<void>, pages: Readonly<Record<string, string>> = {}): Promise<void> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== I9_APP_ORIGIN || request.method() !== "GET") return route.abort("blockedbyclient");
      const body = url.pathname === "/" ? i9App(scenario) : Object.hasOwn(pages, url.pathname) ? pages[url.pathname] : undefined;
      return body === undefined ? route.abort("blockedbyclient") : route.fulfill({ contentType: "text/html", body });
    });
    const page = await context.newPage();
    await page.goto(I9_APP_ORIGIN);
    await check(page);
  } finally {
    await context.close();
  }
}

const input = { lastName: "Example", firstName: "Person", ssn: "123456789" };

it("aborts navigation outside the I-9 fixture routes", async () => {
  await withI9App("empty", async page => {
    await assert.rejects(page.goto(`${I9_APP_ORIGIN}/unmatched-fixture-path`), /net::ERR_BLOCKED_BY_CLIENT/u);
  });
});

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

const record = { profileId: "900001", i9Id: "900002" };
const summaryRoute = `/form-I9/summary/${record.profileId}/${record.i9Id}`;
const profileRoute = `/employee/profile/${record.profileId}`;
const remoteTarget = { ...I9_PROFILE_EXAMPLE, firstName: "Person", lastName: "Example",
  expectedName: "Person Example", profileId: record.profileId, startDate: "01/01/2030" };
const profile = `<!doctype html>
<input aria-label="First Name (Given Name)*" value="Person">
<input aria-label="Last Name (Family Name)*" value="Example">
<input aria-label="Middle Name" value="">
<input aria-label="Date of Birth" value="01/14/2000">
<input aria-label="Employee's Email Address" value="hire@example.test">
<select aria-label="Worksite *" size="2"><option selected>6-000412 Example Worksite</option></select>
<label><input type="radio">Remote - Section 1 Only</label>
<input aria-label="Start Date*">
<button onclick="this.dataset.clicked = 'true'; document.querySelector('.ErrorMessage').hidden = false">Create I-9</button>
<div class="ErrorMessage" hidden>Fixture submit error</div>`;

function recordSummary(rows: string): string {
  return `<!doctype html>
<h1>I-9 Record Summary Information</h1>
<table><thead><tr><th>Section</th><th>Date</th><th>Audit History Event</th><th>Created By</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

describe("I-9 saved record reads", () => {
  it("refuses a preliminary signer when only the audit header and rows are observable", async () => {
    const row = "<tr><td>2</td><td>01/01/2030</td><td>Signed Section 2</td><td>Example Signer</td></tr>";
    await withI9App("rows", async page => {
      const driver = createI9Driver(() => undefined, page);
      await assert.rejects(driver.readRecordSummary(record), error => error instanceof I9LookupError
        && error.code === "I9_LOOKUP_FAILED" && error.cause instanceof Error
        && error.cause.message === "i9-audit-completion-unverified");
    }, { [summaryRoute]: recordSummary(row) });
  });

  it("refuses to pick between Section 2 audit rows with different signers", async () => {
    const rows = ["Example First Signer", "Example Second Signer"].map(name =>
      `<tr><td>2</td><td>01/01/2030</td><td>Signed Section 2</td><td>${name}</td></tr>`).join("");
    await withI9App("rows", async page => {
      const driver = createI9Driver(() => undefined, page);
      await assert.rejects(driver.readRecordSummary(record),
        error => error instanceof I9LookupError && error.code === "I9_LOOKUP_AMBIGUOUS");
    }, { [summaryRoute]: recordSummary(rows) });
  });

  it("refuses to decide unsigned from an audit header with no rows", async () => {
    await withI9App("rows", async page => {
      const driver = createI9Driver(() => undefined, page);
      await assert.rejects(driver.readRecordSummary(record), error => error instanceof I9LookupError
        && error.cause instanceof Error && error.cause.message === "i9-audit-completion-unverified");
    }, { [summaryRoute]: recordSummary("") });
  });

  for (const scenario of ["rows", "empty"] as const) {
    it(`refuses remote creation authority for ${scenario === "rows" ? "a same-date record" : "an empty search"} without saved-mode evidence`, async () => {
      await withI9App(scenario, async page => {
        const driver = createI9Driver(() => undefined, page);
        const verdict = await driver.probeRemote(remoteTarget);
        assert.ok(verdict.state === "unknown");
        assert.equal(verdict.reason, "i9-remote-saved-mode-unverified");
      }, { [profileRoute]: profile, [summaryRoute]: recordSummary("") });
    });
  }

  it("refuses a staged remote creation before clicking Create I-9", async () => {
    await withI9App("empty", async page => {
      const driver = createI9Driver(() => undefined, page);
      await driver.prepareRemote(remoteTarget, async () => {});
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 30_000);
      await assert.rejects(driver.createRemote(capability), /i9-remote-saved-mode-unverified/u);
      assert.equal(await page.getByRole("button", { name: "Create I-9", exact: true }).getAttribute("data-clicked"), null);
    }, { [profileRoute]: profile });
  });
});
