import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RosterNameUnresolvedError, rosterHireNames, splitRosterName } from "../../../src/rules/onboarding/roster-name.js";

const crm = (firstName: string, middleName: string, lastName: string) => ({ firstName, middleName, lastName });
const name = (firstName: string, middleName: string, lastName: string) => ({ firstName, middleName, lastName });
const legalOf = (legalName: string, fields: ReturnType<typeof crm>) => rosterHireNames({ legalName, livedName: null }, fields).legal;

describe("roster name split against CRM anchors", () => {
  it.each([
    ["Jonathan Smith", crm("Jon", "", "Smith"), name("Jonathan", "", "Smith")],
    ["Smith, Jonathan", crm("Jon", "", "Smyth"), name("Jonathan", "", "Smith")],
    ["Jonathan Michael Smith", crm("Jonathan", "", "Smith"), name("Jonathan", "Michael", "Smith")],
    ["Jonathan Michael Smith", crm("Jon", "M", "Smith"), name("Jonathan", "Michael", "Smith")],
    ["Mary Ann Smith", crm("Mary Ann", "", "Smith"), name("Mary Ann", "", "Smith")],
    ["Maria Lopez Garcia", crm("Maria", "", "Lopez Garcia"), name("Maria", "", "Lopez Garcia")],
  ])("splits %s", (cell, fields, expected) => {
    assert.deepEqual(legalOf(cell, fields), expected);
  });

  it.each([
    ["Jonathan Michael Smith", crm("Jon", "", "Smith")],
    ["Jonathan Smith", crm("Jon", "", "Jones")],
    ["Mary Ann Smith", crm("Mary Ann", "Ann", "Smith")],
  ])("refuses %s when the CRM record cannot prove the split", (cell, fields) => {
    assert.throws(() => legalOf(cell, fields), RosterNameUnresolvedError);
  });

  it("derives the preferred name from the lived cell", () => {
    const fields = crm("Jon", "", "Smith");
    const legalName = "Jonathan Michael Smith";
    const legal = name("Jonathan", "Michael", "Smith");
    const anchored = { ...fields, middleName: "M" };
    assert.deepEqual(rosterHireNames({ legalName, livedName: null }, anchored), { legal, preferred: legal });
    assert.deepEqual(rosterHireNames({ legalName, livedName: "jonathan  michael SMITH" }, anchored), { legal, preferred: legal });
    assert.deepEqual(rosterHireNames({ legalName, livedName: "Jon" }, anchored).preferred, name("Jon", "", "Smith"));
    assert.deepEqual(rosterHireNames({ legalName, livedName: "Jon Smith" }, anchored).preferred, name("Jon", "", "Smith"));
    assert.throws(() => rosterHireNames({ legalName, livedName: "Alex" }, anchored), RosterNameUnresolvedError);
  });

  it("refuses two commas and an empty comma side", () => {
    const anchors = { last: ["Smith"], first: ["Jon"], middle: [""] };
    for (const cell of ["Smith, Jon, Jr", "Smith,", ", Jon", "Smith , "]) assert.throws(() => splitRosterName(cell, anchors), RosterNameUnresolvedError);
  });

  it("matches accents, case and punctuation but keeps the roster's own words", () => {
    assert.deepEqual(splitRosterName("José  María O'Neil", { last: ["oneil"], first: ["JOSE"], middle: [""] }),
      name("José", "María", "O'Neil"));
    assert.deepEqual(splitRosterName("garcía, josé", { last: ["Garcia"], first: ["Jose"], middle: [""] }), name("josé", "", "garcía"));
  });

  it("requires a last-name anchor to leave a given name and ignores empty anchors", () => {
    assert.throws(() => splitRosterName("Smith", { last: ["Smith"], first: [""], middle: [""] }), RosterNameUnresolvedError);
    assert.throws(() => splitRosterName("Jon Smith", { last: [""], first: ["Jon"], middle: [""] }), RosterNameUnresolvedError);
    assert.deepEqual(splitRosterName("Ann Lee Smith", { last: ["Lee Smith", "Smith"], first: [""], middle: [""] }), name("Ann", "", "Lee Smith"));
  });
});
