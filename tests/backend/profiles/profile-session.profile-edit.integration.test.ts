import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createProfileSessionWorld } from "../../support/helpers/backend/profile-session-world.js";

const worlds: Awaited<ReturnType<typeof createProfileSessionWorld>>[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });
async function world() { const created = await createProfileSessionWorld(); worlds.push(created); return created; }
const alexFields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };

describe("profile details edit", () => {
  it("changes the name, initials and timekeeper name, keeps the session usable, and keeps the values after a restart", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);

    const changed = session.changeDetails(alex.token, { name: { firstName: "Alexis", lastName: "Rivers" }, initials: "AXR", timekeeperName: "Lex Rivers" });
    assert.equal(changed.state, "changed");
    if (changed.state === "changed") assert.deepEqual([changed.account.name, changed.account.initials, changed.account.timekeeper], ["Alexis Rivers", "AXR", "Lex Rivers"]);
    assert.equal(session.prepareCurrentStorage(alex.token).state, "available");

    const restarted = machine.open();
    assert.equal(restarted.resumeSignedInProfile({ at: "2026-09-06T12:05:00.000Z" }).state, "active");
    const row = machine.machine.readProfileRegistry().profiles.find(entry => entry.profileId === alex.profileId);
    assert.deepEqual([row?.firstName, row?.lastName, row?.initials, row?.timekeeperName], ["Alexis", "Rivers", "AXR", "Lex Rivers"]);
  });

  it("refuses each invalid value with its reason and changes nothing, even beside a valid value", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const row = () => machine.machine.readProfileRegistry().profiles.find(entry => entry.profileId === alex.profileId);
    const before = row();
    const cases: readonly [Parameters<typeof session.changeDetails>[1], string][] = [
      [{ name: { firstName: " Alex", lastName: "Rivera" } }, "PROFILE_DISPLAY_NAME_REFUSED"],
      [{ name: { firstName: "Alex", lastName: "4ivera" } }, "PROFILE_DISPLAY_NAME_REFUSED"],
      [{ initials: "" }, "PROFILE_INITIALS_REFUSED"],
      [{ initials: "ar" }, "PROFILE_INITIALS_REFUSED"],
      [{ initials: "A.R" }, "PROFILE_INITIALS_REFUSED"],
      [{ initials: "ABCDEFGHI" }, "PROFILE_INITIALS_REFUSED"],
      [{ timekeeperName: "Lex Rivers " }, "PROFILE_NAME_REFUSED"],
      [{ timekeeperName: "Lex\nRivers" }, "PROFILE_NAME_REFUSED"],
      [{ timekeeperName: "Lex (Rivers)" }, "PROFILE_NAME_REFUSED"],
      [{ timekeeperName: "x".repeat(130) }, "PROFILE_NAME_REFUSED"],
      [{ initials: "LR", timekeeperName: "" }, "PROFILE_NAME_REFUSED"],
    ];
    for (const [change, code] of cases) {
      const refused = session.changeDetails(alex.token, change);
      assert.deepEqual([refused.state, refused.state === "refused" && refused.code], ["refused", code], JSON.stringify(change));
    }
    assert.deepEqual(row(), before);
    assert.equal(session.changeDetails(alex.token, { initials: "ABCDEFGH" }).state, "changed");
  });

  it("changes only the signed-in profile and refuses a token that is no longer its session", async () => {
    const machine = await world();
    const session = machine.open();
    const sam = await machine.signUp(session, { firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-sam", createdAt: "2026-09-06T11:00:00.000Z" });
    assert.equal((await machine.logOut(session, sam.token, "2026-09-06T11:30:00.000Z")).state, "signed-out");
    const samRow = () => machine.machine.readProfileRegistry().profiles.find(entry => entry.profileId === sam.profileId);
    const samBefore = samRow();
    const alex = await machine.signUp(session, alexFields);

    const stale = session.changeDetails(sam.token, { initials: "XX" });
    assert.deepEqual([stale.state, stale.state === "refused" && stale.code], ["refused", "PROFILE_SESSION_STALE"]);
    assert.equal(session.changeDetails(alex.token, { name: { firstName: "Alexis", lastName: "Rivers" }, initials: "AR", timekeeperName: "Lex Rivers" }).state, "changed");
    assert.deepEqual(samRow(), samBefore);
  });
});
