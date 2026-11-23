import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it } from "vitest";
import { createUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import { SearchPersonOrgInputSchema } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import { descriptorRuntimeNodes } from "../../../../../src/workflow-kit/workflow.js";
import { separationsDescriptor } from "../../../../support/helpers/registered-workflows.js";

it("submits only the Kuali Employee ID through the Person Org interpreter", async () => {
  const search = descriptorRuntimeNodes(separationsDescriptor).find(node => String(node.id) === "name-search");
  assert.ok(search?.kind === "task");
  const input = SearchPersonOrgInputSchema.parse(search.bind({
    input: {},
    outputs: {
      document: { employee: { eid: { state: "present", value: "10800000" } } },
      plan: { employeeName: "Person, Deterministic" },
    },
  }));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.route("**/*", route => route.fulfill({
      contentType: "text/html",
      body: new URL(route.request().url()).pathname === "/fixture-person-org" ? `
        <input id="UC_ORG_SUM_VW_EMPLID" value="10800001">
        <input id="UC_ORG_SUM_VW_PARTNER_LAST_NAME" value="Stale">
        <input id="UC_ORG_SUM_VW_NAME_DISPLAY" value="Name">
        <button id="PTS_CFG_CL_WRK_PTS_SRCH_BTN">Search</button>
        <p id="PTS_CRITTEXT_DISP" hidden>No matching values were found</p>
        <script>
          const searches = [];
          document.querySelector("button").onclick = () => {
            searches.push(Array.from(document.querySelectorAll("input"), field => field.value));
            document.body.dataset.searches = JSON.stringify(searches);
            document.querySelector("p").hidden = false;
          };
        </script>
      ` : `
        <a href="#search" role="link" steplabel="Person Organizational Summary">Person Organizational Summary</a>
        <iframe id="main_target_win0" src="/fixture-person-org"></iframe>
      `,
    }));
    const result = await createUcpathPersonOrgDriver(() => undefined, page).searchPersonOrg(input);
    assert.equal(result.selection.status, "not-found");
    const actual = await page.frameLocator("#main_target_win0").locator("body").getAttribute("data-searches");
    assert.deepEqual(JSON.parse(actual ?? "null"), [["10800000", "", ""]]);
  } finally {
    await browser.close();
  }
});
