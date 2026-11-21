import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it } from "vitest";
import { createUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import {
  deriveAssignmentDetailsFromCells,
  searchPersonOrgWithPagePort,
  selectPreferredAssignmentDetails,
} from "../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { SearchPersonOrgInputSchema } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
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

function assignmentCells(hrStatus: string, record: string, department: string): readonly string[] {
  return [record, "08/01/2026", hrStatus, "SDCMP", "40000000", "000412", department,
    "004921", "Dining Assistant", "", "0.50", "Student"];
}

it.each(["Active", "Inactive", "Terminated"])("prefers %s over a blank assignment status", hrStatus => {
  const known = deriveAssignmentDetailsFromCells(assignmentCells(hrStatus, "0", "CHEMISTRY"));
  const blank = { ...known, hrStatus: "", emplRecord: "9", department: "HOUSING" };
  assert.equal(selectPreferredAssignmentDetails([blank, known]), known);
});

it.each([
  { known: "Active", expected: "active" },
  { known: "Inactive", expected: "inactive" },
  { known: "Terminated", expected: "terminated" },
  { known: null, expected: "unknown" },
])("returns $expected from the preferred Person Org assignment", async ({ known, expected }) => {
  const emplId = EidSchema.parse("10800000");
  const unfamiliar = "Active status unavailable";
  const cells = [assignmentCells(unfamiliar, "9", "HOUSING")];
  if (known !== null) cells.push(assignmentCells(known, "0", "CHEMISTRY"));

  const result = await searchPersonOrgWithPagePort(() => undefined, {
    search: async () => ({
      kind: "detail",
      detail: {
        observedEid: emplId,
        displayedName: "Deterministic Person",
        cells,
        employmentInstances: "already-complete",
        startDate: "", terminationDate: "", terminationReason: "",
      },
    }),
    drill: () => Promise.reject(new Error("fixture returned detail directly")),
    returnToResults: () => Promise.reject(new Error("fixture has no results grid")),
  }, { kind: "by-eid", emplId });

  assert.equal(result.selection.selected?.hrStatus, known ?? unfamiliar);
  assert.equal(result.selection.selected?.employeeStatus, expected);
});
