import { UCPATH_PENDING_FINDINGS_RECIPES, UCPATH_UI_REGISTRY } from "../../../../../src/backend/systems/ucpath/driver/ui-registry.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readTransactionFindingsOnPage, scanTerminationTransactionsOnPage } from "../../../../../src/backend/systems/ucpath/driver/transaction-findings-operation.js";
import { UCPATH_SS_SMART_HR_RESULT_EID, UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID, UCPATH_SS_SMART_HR_RESULT_NAME, UCPATH_SS_SMART_HR_RESULT_DRILL_IN, UCPATH_SS_SMART_HR_DETAIL_REQUESTED, UCPATH_SS_SMART_HR_DETAIL_NAME, UCPATH_SS_SMART_HR_DETAIL_ACTION, UCPATH_SS_SMART_HR_DETAIL_START_DATE, UCPATH_SS_SMART_HR_RETURN_TO_LIST, UCPATH_SS_SMART_HR_RESULT_COUNTER, UCPATH_SS_SMART_HR_RESULTS_VIEW_ALL } from "../../../../../src/models/ui/ucpath-transaction-findings.js";
import { resolveUcpathFindingElement, resolveUcpathFindingIndexedElement } from "../../../../../src/backend/systems/ucpath/driver/registry-locators.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { singleResultAutoDrillPage } from "../../../../support/helpers/ucpath-findings-page.js";
const EID = EidSchema.parse("10203262");
const OBSERVED = "2026-11-02T18:00:00.000Z";
const ID = "T009000001";
const read = (page: ReturnType<typeof singleResultAutoDrillPage>) => readTransactionFindingsOnPage(() => undefined, page, { emplId: EID }, OBSERVED);
const grid = (ids: readonly string[], options: Parameters<typeof singleResultAutoDrillPage>[8] = {}) => singleResultAutoDrillPage(ids[0], 0, ids[0], "row", "none", ids, ids.join(" "), ids.map(() => true), options);

describe("UCPath transaction findings", () => {
  it("keeps supplied anchors pending without claiming historical live counts or visibility", () => {
    const pending = UCPATH_PENDING_FINDINGS_RECIPES;
    assert.equal(pending.elements.length, 11);
    assert.equal(pending.states.length, 2);
    for (const candidate of [...pending.elements, ...pending.states]) {
      assert.deepEqual(candidate.provenance, {
        status: "pending-live-verification",
        source: { kind: "operator-supplied-anchor-observation", observedAt: "2026-11-02" },
        matchCount: "unconfirmed", visibility: "unconfirmed",
      });
      assert.equal("verification" in candidate, false);
      assert.equal([...UCPATH_UI_REGISTRY.elements, ...UCPATH_UI_REGISTRY.states].some(verified => verified.id === candidate.id), false);
    }
  });
  it("propagates cancellation rather than converting it to read authority", async () => {
    let checks = 0;
    await assert.rejects(readTransactionFindingsOnPage(() => {
      checks += 1;
      if (checks >= 4) throw new Error("fixture cancelled");
    }, grid([ID]), { emplId: EID }, OBSERVED), /fixture cancelled/u);
  });

  it("binds returned row EID and preserves actual Requested with microseconds independently of observation time", async () => {
    const result = await read(singleResultAutoDrillPage());
    assert.equal(result.state, "read");
    if (result.state !== "read") throw new Error("complete findings read required");
    assert.equal(result.rows[0]?.emplId, EID);
    assert.equal(result.rows[0]?.submittedAt, "06/10/26 9:12:34.123456AM");
    assert.notEqual(result.rows[0]?.submittedAt, result.observedAt);
    assert.equal(result.rows[0]?.detailVerified, true);
    assert.deepEqual(result.completeness, { state: "complete", reportedRowCount: 1 });
  });

  it("resolves every pending candidate recipe against the faithful list and detail fixture", async () => {
    const page = grid([ID]);
    await page.goto("https://example.invalid");
    await page.locator("#PTS_CFG_CL_WRK_PTS_SRCH_BTN").click();
    for (const id of [UCPATH_SS_SMART_HR_RESULT_EID, UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID, UCPATH_SS_SMART_HR_RESULT_NAME, UCPATH_SS_SMART_HR_RESULT_DRILL_IN]) {
      const locator = resolveUcpathFindingIndexedElement(page, id, 0);
      assert.equal(await locator.count(), 1);
      assert.equal(await locator.isVisible(), true);
      assert.ok((await locator.innerText()).length > 0);
    }
    assert.equal(await resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_RESULT_COUNTER).innerText(), "1-1 of 1");
    assert.equal(await resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_RESULTS_VIEW_ALL).count(), 1);
    await resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_DRILL_IN, 0).click();
    for (const id of [UCPATH_SS_SMART_HR_DETAIL_REQUESTED, UCPATH_SS_SMART_HR_DETAIL_NAME, UCPATH_SS_SMART_HR_DETAIL_ACTION, UCPATH_SS_SMART_HR_DETAIL_START_DATE, UCPATH_SS_SMART_HR_RETURN_TO_LIST]) {
      const locator = resolveUcpathFindingElement(page, id);
      assert.equal(await locator.count(), 1);
      assert.equal(await locator.isVisible(), true);
    }
    await resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_RETURN_TO_LIST).click();
    assert.equal(await resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_EID, 0).innerText(), EID);
  });

  for (const [label, options] of [
    ["searched EID spoof", { rowEid: "10800001" }],
    ["detail name mismatch", { detailName: "Different, Person" }],
    ["missing Requested", { submittedAt: "" }],
    ["invented ISO Requested", { submittedAt: OBSERVED }],
    ["hidden identity cell", { hiddenCell: true }],
    ["missing identity cell", { missingCell: true }],
    ["missing counter", { counterCount: 0 }],
    ["ambiguous counter", { counterCount: 2 }],
    ["malformed counter range", { counterText: "2-1 of 1" }],
    ["unparseable counter", { counterText: "one result" }],
    ["count mismatch", { reportedCount: 2 }],
    ["counter changed on return", { counterChangesOnReturn: true }],
    ["bound result set changed", { mutateOnReturn: true }],
  ] as const) {
    it(`refuses ${label}`, async () => {
      const result = await read(grid([ID], options));
      assert.equal(result.state, "unreadable");
    });
  }

  it("uses exact normalized whitespace/case for the detail name", async () => {
    const result = await read(grid([ID], { detailName: "  PERSON,   DETERMINISTIC  " }));
    assert.equal(result.state, "read");
  });

  it("requires return-list row evidence for an auto-drilled detail without an EID", async () => {
    const result = await read(singleResultAutoDrillPage(ID, 1, ID, "none", "none", [ID], ID, [true], { returnListMissing: true }));
    assert.equal(result.state, "unreadable");
    if (result.state === "unreadable") assert.match(result.reason, /return list unavailable/u);
  });

  it("reads every row beyond the initial 100 through verified View All", async () => {
    const events: string[] = [];
    const ids = Array.from({ length: 101 }, (_, index) => `T${String(9000001 + index).padStart(9, "0")}`);
    const result = await read(grid(ids, { initialVisibleCount: 100, delayedExpansion: true, resetViewOnReturn: true, events }));
    assert.equal(result.state, "read");
    if (result.state !== "read") throw new Error("complete findings read required");
    assert.deepEqual(result.rows.map(row => row.transactionId), ids);
    assert.equal(result.scannedRowCount, 101);
    assert.ok(events.includes("expansion-pending"));
    assert.ok(events.includes("wait-full-counter"));
    assert.equal(events.filter(event => event === "expansion-settled").length, 102);
    assert.ok(events.includes("wait-list-ready"));
    assert.ok(events.includes("wait-detail-ready"));
    assert.deepEqual(result.completeness, { state: "complete", reportedRowCount: 101 });
    const stalled = await read(grid(ids, { initialVisibleCount: 100, expansionStalls: true }));
    assert.equal(stalled.state, "unreadable");
    if (stalled.state === "unreadable") assert.match(stalled.reason, /fixture expansion wait expired/u);
  });

  it("refuses a reordered bound slot before opening the wrong transaction", async () => {
    const events: string[] = [];
    const result = await read(grid([ID, "T009000002"], { reorderOnReturn: true, events }));
    assert.equal(result.state, "unreadable");
    assert.deepEqual(events.filter(event => event.startsWith("drill:")), [`drill:${ID}`]);
  });

  it("records all 300 capped findings but never grants operational scan authority", async () => {
    const ids = Array.from({ length: 300 }, (_, index) => `T${String(9000001 + index).padStart(9, "0")}`);
    const events: string[] = [];
    const result = await read(grid(ids, { initialVisibleCount: 100, events }));
    assert.equal(result.state, "read");
    if (result.state !== "read") throw new Error("complete findings read required");
    assert.equal(result.rows.length, 300);
    assert.deepEqual(result.rows.map(row => row.transactionId), ids);
    assert.equal(events.filter(event => event.startsWith("drill:")).length, 300);
    const rowEidReads = events.filter(event => event === "row-eid-read").length;
    assert.ok(rowEidReads >= 3 * ids.length, "the oracle observes initial, bound-slot and final row identities");
    assert.ok(rowEidReads <= 8 * ids.length,
      "a complete finding traversal must use only linearly many row-EID reads");
    assert.deepEqual(result.completeness, { state: "incomplete", reason: "search-cap", reportedRowCount: 300 });
    const operational = await scanTerminationTransactionsOnPage(() => undefined, grid(ids), { emplId: EID, transactionId: ID }, OBSERVED);
    assert.equal(operational.state, "unreadable");
  });

  it("does not let a requested ID bypass a wrong-EID row elsewhere in the full findings", async () => {
    const result = await scanTerminationTransactionsOnPage(() => undefined, grid([ID], { rowEid: "10800001" }), { emplId: EID, transactionId: "T999999999" }, OBSERVED);
    assert.equal(result.state, "unreadable");
  });

  it("returns only core operational row fields after the complete finding read", async () => {
    const result = await scanTerminationTransactionsOnPage(() => undefined, grid([ID]), { emplId: EID }, OBSERVED);
    assert.equal(result.state, "read");
    if (result.state !== "read") throw new Error("complete findings read required");
    assert.deepEqual(Object.keys(result.rows[0] ?? {}).sort(), ["transactionId", "emplId", "displayedName", "action", "approvalStatus", "startDate"].sort());
  });
});
