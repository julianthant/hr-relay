import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createI9Driver } from "../../../../../src/backend/systems/i9/driver/interpreter.js";
import { I9LookupError } from "../../../../../src/models/systems/i9/read-section2-signer.js";
import { fakeI9Page, i9SearchRow } from "../../../../support/helpers/browser/fake-i9-page.js";

const input = { lastName: "Example", firstName: "Person" };
const record = { profileId: "900001", i9Id: "900002" };
const driverFor = (options: Parameters<typeof fakeI9Page>[0] = {}) => {
  const fixture = fakeI9Page(options);
  return { ...fixture, driver: createI9Driver(() => undefined, fixture.page) };
};

describe("I-9 employee search and summary", () => {
  it("searches the exact fields and reads the last signer cell after audit readiness", async () => {
    const { driver, fields, actions } = driverFor({ signedCells: ["icon", "2", "01/01/2030", "Signed Section 2", " Example Representative "] });
    assert.deepEqual(await driver.readSection2Signer({ ...input, ssn: "123456789" }), { i9Status: "signed", signerName: "Example Representative", ...record });
    assert.equal(fields.get("Last Name"), input.lastName);
    assert.equal(fields.get("/First Name/u"), input.firstName);
    assert.equal(fields.get("Social Security Number"), "123-45-6789");
    assert.ok(actions.includes("goto:https://wwwe.i9complete.com/form-I9/summary/900001/900002"));
    assert.ok(actions.includes("wait:header:visible"));
  });

  it("distinguishes a proved empty search from restricted access", async () => {
    assert.deepEqual(await driverFor({ rows: [] }).driver.readSection2Signer(input), { i9Status: "not-found", signerName: "" });
    assert.deepEqual(await driverFor({ rows: [], restricted: true }).driver.readSection2Signer(input), { i9Status: "unable-to-access", signerName: "" });
    await assert.rejects(driverFor({ rows: [], restrictedProbeFails: true }).driver.readSection2Signer(input), /restriction probe detached/u);
    await assert.rejects(driverFor({ rows: [], missingResults: true }).driver.readSection2Signer(input), /never rendered/u);
  });

  it("distinguishes unsigned electronic records, incomplete records and historical imports", async () => {
    assert.deepEqual(await driverFor({ signedCells: null }).driver.readSection2Signer(input), { i9Status: "unsigned", signerName: "", ...record });
    const incomplete = driverFor({ rows: [i9SearchRow({ nextAction: " Complete   Section 2 ", i9Id: "" })] });
    assert.deepEqual(await incomplete.driver.readSection2Signer(input), { i9Status: "unsigned", signerName: "" });
    assert.equal(incomplete.actions.some(action => action.includes("/summary/")), false);
    const historical = driverFor({ summaryRoute: "https://wwwe.i9complete.com/form-I9-historical/900001/900002/0", missingAudit: true });
    assert.deepEqual(await historical.driver.readSection2Signer(input), { i9Status: "historical", signerName: "", ...record });
  });

  it("selects the first eligible record only within one exact-name employee profile", async () => {
    const { driver } = driverFor({ rows: [i9SearchRow({ nextAction: "Complete Section 1", i9Id: "" }), i9SearchRow()] });
    assert.equal((await driver.readSection2Signer(input)).i9Status, "signed");
    for (const rows of [
      [i9SearchRow(), i9SearchRow({ profileId: "900003" })],
      [i9SearchRow({ firstName: "Other Person" })],
    ]) await assert.rejects(driverFor({ rows }).driver.readSection2Signer(input), error => error instanceof I9LookupError && error.code === "I9_LOOKUP_AMBIGUOUS");
  });

  it("reads a blank next action from the summary and refuses a missing I-9 ID", async () => {
    assert.equal((await driverFor({ rows: [i9SearchRow({ nextAction: "" })] }).driver.readSection2Signer(input)).i9Status, "signed");
    await assert.rejects(driverFor({ rows: [i9SearchRow({ nextAction: "", i9Id: "" })] }).driver.readSection2Signer(input), I9LookupError);
  });

  it("fails malformed rows, missing audit, blank signer and mismatched summary routes", async () => {
    for (const options of [
      { rows: [["too", "short"]] },
      { missingAudit: true, signedCells: null },
      { signedCells: ["2", "date", "Signed Section 2", ""] },
      { summaryRoute: "https://wwwe.i9complete.com/form-I9/summary/900003/900004" },
      { summaryRoute: "https://wwwe.i9complete.com/Account/Login" },
      { routeAfterAudit: "https://wwwe.i9complete.com/form-I9/summary/900003/900004" },
      { summaryRoute: "https://example.test/form-I9/summary/900001/900002" },
    ]) await assert.rejects(driverFor(options).driver.readSection2Signer(input));
  });

  it("offers profile and I-9 employee searches without treating those IDs as UCPath EIDs", async () => {
    const { driver, fields } = driverFor();
    await driver.searchEmployees({ profileId: record.profileId, employeeId: "I9-EMP-1" });
    assert.equal(fields.get("Profile ID"), record.profileId);
    assert.equal(fields.get("Employee ID"), "I9-EMP-1");
    await assert.rejects(driver.searchEmployees({ firstName: "Person" }));
  });

  it("makes no further page reads when navigation revokes session authority", async () => {
    let active = true;
    const fixture = fakeI9Page({ onGoto: () => { active = false; } });
    const driver = createI9Driver(() => { if (!active) throw new Error("session revoked"); }, fixture.page);
    await assert.rejects(driver.readSection2Signer(input), /session revoked/u);
    assert.equal(fixture.actions.length, 1);
  });
});
