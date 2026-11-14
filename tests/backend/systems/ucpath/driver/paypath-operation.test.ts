import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createUcpathPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-operation.js";
import {
  UCPATH_PAYPATH_POSITION_READY, UCPATH_PAYPATH_WORK_STUDY_STAGED, UcpathPayPathRefusedError, UcpathPayPathSubmitRefusedError,
  UcpathPayPathWorkStudyTargetSchema, type UcpathPayPathRefusalCode,
} from "../../../../../src/models/ui/ucpath-paypath.js";
import { EidSchema, FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import type { MutationCapability } from "../../../../../src/models/ui/driver.js";
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

  it("refuses the already-dated record run 92dd9da8 reached by its own reason, typing nothing after the search", async () => {
    const { h, error } = await refusal({ outcome: "already-dated" });
    assert.equal(error.code, "paypath-position-already-dated");
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
    [{ missing: "name" }, "paypath-identity-unreadable"],
    [{ nameCount: 2 }, "paypath-identity-unreadable"],
    [{ headerEmplId: "10000002" }, "subject-mismatch"],
    [{ headerEmplId: "not an id" }, "subject-mismatch"],
    [{ missing: "job-data-tab" }, "unexpected-page-state"],
    [{ missing: "effective-date-label" }, "unexpected-page-state"],
    [{ missing: "category" }, "paypath-hr-tasks-not-shown"],
    [{ missing: "actions" }, "paypath-hr-tasks-not-shown"],
    [{ missing: "body" }, "paypath-hr-tasks-not-shown"],
    [{ missing: "empl-id-input" }, "paypath-search-not-shown"],
    [{ missing: "search" }, "paypath-search-not-shown"],
    [{ missing: "empl-id-display" }, "unexpected-page-state"],
    [{ missing: "position-pool" }, "unexpected-page-state"],
    [{ outcome: "alert", missing: "alert-text" }, "paypath-alert-shown"],
    [{ outcome: "nothing" }, "unexpected-page-state"],
    [{ ambiguousPositionNumber: true }, "unexpected-page-state"],
  ])("refuses %j with %s", async (options, code) => {
    assert.equal((await refusal(options)).error.code, code);
  });

  it("clicks PayPath Actions once more, and only once, before refusing a search that never shows", async () => {
    const { h } = await refusal({ missing: "empl-id-input" });
    assert.deepEqual(h.actions, ["click:category", "click:actions", "click:actions"]);
  });

  it("lets a revoked owner's error through instead of a page-state refusal", async () => {
    const world = fakeUcpathPayPathPage();
    const driver = createUcpathPayPathOperations(() => { throw new Error("owner-revoked"); }, world.page, manualClock(new Date("2026-08-03T18:00:00.000Z")));
    await assert.rejects(driver.readPayPathPosition({ emplId: EMPL_ID }), { message: "owner-revoked" });
  });
});

const COMMENTS = "Updated pool id to F per work study award 08/03/2026";
const target = UcpathPayPathWorkStudyTargetSchema.parse({
  emplId: EMPL_ID, expectedName: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F", comments: COMMENTS,
});
const OPEN = ["click:category", "click:actions", "fill:empl-id-input=10000001", "click:search"];
const filled = (key: string, value: string) => [`fill:${key}=${value}`, `press:${key}=Tab`, "settle"];
const READ_BACK = ["click:position-data-tab", "settle", "click:job-data-tab", "settle", "click:additional-pay-tab", "settle"];
const STAGE = [
  ...filled("effective-date", "08/03/2026"), ...filled("position-change-reason", "JRL"), ...filled("position-pool", "F"),
  "click:job-data-tab", "settle", ...filled("job-data-comments", COMMENTS),
  "click:additional-pay-tab", "settle", ...filled("initiator-comments", COMMENTS), ...READ_BACK,
];
const capability = () => mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)));

function world(options: Parameters<typeof fakeUcpathPayPathPage>[0] = {}) {
  const page = fakeUcpathPayPathPage(options);
  return { ...page, driver: createUcpathPayPathOperations(() => undefined, page.page, manualClock(new Date("2026-08-03T18:00:00.000Z"))) };
}

describe("UCPath PayPath work-study staging on a fake page", () => {
  it("fills Position Data and both comments in the legacy order, reads every value back and never clicks Save", async () => {
    const h = world();
    assert.deepEqual(await h.driver.stagePayPathWorkStudy(target), {
      pageStateId: UCPATH_PAYPATH_WORK_STUDY_STAGED, emplId: EMPL_ID, displayedName: "Lee, Jordan", observedAt: "2026-08-03T18:00:00.000Z",
      values: { effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F", jobDataComments: COMMENTS, initiatorComments: COMMENTS },
    });
    assert.deepEqual(h.actions, [...OPEN, ...STAGE]);
  });

  it("refuses paypath-alert-shown without text when an alert after a fill has no readable text", async () => {
    const error = await world({ alertAfterFill: "Synthetic alert", missing: "alert-text" }).driver.stagePayPathWorkStudy(target).then(() => undefined, (caught: unknown) => caught);
    assert.ok(error instanceof UcpathPayPathRefusedError);
    assert.equal(error.code, "paypath-alert-shown");
    assert.equal(error.alertText, undefined);
  });

  it("reports the value a PeopleSoft postback cleared after the field settled, for the task to refuse", async () => {
    const h = world({ postbackClears: "position-change-reason" });
    assert.equal((await h.driver.stagePayPathWorkStudy(target)).values.positionChangeReason, "");
  });

  it("reports the value the page kept when a fill does not stick, for the task to refuse", async () => {
    const h = world({ revert: "position-pool" });
    assert.equal((await h.driver.stagePayPathWorkStudy(target)).values.positionPool, "");
  });

  it("refuses with the alert text when PeopleSoft answers a fill with an alert, and never clicks OK", async () => {
    const h = world({ alertAfterFill: " Invalid date " });
    const error = await h.driver.stagePayPathWorkStudy(target).then(() => undefined, (caught: unknown) => caught);
    assert.ok(error instanceof UcpathPayPathRefusedError);
    assert.equal(error.code, "paypath-alert-shown");
    assert.equal(error.alertText, "Invalid date");
    assert.equal(h.actions.includes("click:alert-ok"), false);
  });

  it.each<[Parameters<typeof fakeUcpathPayPathPage>[0], UcpathPayPathRefusalCode]>([
    [{ outcome: "no-results" }, "employee-not-found"],
    [{ outcome: "already-dated" }, "paypath-position-already-dated"],
    [{ headerEmplId: "10000002" }, "subject-mismatch"],
    [{ saveButtons: 2 }, "unexpected-page-state"],
    [{ saveDisabled: true }, "unexpected-page-state"],
  ])("refuses staging %j with %s before anything is saved", async (options, code) => {
    const h = world(options);
    const error = await h.driver.stagePayPathWorkStudy(target).then(() => undefined, (caught: unknown) => caught);
    assert.ok(error instanceof UcpathPayPathRefusedError);
    assert.equal(error.code, code);
    assert.equal(h.actions.includes("click:save"), false);
  });
});

describe("UCPath PayPath subject name before the fence", () => {
  it("reads the one header name on the staged page", async () => {
    const h = world();
    await h.driver.stagePayPathWorkStudy(target);
    assert.equal(await h.driver.readPayPathSubject(), "Lee, Jordan");
  });

  it("refuses as unreadable when no record header is shown", async () => {
    const h = world();
    await assert.rejects(h.driver.readPayPathSubject(), (error: unknown) => error instanceof UcpathPayPathRefusedError && error.code === "paypath-identity-unreadable");
  });
});

describe("UCPath PayPath work-study Save on a fake page", () => {
  it("clicks Save and Submit exactly once on the staged page under a minted capability", async () => {
    const h = world();
    await h.driver.stagePayPathWorkStudy(target);
    await h.driver.submitPayPathWorkStudy(target, capability());
    assert.deepEqual(h.actions, [...OPEN, ...STAGE, ...READ_BACK, "click:save"]);
  });

  it("refuses a capability the sequencer did not mint, before any click", async () => {
    const h = world();
    await h.driver.stagePayPathWorkStudy(target);
    const forged = Object.freeze({ intentGeneration: 1, bindingDigest: "a".repeat(64) }) as unknown as MutationCapability;
    await assert.rejects(h.driver.submitPayPathWorkStudy(target, forged));
    assert.equal(h.actions.includes("click:save"), false);
  });

  it("refuses to click when nothing was staged for this target", async () => {
    const h = world();
    await assert.rejects(h.driver.submitPayPathWorkStudy(target, capability()));
    await h.driver.stagePayPathWorkStudy(target);
    await assert.rejects(h.driver.submitPayPathWorkStudy({ ...target, effectiveDate: "09/01/2026" }, capability()));
    assert.equal(h.actions.includes("click:save"), false);
  });

  it("refuses to click when the page no longer shows the staged Empl ID", async () => {
    const h = world();
    await h.driver.stagePayPathWorkStudy(target);
    h.values["empl-id-display"] = "10000002";
    await assert.rejects(h.driver.submitPayPathWorkStudy(target, capability()), (error: unknown) => error instanceof UcpathPayPathRefusedError && error.code === "subject-mismatch");
    assert.equal(h.actions.includes("click:save"), false);
  });

  it("throws, for the caller to park, when PeopleSoft neither answers nor leaves the staged page after the click", async () => {
    const h = world({ saveStays: true });
    await h.driver.stagePayPathWorkStudy(target);
    await assert.rejects(h.driver.submitPayPathWorkStudy(target, capability()), /paypath-submit-outcome-unseen/u);
    assert.deepEqual(h.actions.filter(action => action === "click:save"), ["click:save"]);
  });

  it.each(["effective-date", "position-change-reason", "position-pool", "job-data-comments", "initiator-comments"])("refuses to click when the staged %s changed", async key => {
    const h = world();
    await h.driver.stagePayPathWorkStudy(target);
    h.values[key] = "changed";
    await assert.rejects(h.driver.submitPayPathWorkStudy(target, capability()), (error: unknown) => error instanceof UcpathPayPathRefusedError && error.code === "staged-value-mismatch");
    assert.equal(h.actions.includes("click:save"), false);
  });

  it("raises the alert PeopleSoft shows after the click with its text, without clicking OK", async () => {
    const h = world({ alertAfterSave: " Synthetic save error " });
    await h.driver.stagePayPathWorkStudy(target);
    const error = await h.driver.submitPayPathWorkStudy(target, capability()).then(() => undefined, (caught: unknown) => caught);
    assert.ok(error instanceof UcpathPayPathSubmitRefusedError);
    assert.equal(error.alertText, "Synthetic save error");
    assert.deepEqual(h.actions.filter(action => action === "click:save" || action === "click:alert-ok"), ["click:save"]);
  });
});
