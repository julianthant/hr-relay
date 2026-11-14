import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { describe, it } from "vitest";
import { createUcpathPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-operation.js";
import { UcpathPayPathRefusedError } from "../../../../../src/models/ui/ucpath-paypath.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";

const template = readFileSync(new URL("../../../../support/fixtures/ui/ucpath/paypath-actions-search.html", import.meta.url), "utf8");
const EMPL_ID = EidSchema.parse("10000001");

/**
 * The PayPath record a search opens, keyed by the typed Empl ID, ahead of the fixture's own Search handler: layout from run 92dd9da8's
 * capture (work-study-workflow-08), ids synthetic, each field wrapped in `win0div…` and labelled the PeopleSoft way.
 */
function payPathRecords() {
  const records: Record<string, "already-dated" | "editable" | undefined> = { "10000002": "already-dated", "10000003": "editable" };
  const el = (tag: string, attrs: Record<string, string>, text = "") => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.textContent = text;
    return node;
  };
  const field = (id: string, label: string, value: string, editable: boolean) => {
    const box = el("div", { id: `win0div${id}` });
    if (label !== "") box.append(el("label", { id: `${id}_LBL`, for: id }, label));
    box.append(editable ? Object.assign(el("input", { id, type: "text" }), { value }) : el("span", { id }, value));
    return box;
  };
  document.addEventListener("click", event => {
    const search = document.getElementById("UC_E102_PP_SRCH_EMPLID");
    if (!(event.target instanceof Element) || event.target.id !== "PTS_CFG_CL_WRK_PTS_SRCH_BTN" || !(search instanceof HTMLInputElement)) return;
    const shape = records[search.value];
    if (shape === undefined) return;
    event.stopImmediatePropagation();
    const editable = shape === "editable";
    const tabs = el("div", { role: "tablist" });
    for (const [i, name] of ["Position Data", "Job Data", "Additional Pay Data"].entries()) tabs.append(el("a", { id: `ICTAB_${String(i)}`, href: "javascript:void(0);" }, name));
    document.body.replaceChildren(tabs,
      field("UC_E102_PP_HDR_NAME_DISPLAY$0", "", "Lee, Jordan", false), el("input", { id: "UC_E102_PP_HDR_EMPLID_KEY", type: "hidden", value: search.value }),
      field("UC_E102_PP_HDR_EMPLID", "Empl ID", search.value, false), field("UC_E102_PP_HDR_EMPL_RCD", "Empl Record", "0", false),
      el("a", { id: "UC_E102_PP_POSN_LINK", href: "javascript:void(0);" }, "Position Data"),
      field("UC_E102_PP_POSN_POSITION_NBR", "Position Number:", "40012345", editable), field("UC_E102_PP_POSN_EFFDT", "Effective Date:", "09/13/2026", editable),
      field("UC_E102_PP_POSN_ACTION_REASON", "Position Change Reason:", editable ? "" : "JRL", editable), field("UC_E102_PP_POSN_POOL_ID", "Position Pool:", "", editable),
      el("h3", {}, "Existing Values"), field("UC_E102_PP_CUR_EFFDT", "Current Effective Date:", "09/13/2026", false));
  }, true);
}

async function probedPage(state: Readonly<{ droppedStepClicks?: number; frameDelayMs?: number }> = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(payPathRecords);
  const body = template.replace("__FIXTURE__", JSON.stringify(state));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body }));
  const driver = createUcpathPayPathOperations(() => undefined, page, manualClock(new Date("2026-11-13T20:30:00.000Z")));
  return { browser, page, driver };
}

describe("UCPath PayPath search on the probed page states", () => {
  it("fills the begins-with Empl ID search field and runs the search", async () => {
    const h = await probedPage();
    try {
      const error = await h.driver.readPayPathPosition({ emplId: EMPL_ID }).then(() => undefined, (caught: unknown) => caught);
      assert.ok(error instanceof UcpathPayPathRefusedError, String(error));
      assert.equal(error.code, "employee-not-found");
      const frame = h.page.frameLocator("#main_target_win0");
      assert.equal(await frame.getByRole("textbox", { name: "Empl ID begins with", exact: true }).inputValue(), EMPL_ID);
    } finally {
      await h.browser.close();
    }
  }, 60_000);

  it("refuses the already-dated record, Position Data shown as display text, by its own reason", async () => {
    const h = await probedPage();
    try {
      const error = await h.driver.readPayPathPosition({ emplId: EidSchema.parse("10000002") }).then(() => undefined, (caught: unknown) => caught);
      assert.ok(error instanceof UcpathPayPathRefusedError, String(error));
      assert.equal(error.code, "paypath-position-already-dated");
    } finally {
      await h.browser.close();
    }
  }, 60_000);

  it("reads the header and Position Data of an editable record past PeopleSoft's wrappers, labels and hidden keys", async () => {
    const h = await probedPage();
    const emplId = EidSchema.parse("10000003");
    try {
      const read = await h.driver.readPayPathPosition({ emplId });
      assert.equal(read.emplId, emplId);
      assert.equal(read.displayedName, "Lee, Jordan");
      assert.deepEqual(read.position, { effectiveDate: "09/13/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" });
    } finally {
      await h.browser.close();
    }
  }, 60_000);

  it.each([
    ["the content frame appears after the step link", { frameDelayMs: 500 }],
    ["the first step click is lost", { droppedStepClicks: 1 }],
  ])("reaches the search when %s", async (_state, state) => {
    const h = await probedPage(state);
    try {
      const error = await h.driver.readPayPathPosition({ emplId: EMPL_ID }).then(() => undefined, (caught: unknown) => caught);
      assert.ok(error instanceof UcpathPayPathRefusedError, String(error));
      assert.equal(error.code, "employee-not-found");
      assert.ok(await h.page.evaluate(() => Reflect.get(window, "payPathStepClicks") as number) <= 2);
    } finally {
      await h.browser.close();
    }
  }, 90_000);
});
