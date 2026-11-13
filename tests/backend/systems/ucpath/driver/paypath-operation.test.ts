import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createUcpathPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-operation.js";
import { UCPATH_PAYPATH_POSITION_READY, UcpathPayPathRefusedError, type UcpathPayPathRefusalCode } from "../../../../../src/models/ui/ucpath-paypath.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { fakeUcpathPayPathPage } from "../../../../support/helpers/browser/fake-ucpath-paypath-page.js";

const EMPL_ID = EidSchema.parse("10000001");

function read(options: Parameters<typeof fakeUcpathPayPathPage>[0] = {}) {
  const world = fakeUcpathPayPathPage(options);
  const driver = createUcpathPayPathOperations(() => undefined, world.page, manualClock(new Date("2026-08-03T18:00:00.000Z")));
  return { ...world, result: driver.readPayPathPosition({ emplId: EMPL_ID }) };
}

async function refusal(options: Parameters<typeof fakeUcpathPayPathPage>[0]) {
  const h = read(options);
  const error = await h.result.then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof UcpathPayPathRefusedError);
  return { h, error };
}

describe("UCPath PayPath read on a fake page", () => {
  it("reads the header and Position Data with one fill and only the three allowed clicks", async () => {
    const h = read();
    assert.deepEqual(await h.result, {
      pageStateId: UCPATH_PAYPATH_POSITION_READY, emplId: EMPL_ID, displayedName: "Lee, Jordan",
      position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
      observedAt: "2026-08-03T18:00:00.000Z",
    });
    assert.equal(h.gotos.length, 1);
    assert.deepEqual(h.actions, ["click:category", "click:actions", "fill:empl-id-input=10000001", "click:search"]);
  });

  it("refuses on an alert, carries its text and never clicks OK", async () => {
    const { h, error } = await refusal({ outcome: "alert", alertText: " Synthetic alert text " });
    assert.equal(error.code, "paypath-alert-shown");
    assert.equal(error.alertText, "Synthetic alert text");
    assert.equal(h.actions.includes("click:alert-ok"), false);
  });

  it.each<[Parameters<typeof fakeUcpathPayPathPage>[0], UcpathPayPathRefusalCode]>([
    [{ outcome: "no-results" }, "employee-not-found"],
    [{ outcome: "grid" }, "paypath-multiple-records"],
    [{ name: "   " }, "paypath-identity-unreadable"],
    [{ headerEmplId: "10000002" }, "subject-mismatch"],
    [{ headerEmplId: "not an id" }, "subject-mismatch"],
    [{ outcome: "nothing" }, "unexpected-page-state"],
    [{ ambiguousPositionNumber: true }, "unexpected-page-state"],
  ])("refuses %j with %s", async (options, code) => {
    assert.equal((await refusal(options)).error.code, code);
  });
});
