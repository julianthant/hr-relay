import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fixture from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { UcpathContactPageSnapshotSchema } from "../../../src/models/ui/ucpath-emergency-contact.js";

describe("UCPath contact page snapshot", () => {
  it("retains raw observations independently from requested identity and rejects missing controls", () => {
    assert.equal(UcpathContactPageSnapshotSchema.parse({ ...fixture.page, displayedEid: "10000002" }).displayedEid, "10000002");
    for (const invalid of [
      { ...fixture.page, displayedEid: undefined }, { ...fixture.page, displayedName: undefined },
      { ...fixture.page, rows: [{ ...fixture.savedRow, phone: undefined }] },
      { ...fixture.page, rows: [{ ...fixture.savedRow, primary: undefined }] },
    ]) assert.equal(UcpathContactPageSnapshotSchema.safeParse(invalid).success, false);
  });
});
