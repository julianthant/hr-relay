import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { it } from "vitest";
import { createUcpathPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-operation.js";
import { UCPATH_PAYPATH_UI } from "../../../../../src/backend/systems/ucpath/driver/paypath-ui-registry.js";
import { EidSchema, FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";

const searchPage = readFileSync(new URL("../../../../support/fixtures/ui/ucpath/paypath-actions-search.html", import.meta.url), "utf8");
const emplId = EidSchema.parse("10000003");

function installRecord(positionNumber: string) {
  if (!location.pathname.endsWith("UC_E102_STAFF_ACAD.GBL")) return;
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || event.target.id !== "PTS_CFG_CL_WRK_PTS_SRCH_BTN") return;
    event.stopImmediatePropagation();
    document.body.innerHTML = `
      <span id="UC_E102_PP_HDR_NAME_DISPLAY">Lee, Jordan</span>
      <span id="UC_E102_PP_HDR_EMPLID"></span>
      <a href="#position">Position Data</a>
      <a href="#job">Job Data</a>
      <a href="#pay">Additional Pay Data</a>
      <label>Position Number: <input id="position-number"></label>
      <label for="effective-date">Effective Date:</label><input id="effective-date">
      <label for="change-reason">Position Change Reason:</label><input id="change-reason">
      <label>Position Pool: <input></label>
      <label>Comments <input></label>
      <label>Initiator's Comments <input></label>
      <button id="UC_E102_PP_WRK_SUBMIT_BTN">Save and Submit</button>`;
    const header = document.getElementById("UC_E102_PP_HDR_EMPLID");
    const position = document.getElementById("position-number");
    const save = document.getElementById("UC_E102_PP_WRK_SUBMIT_BTN");
    if (header === null || !(position instanceof HTMLInputElement) || save === null) throw new Error("fixture record missing");
    header.textContent = "10000003";
    position.value = positionNumber;
    save.addEventListener("click", () => save.remove());
  }, true);
}

it.each(["on open", "before Save", "after the final tab postback"])("refuses a different position %s even when the employee and form values agree", async when => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let positionNumber = "40012345";
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin !== new URL(UCPATH_PAYPATH_UI.hrTasksUrl).origin) return route.abort();
      const body = searchPage.replace("__FIXTURE__", "{}").replace("</body>",
        `<script>(${installRecord.toString()})(${JSON.stringify(positionNumber)})</script></body>`);
      return route.fulfill({ contentType: "text/html", body });
    });
    const driver = createUcpathPayPathOperations(() => undefined, page, manualClock(new Date("2026-08-03T18:00:00.000Z")));
    const reviewed = await driver.readPayPathPosition({ emplId });
    assert.equal(reviewed.position.positionNumber, "40012345");
    const target = {
      emplId, expectedName: reviewed.displayedName, positionNumber: reviewed.position.positionNumber,
      effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F", comments: "Synthetic work-study award",
    } as const;
    const frame = UCPATH_PAYPATH_UI.frame(page);
    if (when === "on open") {
      positionNumber = "40054321";
      await assert.rejects(driver.stagePayPathWorkStudy(target), { message: "paypath-position-mismatch" });
      assert.equal(await UCPATH_PAYPATH_UI.effectiveDate(frame).inputValue(), "");
    } else {
      await driver.stagePayPathWorkStudy(target);
      if (when === "before Save") {
        await UCPATH_PAYPATH_UI.positionNumber(frame).fill("40054321");
      } else {
        await UCPATH_PAYPATH_UI.additionalPayDataTab(frame).evaluate(tab => {
          tab.addEventListener("click", () => {
            const position = tab.ownerDocument.getElementById("position-number");
            if (!(position instanceof HTMLInputElement)) throw new Error("fixture record missing");
            position.value = "40054321";
          }, { once: true });
        });
      }
      const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)));
      await assert.rejects(driver.submitPayPathWorkStudy(target, capability), { message: "paypath-position-mismatch" });
      assert.equal(await UCPATH_PAYPATH_UI.saveAndSubmit(frame).isVisible(), true);
    }
  } finally {
    await browser.close();
  }
}, 60_000);
