import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Page } from "playwright";
import { describe, it, vi } from "vitest";
import { joinPendingSweepGridRows, readInProgressSubjectOnPage, ucpathSmartHrOperations } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import { UCPATH_SMART_HR_DELETE_SELECTED_BUTTON } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingSweepTarget, UcpathTransactionRow } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { clickWithMutationCapability } from "../../../../../src/backend/systems/browser-shared/mutation-click.js";
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

function expiringCapability(budgetMs: number) {
  const expires = performance.now() + budgetMs;
  return mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => expires - performance.now());
}

describe("browser dispatch of a fenced click", () => {
  it("refuses a real click queued before expiry and delivered afterwards", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<button onclick="this.textContent = 'clicked'">ready</button>`);
      const button = await page.getByRole("button").elementHandle();
      const original = button.click.bind(button);
      let queued = 0;
      vi.spyOn(button, "click").mockImplementation(options => {
        const action = original(options);
        queued++;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
        return action;
      });
      const result = await Promise.allSettled([clickWithMutationCapability(expiringCapability(500), button)]);
      assert.equal(queued, 1);
      assert.equal(await button.textContent(), "ready");
      assert.equal(result[0].status, "rejected");
    } finally { await browser.close(); }
  });

  it("refuses the click when pointerdown stalls the renderer past expiry", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<button>ready</button>");
      const button = page.getByRole("button");
      await button.evaluate(element => {
        element.addEventListener("pointerdown", () => {
          element.textContent = "pressed";
          const resume = performance.now() + 700;
          while (performance.now() < resume) { /* Hold this event turn across the cutoff. */ }
        });
        element.addEventListener("click", () => { element.textContent = "clicked"; });
      });
      await assert.rejects(clickWithMutationCapability(expiringCapability(400), button), /probe deadline/u);
      assert.equal(await button.textContent(), "pressed");
    } finally { await browser.close(); }
  });

  it("preserves the navigation wait and receipt read after timely dispatch", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let requests = 0;
      await page.route("https://fixture.invalid/**", async route => {
        if (route.request().url().endsWith("/receipt")) {
          requests++;
          await delay(900);
          await route.fulfill({ contentType: "text/html", body: "<output>saved</output>" });
        } else {
          await route.fulfill({ contentType: "text/html", body: '<a href="/receipt">Save</a>' });
        }
      });
      await page.goto("https://fixture.invalid/start");
      await clickWithMutationCapability(expiringCapability(600), page.getByRole("link"), 4000);
      assert.equal(requests, 1);
      assert.equal(new URL(page.url()).pathname, "/receipt");
      assert.equal(await page.locator("output").textContent(), "saved");
    } finally { await browser.close(); }
  });

  for (const source of ["explicit", "page", "context"] as const) {
    it(`charges attachment and actionability to one ${source} timeout`, async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext();
        context.setDefaultTimeout(source === "context" ? 1200 : 5000);
        const page = await context.newPage();
        if (source === "page") page.setDefaultTimeout(1200);
        await page.setContent("<main></main>");
        await page.evaluate(() => {
          const button = document.createElement("button");
          button.disabled = true;
          button.textContent = "Save";
          button.onclick = () => { button.textContent = "clicked"; };
          setTimeout(() => document.body.append(button), 650);
          setTimeout(() => { button.disabled = false; }, 1400);
        });
        const action = clickWithMutationCapability(expiringCapability(5000), page.getByRole("button"),
          source === "explicit" ? 1200 : undefined);
        await assert.rejects(action, /[Tt]imeout/u);
        await page.waitForFunction(() => document.querySelector("button")?.disabled === false, undefined, { timeout: 3000 });
        assert.equal(await page.getByRole("button").textContent(), "Save");
      } finally { await browser.close(); }
    });
  }

  it("charges a timely click's navigation to the action window that began before attachment", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let requests = 0;
      let responseReleased = false;
      await page.route("https://fixture.invalid/receipt", async route => {
        requests++;
        await delay(950);
        responseReleased = true;
        await route.fulfill({ contentType: "text/html", body: "<output>saved</output>" });
      });
      await page.setContent("<main></main>");
      await page.evaluate(() => {
        const link = document.createElement("a");
        link.href = "https://fixture.invalid/receipt";
        link.textContent = "Save";
        setTimeout(() => document.body.append(link), 600);
      });
      const link = page.getByRole("link");
      const acquire = link.elementHandle.bind(link);
      let responseReleasedAtCancellation: boolean | undefined;
      vi.spyOn(link, "elementHandle").mockImplementation(async options => {
        const handle = await acquire(options);
        const click = handle.click.bind(handle);
        vi.spyOn(handle, "click").mockImplementation(input => {
          assert.ok(input?.signal);
          input.signal.addEventListener("abort", () => { responseReleasedAtCancellation = responseReleased; }, { once: true });
          return click(input);
        });
        return handle;
      });
      const action = clickWithMutationCapability(expiringCapability(5000), link, 1400);
      await assert.rejects(action, /[Tt]imeout/u);
      assert.equal(requests, 1);
      assert.equal(responseReleasedAtCancellation, false);
      await page.waitForURL("https://fixture.invalid/receipt");
      assert.equal(await page.locator("output").textContent(), "saved");
    } finally { await browser.close(); }
  });

  it("preserves the configured default when the probe outlasts the control", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(175);
      await page.setContent("<button disabled>Save</button>");
      await assert.rejects(clickWithMutationCapability(expiringCapability(1000), page.getByRole("button")), /Timeout 175ms exceeded/u);
    } finally { await browser.close(); }
  });
});

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
        /probe deadline/u,
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
        const readChecked = checked.get.bind(foreign);
        button.disabled = true;
        Object.defineProperty(foreign, "checked", {
          set: checked.set.bind(foreign),
          get() {
            document.documentElement.dataset.sweepCensused = "true";
            return readChecked() === true;
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
