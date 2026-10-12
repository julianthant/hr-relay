import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import {
UCPATH_PERSON_ORG_DETAIL_READY,
UCPATH_PERSON_ORG_DETAIL_SCREEN,
UCPATH_PERSON_ORG_DISPLAYED_EID,
UCPATH_PERSON_ORG_EID_INPUT,
UCPATH_PERSON_ORG_SEARCH_READY,
UCPATH_PERSON_ORG_SEARCH_SCREEN,
parseUcpathPersonOrgEid,
} from "../../../../../src/models/ui/ucpath-person-org.js";

describe("semantic UI registry", () => {

  it("runs the deterministic read-only Person Org scenario through typed ids", async () => {
    const driver = createDeterministicUcpathPersonOrgDriver();
    const eid = parseUcpathPersonOrgEid("10800000");
    await driver.goto(UCPATH_PERSON_ORG_SEARCH_SCREEN);
    await driver.waitFor(UCPATH_PERSON_ORG_SEARCH_READY);
    await driver.fill(UCPATH_PERSON_ORG_EID_INPUT, eid);
    await driver.goto(UCPATH_PERSON_ORG_DETAIL_SCREEN);
    await driver.waitFor(UCPATH_PERSON_ORG_DETAIL_READY);
    assert.equal(await driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID), eid);
  });

  it("fails loud when the deterministic observation lacks state or subject", async () => {
    const driver = createDeterministicUcpathPersonOrgDriver();
    await assert.rejects(
      driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID),
      /requires the detail screen/,
    );
    await driver.goto(UCPATH_PERSON_ORG_DETAIL_SCREEN);
    await assert.rejects(
      driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID),
      /requires a prior canonical EID fill/,
    );
  });
});
