import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { readStagedWizardSubjectOnPage } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import { createUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import { UCPATH_PERSON_ORG_DISPLAYED_EID } from "../../../../../src/models/ui/ucpath-person-org.js";
import { UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import type { MutationCapability } from "../../../../../src/models/ui/driver.js";

describe("UCPath current session effects", () => {
  it("stops the retained frame before the next action after its first fill revokes the session", async () => {
    let current = true;
    const events: string[] = [];
    const locator = {
      selectOption: async () => { events.push("select"); return []; },
      fill: async () => { events.push("fill"); current = false; },
      click: async () => { events.push("click"); },
    };
    const page = { goto: async () => null, frameLocator: () => ({ locator: () => locator }) } as unknown as Page;
    const driver = createUcpathPersonOrgDriver(() => {
      if (!current) throw new Error("session revoked");
    }, page);

    await assert.rejects(driver.searchPersonMatch({ firstName: "Person", lastName: "Fixture" }), /session revoked/u);
    assert.deepEqual(events, ["select", "fill"]);
  });

  it("withholds the final HR read and refuses a retained callback after revocation", async () => {
    let current = true;
    let reads = 0;
    const control = {
      waitFor: async () => undefined,
      textContent: async () => { reads++; current = false; return "10800000"; },
    };
    const page = { frameLocator: () => ({ locator: () => control }) } as unknown as Page;
    const driver = createUcpathPersonOrgDriver(() => {
      if (!current) throw new Error("session revoked");
    }, page);
    const retainedRead = driver.read.bind(driver);

    await assert.rejects(retainedRead(UCPATH_PERSON_ORG_DISPLAYED_EID), /session revoked/u);
    assert.equal(reads, 1);
    await assert.rejects(retainedRead(UCPATH_PERSON_ORG_DISPLAYED_EID), /session revoked/u);
    assert.equal(reads, 1);
  });

  it("withholds the final read from the standalone Smart HR operation", async () => {
    let current = true;
    const page = {
      evaluate: async () => { current = false; return { state: "read", name: "Fixture Person" }; },
    } as unknown as Page;
    await assert.rejects(readStagedWizardSubjectOnPage(() => {
      if (!current) throw new Error("session revoked");
    }, page), /session revoked/u);
  });

  it("keeps the minted capability check ahead of browser access", async () => {
    let accessed = false;
    const page = { locator: () => { accessed = true; throw new Error("unexpected browser access"); } } as unknown as Page;
    const driver = createUcpathPersonOrgDriver(() => undefined, page);
    await assert.rejects(driver.commit(UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON, {} as MutationCapability), /not minted/u);
    assert.equal(accessed, false);
  });
});
