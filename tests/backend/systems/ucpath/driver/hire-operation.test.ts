import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createUcpathHireOperations } from "../../../../../src/backend/systems/ucpath/driver/hire-operation.js";
import { UcpathHireTargetSchema, UCPATH_HIRE_PROOF_EXAMPLE } from "../../../../../src/models/ui/ucpath-hire.js";
import { OnboardingReadHirePlan } from "../../../../../src/models/workflows/onboarding/read-hire-plan.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import { EidSchema, FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { DRY_RUN_I9_PROFILE_ID } from "../../../../../src/models/workflow/dry-run.js";
import { fakeUcpathHirePage } from "../../../../support/helpers/browser/fake-ucpath-hire-page.js";
const target = UcpathHireTargetSchema.parse({ mode: "new-hire", employee: OnboardingReadHirePlan.example.employee, expectedName: "Fixture Hire", emplId: null, profileId: "900001", comments: "Synthetic hire" });
const capability = () => mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)));
function fixture(options: Parameters<typeof fakeUcpathHirePage>[0] = {}) {
  const world = fakeUcpathHirePage(options); let captures = 0;
  return { ...world, driver: createUcpathHireOperations(() => undefined, world.page, manualClock(new Date("2026-09-01T18:00:00.000Z"))),
    capture: async () => { captures++; }, captures: () => captures };
}
describe("UCPath hire browser operations on a fake page", () => {
  it("fills the full new-hire wizard, captures its steps and verifies a single Pending filing", async () => {
    const h = fixture(); await h.driver.stageHire(target, h.capture);
    assert.equal(h.actions.includes("click:save"), false); assert.ok(h.captures() >= 40);
    for (const [field, value] of Object.entries({ "Select Template": "UC_FULL_HIRE", "Effective Date": "09/11/2026",
      "Legal First Name": "Fixture", "Legal Last Name": "Hire", "Legal Middle Name": "", "First Name": "Fixture", "Last Name": "Hire",
      "Date of Birth": "01/14/2000", "National ID": "", "Address Line 1": "123 Example St", "City": "San Diego", "State": "CA", "Postal Code": "92093",
      "Tracker Profile ID": "900001", "Position Number": "12345678", "Employee Classification": "5", "Comp Rate Code": "UCHRLY",
      "Compensation Rate": "17.75", "Compensation Frequency": "H", "Expected Job End Date": "06/30/2027", email: "hire@example.test",
      comments: "Synthetic hire", initiator: "Synthetic hire" })) assert.equal(h.fields.get(field), value, field);
    const proof = await h.driver.submitHire(capability());
    assert.equal(proof.approvalStatus, "Pending"); assert.equal(proof.transactionId, "T009000001");
    assert.equal(h.actions.filter(action => action === "click:save").length, 1);
  });
  it("acknowledges the named submit confirmation and still requires independent saved-detail proof", async () => {
    const h = fixture({ submitSignal: "confirmation" }); await h.driver.stageHire(target, h.capture);
    assert.equal((await h.driver.submitHire(capability())).transactionId, "T009000001");
    assert.equal(h.actions.filter(action => action === "click:save").length, 1);
  });
  it("awaits the owned screenshot before continuing to another browser step", async () => {
    const h = fixture();
    let release = () => {}, started = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    let first = true;
    const preparation = h.driver.stageHire(target, async () => { if (first) { first = false; started(); await held; } });
    await entered; assert.equal(h.actions.length, 0);
    release(); await preparation;
    assert.ok(h.actions.includes("fill:Select Template"));
    assert.equal(h.actions.includes("click:save"), false);
  });
  it("uses an independently resolved existing EID without editing legal identity or linking an I-9", async () => {
    const h = fixture({ rehire: true, saved: { emplId: EidSchema.parse("10800000"), profileId: null } });
    await h.driver.stageHire({ ...target, mode: "rehire", emplId: EidSchema.parse("10800000"), profileId: null }, h.capture);
    assert.equal(h.fields.get("Select Template"), "UC_CONC_HIRE");
    assert.equal(h.actions.includes("fill:Legal First Name"), false);
    assert.equal(h.actions.includes("fill:Tracker Profile ID"), false);
    assert.equal((await h.driver.submitHire(capability())).emplId, "10800000");
  });
  it("refuses a named confirmation for a different existing-person ID before save", async () => {
    const h = fixture({ rehire: true });
    await assert.rejects(h.driver.stageHire({ ...target, mode: "rehire", emplId: EidSchema.parse("10800001"), profileId: null }, h.capture), /confirmation-refused/u);
    assert.equal(h.actions.includes("click:save"), false);
  });
  for (const options of [{ headerName: "Wrong Person" }, { resetRate: true }, { disabled: true }, { rehire: true, wrongConfirmation: true }]) {
    it(`refuses before save for ${JSON.stringify(options)}`, async () => {
      const h = fixture(options);
      await assert.rejects(h.driver.stageHire(options.rehire ? UcpathHireTargetSchema.parse({ ...target, mode: "rehire", emplId: "10800000", profileId: null }) : target, h.capture));
      assert.equal(h.actions.includes("click:save"), false);
    });
  }
  it("refuses a forged capability and a numeric preview target before saving", async () => {
    const h = fixture(); await assert.rejects(h.driver.submitHire({} as never)); assert.equal(h.actions.length, 0);
    await h.driver.stageHire({ ...target, profileId: DRY_RUN_I9_PROFILE_ID }, h.capture);
    await assert.rejects(h.driver.submitHire(capability()), /preview-target-refused/u); assert.equal(h.actions.includes("click:save"), false);
  });
  it("requires an explicit no-match signal and validates the sole saved-detail result membership", async () => {
    const h = fixture(); assert.equal((await h.driver.scanHireTransactions(target)).rows.length, 0);
    await h.driver.stageHire(target, h.capture); await h.driver.submitHire(capability());
    const scan = await h.driver.scanHireTransactions(target); assert.equal(scan.state, "complete"); assert.equal(scan.rows[0]?.transactionId, "T009000001");
  });
  it("refuses a narrowed stale search instead of claiming absence", async () => {
    const h = fixture({ staleFilter: true });
    await assert.rejects(h.driver.scanHireTransactions(target), /filter-not-cleared/u);
    assert.equal(h.actions.includes("click:search"), false);
  });
  it("expands and rechecks the complete transaction-ID set after every detail read", async () => {
    const existingRows = [UCPATH_HIRE_PROOF_EXAMPLE, { ...UCPATH_HIRE_PROOF_EXAMPLE, transactionId: "T009000002" }];
    const h = fixture({ existingRows, paged: true });
    const scan = await h.driver.scanHireTransactions(target);
    assert.deepEqual(scan.rows.map(row => row.transactionId), ["T009000001", "T009000002"]);
    assert.equal(h.actions.filter(action => action === "click:view-all").length, 3);
    const drift = fixture({ existingRows, paged: true, driftAfterDetail: true });
    await assert.rejects(drift.driver.scanHireTransactions(target), /membership-changed/u);
    assert.equal(drift.actions.includes("click:save"), false);
  });
  it("refuses a result row outside the searched name before any drill", async () => {
    const h = fixture({ existingRows: [UCPATH_HIRE_PROOF_EXAMPLE, { ...UCPATH_HIRE_PROOF_EXAMPLE, transactionId: "T009000002", displayedName: "Other Person" }] });
    await assert.rejects(h.driver.scanHireTransactions(target), /search-result-outside-key/u);
    assert.equal(h.actions.some(action => action.startsWith("click:drill:")), false);
  });
  it("never clicks Clear on a freshly loaded search form", async () => {
    const h = fixture(); await h.driver.scanHireTransactions(target);
    assert.equal(h.actions.includes("click:clear"), false);
  });
  it("refuses a preloaded name box", async () => {
    const h = fixture({ presetName: "Other Person" });
    await assert.rejects(h.driver.scanHireTransactions(target), /filter-not-cleared/u);
    assert.equal(h.actions.includes("click:search"), false);
  });
  it("refuses an auto-opened detail for another name", async () => {
    const h = fixture({ existingRows: [{ ...UCPATH_HIRE_PROOF_EXAMPLE, displayedName: "Other Person" }] });
    await assert.rejects(h.driver.scanHireTransactions(target), /search-result-outside-key/u);
  });
  for (const options of [{ submitSignal: "person-match" as const }, { submitSignal: "select-action" as const }, { submitSignal: "error" as const }, { unknownSubmit: true }, { saved: { approvalStatus: "Denied" } }, { saved: { email: "other@example.test" } }]) {
    it(`refuses unproved completion after one save for ${JSON.stringify(options)}`, async () => {
      const h = fixture(options); await h.driver.stageHire(target, h.capture);
      await assert.rejects(h.driver.submitHire(capability())); assert.equal(h.actions.filter(action => action === "click:save").length, 1);
      await assert.rejects(h.driver.submitHire(capability()), /not-staged|route-refused/u);
    });
  }
});
