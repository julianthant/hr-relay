import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createI9CreationOperations } from "../../../../../src/backend/systems/i9/driver/creation-operation.js";
import { I9_PROFILE_EXAMPLE, I9_PROFILE_SUBJECT, I9RemoteTargetSchema } from "../../../../../src/models/ui/i9-creation.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { DRY_RUN_I9_PROFILE_ID } from "../../../../../src/models/workflow/dry-run.js";
import { fakeI9CreationPage } from "../../../../support/helpers/browser/fake-i9-creation-page.js";

const capability = () => mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)));
function fixture(options: Parameters<typeof fakeI9CreationPage>[0] = {}) {
  const world = fakeI9CreationPage(options);
  const driver = createI9CreationOperations(() => undefined, world.page, manualClock(new Date("2026-09-01T18:00:00.000Z")), world.reads);
  let captures = 0;
  return { ...world, driver, capture: async () => { captures++; }, captures: () => captures };
}
const remote = I9RemoteTargetSchema.parse({ ...I9_PROFILE_EXAMPLE, profileId: "900001", startDate: "09/11/2026" });

describe("I-9 creation browser operations against a fake page", () => {
  for (const outcome of ["route", "ok"] as const) it(`fills and verifies the profile before its single save (${outcome})`, async () => {
    const h = fixture({ saveOutcome: outcome });
    await h.driver.prepareProfile(I9_PROFILE_EXAMPLE, h.capture);
    assert.equal(await h.driver.read(I9_PROFILE_SUBJECT), "Fixture Hire");
    assert.equal(h.actions.includes("click:save-profile"), false);
    assert.ok(h.captures() >= 10);
    const proof = await h.driver.saveProfile(capability());
    assert.equal(proof.profileId, "900001"); assert.equal(proof.email, I9_PROFILE_EXAMPLE.email);
    assert.equal(h.actions.filter(value => value === "click:save-profile").length, 1);
  });

  for (const outcome of ["duplicate", "error", "unknown"] as const) it(`refuses an unproved post-save ${outcome} without selecting a duplicate`, async () => {
    const h = fixture({ saveOutcome: outcome });
    await h.driver.prepareProfile(I9_PROFILE_EXAMPLE, h.capture);
    await assert.rejects(h.driver.saveProfile(capability()));
    assert.equal(h.actions.filter(value => value === "click:save-profile").length, 1);
    await assert.rejects(h.driver.saveProfile(capability()), /not-staged/u);
  });

  it("refuses a forged capability before browser access", async () => {
    const h = fixture();
    await assert.rejects(h.driver.saveProfile({} as never), /not minted/u);
    await assert.rejects(h.driver.createRemote({} as never), /not minted/u);
    assert.deepEqual(h.actions, []);
  });

  it("rejects changed identity, wrong worksite, disabled submit and profile route replacement before a write", async () => {
    for (const options of [{ readOverrides: { "Middle Name": "Wrong" } }, { worksiteLabel: "6-000413 Wrong Worksite" }, { disabled: true }]) {
      const h = fixture(options);
      await assert.rejects(h.driver.prepareProfile(I9_PROFILE_EXAMPLE, h.capture));
      assert.equal(h.actions.includes("click:save-profile"), false);
    }
    const h = fixture(); await h.driver.prepareProfile(I9_PROFILE_EXAMPLE, h.capture);
    h.setUrl("https://wwwe.i9complete.com/employee/profile/900001");
    await assert.rejects(h.driver.read(I9_PROFILE_SUBJECT), /route-mismatch/u);
    await assert.rejects(h.driver.saveProfile(capability()), /route-mismatch/u);
    assert.equal(h.actions.includes("click:save-profile"), false);
  });

  it("creates the remote record only after its exact profile, date and independent summary agree", async () => {
    const h = fixture(); await h.driver.prepareRemote(remote, h.capture);
    assert.equal(h.fields.get("Start Date*"), remote.startDate);
    assert.equal(h.actions.includes("click:create-remote"), false);
    const proof = await h.driver.createRemote(capability());
    assert.equal(proof.profileId, remote.profileId); assert.equal(proof.i9Id, "900002");
    assert.equal(h.actions.filter(value => value === "click:create-remote").length, 1);
  });

  for (const options of [{ remoteOutcome: "error" as const }, { remoteOutcome: "both" as const }, { summaryProfileId: "900003" }]) {
    it(`refuses remote completion for ${JSON.stringify(options)}`, async () => {
      const h = fixture(options); await h.driver.prepareRemote(remote, h.capture);
      await assert.rejects(h.driver.createRemote(capability()));
      assert.equal(h.actions.filter(value => value === "click:create-remote").length, 1);
    });
  }
  it("refuses another saved-profile route before preparing a remote record", async () => {
    const h = fixture({ redirectProfileId: "900003" });
    await assert.rejects(h.driver.prepareRemote(remote, h.capture), /route-mismatch/u);
    assert.equal(h.actions.includes("click:create-remote"), false);
  });
  it("refuses a profile search redirect that changes the chosen profile ID", async () => {
    const h = fixture({ redirectProfileId: "900003", rows: [{ firstName: "Fixture", lastName: "Hire", employer: "Example",
      worksite: "6-000412 Example Worksite", profileId: "900001", i9Id: "", nextAction: "Complete Section 1", startDate: "", createdOn: "09/01/2026" }] });
    await assert.rejects(h.driver.probeProfile(I9_PROFILE_EXAMPLE), /route-mismatch/u);
    assert.equal(h.actions.includes("click:save-profile"), false);
  });
  it("fills a preview target but refuses to submit its reserved profile ID", async () => {
    const h = fixture();
    await h.driver.prepareRemote({ ...remote, profileId: DRY_RUN_I9_PROFILE_ID }, h.capture);
    await assert.rejects(h.driver.createRemote(capability()), /preview-target-refused/u);
    assert.equal(h.actions.includes("click:create-remote"), false);
  });
});
