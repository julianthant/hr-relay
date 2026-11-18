import assert from "node:assert/strict";

import { chromium, type Page } from "playwright";
import { describe, it } from "vitest";
import { joinPendingSweepGridRows, readInProgressSubjectOnPage, ucpathSmartHrOperations } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import { UCPATH_SMART_HR_DELETE_SELECTED_BUTTON } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingSweepTarget, UcpathTransactionRow } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import { createDeterministicUcpathDriverRow } from "../../../../support/helpers/ucpath-pending-row-fixtures.js";

const EID = EidSchema.parse("10203262");
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-28T19:00:00.000Z");
const { transactionRow } = createDeterministicUcpathDriverRow(EID);

function sweepTarget(
  eligible: readonly UcpathTransactionRow[],
  protectedRows: readonly UcpathTransactionRow[] = [],
): UcpathPendingSweepTarget {
  return {
    emplId: EID,
    expectedName: "Deterministic Person",
    observedSet: {
      kind: "ucpath-pending-termination-set",
      emplId: EID,
      eligible: [...eligible],
      protected: [...protectedRows],
      observedAt: OBSERVED_AT,
      source: "ss-smart-hr-detail-read",
    },
  };
}

function gridRow(overrides: Partial<Readonly<{
  transactionType: string;
  effectiveDate: string;
  displayedName: string;
  emplId: typeof EID;
  action: string;
  country: string;
}>> = {}) {
  return {
    transactionType: "Termination",
    effectiveDate: "06/11/2026",
    displayedName: "Deterministic Person",
    emplId: EID,
    action: "Terminatn",
    country: "USA",
    ...overrides,
  };
}

describe("Transactions in Progress exact-set join", () => {
  it("joins the stable T id through the complete shared facts and excludes protected filings", () => {
    const eligible = transactionRow();
    const protectedFiling = transactionRow({
      transactionId: "T009000002",
      approvalStatus: "Approved",
    });
    assert.deepEqual(
      joinPendingSweepGridRows(sweepTarget([eligible], [protectedFiling]), [gridRow()]),
      [{ candidateIndex: 0, selected: { ...gridRow(), transactionId: eligible.transactionId } }],
    );
  });

  it("refuses changed, newly appeared and ambiguous rows before selection", () => {
    const first = transactionRow();
    const second = transactionRow({ transactionId: "T009000002" });
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first]), [gridRow({ effectiveDate: "06/12/2026" })]),
      /joined 0 Transactions in Progress rows/u,
    );
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first]), [gridRow(), gridRow({ effectiveDate: "06/12/2026" })]),
      /exposed 2 eligible rows/u,
    );
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first, second]), [gridRow(), gridRow()]),
      /joined 2 Transactions in Progress rows/u,
    );
  });

  it("reads the staged subject through named row controls and refuses conflicting names", async () => {
    const page = (rows: readonly Readonly<{ eid: string; name: string }>[]): Page => ({
      locator: () => ({
        all: async () => rows.map((row) => ({
          locator: (selector: string) => ({
            count: async () => 1,
            innerText: async () => selector.includes("EMPLID") ? row.eid : row.name,
          }),
        })),
      }),
    }) as unknown as Page;

    assert.equal(
      await readInProgressSubjectOnPage(() => undefined, page([
        { eid: EID, name: "Person, Deterministic" },
        { eid: EID, name: "Deterministic Person" },
      ]), EID),
      "Person, Deterministic",
    );
    await assert.rejects(
      readInProgressSubjectOnPage(() => undefined, page([
        { eid: EID, name: "Person, Deterministic" },
        { eid: EID, name: "Somebody Else" },
      ]), EID),
      /2 distinct names/u,
    );
  });
});

async function routeSweepFixture(page: Page, foreignChecked: boolean): Promise<void> {
  const row = transactionRow();
  const result = `
    <p>1-1 of 1</p>
    <table><tr id="trPTS_CFG_CL_STD_RSL0">
      <td id="PTS_CFG_CL_RSLT_NUI_SRCH0$11$$0">${row.transactionId}</td>
      <td id="PTS_CFG_CL_RSLT_NUI_SRCH3$14$$0">${row.emplId}</td>
      <td id="PTS_CFG_CL_RSLT_NUI_SRCH2$13$$0">${row.displayedName}</td>
      <td><button id="PTS_CFG_CL_RSLT_PTS_DRILLIN$40$$0" onclick="show('detail')">Details</button></td>
    </tr></table>`;
  const search = `
    <input id="UC_SS_TBH_DVW_EMPLID">
    <select id="UC_SS_TBH_DVW_EMPLID$op"><option value="2">Equals</option></select>
    <button id="PTS_CFG_CL_WRK_PTS_SRCH_BTN" onclick="show('result')">Search</button>
    <template id="result">${result}</template>
    <template id="detail">
      <span id="UC_SS_TRANSACT_UC_TRANSACT_ID">${row.transactionId}</span>
      <span id="UC_SS_TRANSACT_APPR_STATUS">${row.approvalStatus}</span>
      <span id="UC_SS_TRANSACT_DTTM_CREATED">06/10/26 9:12:34.123456AM</span>
      <span id="NAME$span$0">${row.displayedName}</span>
      <span id="UC_SS_TBH_VW_ACTION$0">${row.action}</span>
      <span id="UC_SS_TBH_VW_START_DT$0">${row.startDate}</span>
      <button id="#ICList" onclick="show('result')">Return to list</button>
    </template>
    <div id="surface"></div>
    <script>function show(id) {
      document.getElementById('surface').replaceChildren(document.getElementById(id).content.cloneNode(true));
    }</script>`;
  const wizardRow = (index: number, eid: string, checked: boolean) => `
    <tr id="trHR_TBH_EULST_VW$0_row${index}"><td>
      <input type="checkbox" id="SELECT$${index}" ${checked ? "checked" : ""}>
      <span id="EMPLID$${index}">${eid}</span>
      <a id="NAME$${index}">${index === 0 ? row.displayedName : "Other Test Person"}</a>
      <span id="ACTION$${index}">Terminatn</span>
      <span id="TBH_TMPL_TXN_TYP$${index}">Termination</span>
      <span id="EFFDT$${index}">${row.startDate}</span>
      <span id="COUNTRY$${index}">USA</span>
    </td></tr>`;
  const wizard = `
    <input id="HR_TBH_WRK_TBH_TMPL_ID">
    <table>${wizardRow(0, row.emplId, false)}${wizardRow(1, "10800000", foreignChecked)}</table>
    <button id="HR_TBH_WRK_DELETE_BTN" onclick="document.getElementById('ALERTMSG').textContent = 'Synthetic delete clicked'">Delete Selected</button>
    <p id="ALERTMSG"></p>`;
  await page.route("**/*", route => route.fulfill({
    contentType: "text/html",
    body: new URL(route.request().url()).pathname.includes("UC_SS_TBH.GBL") ? search : wizard,
  }));
}

describe("Transactions in Progress selection at the delete boundary", () => {
  it("refuses Delete Selected when the probe expires while the driver waits for the control", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, false);
      await ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT);
      const button = page.locator("#HR_TBH_WRK_DELETE_BTN");
      await button.evaluate(element => element.setAttribute("hidden", ""));
      let remainingMs = 100;
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => remainingMs);
      const refused = assert.rejects(
        ucpathSmartHrOperations.commit(() => undefined, page, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, capability),
        /probe deadline/u,
      );
      remainingMs = 0;
      await button.evaluate(element => element.removeAttribute("hidden"));
      await refused;
      assert.equal(await page.locator("#ALERTMSG").textContent(), "");
    } finally { await browser.close(); }
  });

  it("bounds Playwright's actionability wait by the remaining probe budget", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, false);
      await ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT);
      const button = page.locator("#HR_TBH_WRK_DELETE_BTN");
      await button.evaluate(element => element.setAttribute("disabled", ""));
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 125);
      await assert.rejects(
        ucpathSmartHrOperations.commit(() => undefined, page, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, capability),
        /Timeout 125ms exceeded/u,
      );
      assert.equal(await page.locator("#ALERTMSG").textContent(), "");
    } finally { await browser.close(); }
  });

  it("refuses a pre-checked foreign row before checking the authorized row", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, true);
      await assert.rejects(
        ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT),
        /checked outside the authorized pending sweep/u,
      );
      assert.equal(await page.locator('[id="SELECT$0"]').isChecked(), false);
      assert.equal(await page.locator('[id="SELECT$1"]').isChecked(), true);
      assert.equal(await page.locator("#ALERTMSG").textContent(), "");
    } finally {
      await browser.close();
    }
  });

  it("refuses a foreign row checked after staging and before Delete Selected", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, false);
      await ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT);
      await page.locator('[id="SELECT$1"]').check();
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 30_000);
      await assert.rejects(
        ucpathSmartHrOperations.commit(() => undefined, page, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, capability),
        /checked outside the authorized pending sweep/u,
      );
      assert.equal(await page.locator("#ALERTMSG").textContent(), "");
    } finally {
      await browser.close();
    }
  });

  it("blocks Delete Selected if the checked set changes while the button is disabled after the census", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, false);
      await ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT);
      await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>("#HR_TBH_WRK_DELETE_BTN");
        const foreign = document.querySelector<HTMLInputElement>('[id="SELECT$1"]');
        const checked = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
        if (!button || !foreign || !checked?.get || !checked.set) throw new Error("missing fixture controls");
        const readChecked = checked.get;
        button.disabled = true;
        Object.defineProperty(foreign, "checked", {
          set: checked.set,
          get() {
            document.documentElement.dataset.sweepCensused = "true";
            return readChecked.call(this) === true;
          },
        });
      });

      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 30_000);
      const refused = assert.rejects(
        ucpathSmartHrOperations.commit(() => undefined, page, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, capability),
        /checked set changed at Delete Selected dispatch/u,
      );
      const changeSelection = async () => {
        await page.locator('html[data-sweep-censused="true"]').waitFor({ state: "attached" });
        await page.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>("#HR_TBH_WRK_DELETE_BTN");
          const foreign = document.querySelector<HTMLInputElement>('[id="SELECT$1"]');
          if (!button?.disabled || !foreign) throw new Error("fixture must change the selection while Delete Selected is disabled");
          foreign.checked = true;
          button.disabled = false;
        });
      };
      await Promise.all([refused, changeSelection()]);
      assert.equal(await page.locator("#ALERTMSG").textContent(), "");
    } finally {
      await browser.close();
    }
  });

  it("blocks the delete handler if a row becomes checked on pointerdown", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, false);
      await ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT);
      await page.evaluate(() => {
        const button = document.querySelector("#HR_TBH_WRK_DELETE_BTN");
        const foreign = document.querySelector<HTMLInputElement>('[id="SELECT$1"]');
        if (!button || !foreign) throw new Error("missing fixture controls");
        button.addEventListener("pointerdown", () => { foreign.checked = true; }, { once: true });
      });
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 30_000);
      await assert.rejects(
        ucpathSmartHrOperations.commit(() => undefined, page, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, capability),
        /checked set changed at Delete Selected dispatch/u,
      );
      assert.equal(await page.locator('[id="SELECT$1"]').isChecked(), true);
      assert.equal(await page.locator("#ALERTMSG").textContent(), "");
    } finally {
      await browser.close();
    }
  });

  it("clicks Delete Selected when precisely the authorized rows remain checked", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeSweepFixture(page, false);
      await ucpathSmartHrOperations.stagePendingTerminationSweep(() => undefined, page, sweepTarget([transactionRow()]), OBSERVED_AT);
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 30_000);
      await assert.rejects(
        ucpathSmartHrOperations.commit(() => undefined, page, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, capability),
        /Synthetic delete clicked/u,
      );
      assert.equal(await page.locator('[id="SELECT$0"]').isChecked(), true);
      assert.equal(await page.locator('[id="SELECT$1"]').isChecked(), false);
    } finally {
      await browser.close();
    }
  });
});
